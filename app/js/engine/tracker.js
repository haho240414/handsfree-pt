// 운동 추적기: 매 프레임 포즈를 받아 '어떤 운동인지 판별 → 횟수 세기 → 세트 나누기'를 한다.
// 모든 운동의 카운터를 동시에 돌리고, 조건을 통과한 반복이 같은 운동으로 연속 N회 나오면 그 운동으로 확정한다.
// 브라우저/Node 공용 순수 로직 (앱과 test/eval.mjs 가 같은 코드를 쓴다).

import { computeFeatures, SMOOTH_KEYS } from './features.js';
import { FeatureSmoother } from './filters.js';
import { RepCounter, median } from './counter.js';
import { EXERCISES, EXERCISE_BY_ID } from './exercises.js';

export const TRACKER_DEFAULTS = {
  lockReps: 2,      // 자동 인식: 같은 운동의 유효 반복이 이만큼 이어지면 확정
  chainGap: 8,      // 유효 반복 사이가 이보다 멀면(초) 이어진 걸로 보지 않음
  idleFactor: 2.2,  // 세트 종료: 마지막 반복 후 (반복 간격 중앙값 × factor)초 동안 반복이 없으면
  idleMin: 3.5,
  idleMax: 12,
  lostEnd: 4,       // 사람이 화면에서 사라진 채 이만큼 지나면 세트 종료
  minSetReps: 2,    // 이보다 적은 세트는 기록하지 않음
  holdStart: 2.5,   // 플랭크 자세가 이만큼(초) 움직임 없이 유지되면 시작
  holdBreak: 1.5,   // 플랭크 자세가 이만큼 무너지면 종료
  holdMin: 5,       // 이보다 짧은 플랭크는 기록하지 않음
  minVis: 0.45,     // 사람으로 인정할 최소 평균 가시성
  bufferSec: 15,
  smoothTau: 0.07,
  fixed: null,      // 운동을 직접 고른 경우 그 운동 id (1회째부터 셈, soft 조건 생략)
  candidates: null, // 오늘 할 운동 목록 — 이 안에서만 자동 인식 (헬스장 루틴용)
  cueRepeat: 3,     // 같은 자세 지적은 최소 이만큼 반복 뒤에 다시
  logLimit: 3000,
};

export class Tracker {
  constructor(opts = {}) {
    this.o = { ...TRACKER_DEFAULTS, ...opts };
    if (!this.o.fixed && this.o.candidates?.length === 1) this.o.fixed = this.o.candidates[0];
    const allow = this.o.fixed ? [this.o.fixed] : this.o.candidates;
    this.specs = EXERCISES.filter((e) => !allow?.length || allow.includes(e.id));
    this.repSpecs = this.specs.filter((e) => e.kind === 'reps').sort((a, b) => b.priority - a.priority);
    this.holdSpec = this.specs.find((e) => e.kind === 'hold') || null;
    this.counters = Object.fromEntries(this.repSpecs.map((e) => [e.id, new RepCounter(e)]));
    this.smoother = new FeatureSmoother(SMOOTH_KEYS, this.o.smoothTau);
    this.buf = [];
    this.valid = {};
    this.state = 'search'; // search | reps | hold
    this.set = null;
    this.sets = [];
    this.log = [];
    this.present = false;
    this.lastSeenT = -Infinity;
    this.lastF = null;
    this.holdSince = null;
    this.holdLastOk = null;
    this.t = 0;
  }

  /**
   * @param {number} t 초
   * @param {Array|null} lm 정규화 랜드마크 33점 (사람 없으면 null)
   * @param {Array|null} wl 월드 랜드마크 33점
   * @returns {Array<object>} 이벤트 목록
   */
  update(t, lm, wl) {
    const ev = [];
    this.t = t;
    let f = null;
    if (lm && wl) {
      const raw = computeFeatures(lm, wl);
      if (raw.visAll >= this.o.minVis) {
        f = this.smoother.update(t, raw);
        f.t = t;
      }
    }

    if (f) {
      if (!this.present) ev.push({ type: 'personFound' });
      this.present = true;
      this.lastSeenT = t;
      this.buf.push(f);
      while (this.buf.length && this.buf[0].t < t - this.o.bufferSec) this.buf.shift();
    } else if (this.present && t - this.lastSeenT > 1) {
      this.present = false;
      ev.push({ type: 'personLost' });
    }
    this.lastF = f;

    if (f) {
      for (const ex of this.repSpecs) {
        const rep = this.counters[ex.id].update(t, ex.signal(f));
        if (rep) this._candidate(ex, rep, ev);
      }
      if (this.holdSpec) this._hold(t, f, ev);
    }
    this._maybeEndSet(t, ev);
    return ev;
  }

  _window(t0, t1) {
    const out = [];
    for (let i = this.buf.length - 1; i >= 0; i--) {
      const f = this.buf[i];
      if (f.t < t0) break;
      if (f.t <= t1) out.push(f);
    }
    return out.reverse();
  }

  _candidate(ex, rep, ev) {
    const w = this._window(rep.tStart - 0.2, rep.tEnd);
    const b = this._window(rep.tBottom - 0.25, rep.tBottom + 0.25);
    const fixed = this.o.fixed === ex.id;
    const checks = ex.check(w, b, rep).map(([name, ok, soft]) => ({ name, ok: !!ok, soft: !!soft }));
    const valid = checks.every((c) => c.ok || (fixed && c.soft));
    if (this.log.length < this.o.logLimit) {
      this.log.push({ ex: ex.id, ...rep, valid, failed: checks.filter((c) => !c.ok).map((c) => c.name) });
    }
    if (!valid) return;
    this.counters[ex.id].accept(rep.amp);
    const issues = ex.form ? ex.form(w, b).filter((row) => row[1] === true).map((row) => row[0]) : [];
    const r = { ...rep, ex: ex.id, issues };

    if (this.state === 'reps' && this.set.exercise === ex.id) {
      this._countRep(r, ev);
      return;
    }
    const list = (this.valid[ex.id] ||= []);
    // 느린 운동(레그 레이즈·데드리프트)은 한 회가 길어서 간격 기준도 늘린다
    const gap = Math.max(this.o.chainGap, 3 * (r.tEnd - r.tStart));
    if (list.length && r.tEnd - list[list.length - 1].tEnd > gap) list.length = 0;
    list.push(r);
    const need = fixed ? 1 : this.o.lockReps;
    if (list.length < need) return;
    // 다른 운동 세트 도중이면: 그 세트의 마지막 반복 이후에 나온 반복만으로 판단
    if (this.state === 'reps') {
      const after = list.filter((x) => x.tStart >= this.set.lastRepT - 0.3);
      if (after.length < need) return;
      this._endSet(ev, 'switch');
    } else if (this.state === 'hold') {
      this._endSet(ev, 'switch');
    }
    this._startRepSet(ex, list.slice(), ev);
  }

  _startRepSet(ex, reps, ev) {
    this.state = 'reps';
    this.set = {
      exercise: ex.id, kind: 'reps', count: reps.length, reps,
      startT: reps[0].tStart, lastRepT: reps[reps.length - 1].tEnd, cued: {},
    };
    this.valid = {};
    const last = reps[reps.length - 1];
    ev.push({ type: 'setStart', exercise: ex.id, count: this.set.count, issues: last.issues, cue: this._cue(), t: this.t });
  }

  _countRep(r, ev) {
    const s = this.set;
    s.reps.push(r);
    s.count++;
    s.lastRepT = r.tEnd;
    this.valid = {};
    ev.push({ type: 'rep', exercise: s.exercise, count: s.count, issues: r.issues, cue: this._cue(), t: this.t });
  }

  // 자세 지적 정책: 최근 3회 중 2회 이상 같은 문제 + 최근 cueRepeat회 안에 같은 말을 안 했을 때만 (잔소리 방지)
  _cue() {
    const s = this.set;
    const n = s.reps.length;
    const last = s.reps[n - 1];
    if (!last?.issues?.length) return null;
    const recent = s.reps.slice(-3);
    for (const code of last.issues) {
      const hits = recent.filter((r) => r.issues?.includes(code)).length;
      const lastCue = s.cued[code];
      if (hits >= 2 && (lastCue == null || n - lastCue >= this.o.cueRepeat)) {
        s.cued[code] = n;
        const row = EXERCISE_BY_ID[s.exercise].form([], []).find((x) => x[0] === code);
        return { code, text: row?.[2] ?? code, tip: row?.[3] ?? '' };
      }
    }
    return null;
  }

  _hold(t, f, ev) {
    const spec = this.holdSpec;
    const pose = !!spec.pose(f);
    if (this.state === 'hold') {
      const s = this.set;
      if (pose) {
        s.lastOkT = t;
        s.holdSec = t - s.startT;
        const sec = Math.floor(s.holdSec);
        if (sec > s.tick) {
          s.tick = sec;
          ev.push({ type: 'holdTick', exercise: spec.id, sec, t });
          this._holdForm(t, ev);
        }
      }
      return;
    }
    // 시작 판정: 자세 + 최근 1.2초 동안 움직임 없음 (푸시업 반복 중엔 '움직임'이라 시작 안 됨)
    const ok = pose && spec.still(this._window(t - 1.2, t));
    if (ok) {
      if (this.holdSince == null) this.holdSince = t;
      this.holdLastOk = t;
    } else if (this.holdSince != null && t - this.holdLastOk > 0.5) {
      this.holdSince = null;
    }
    if (this.holdSince == null || t - this.holdSince < this.o.holdStart) return;
    if (this.state === 'reps') {
      if (this.set.lastRepT > this.holdSince) return; // 버티는 중에 반복이 있었다 → 플랭크 아님
      this._endSet(ev, 'switch');
    }
    const holdSec = t - this.holdSince;
    this.state = 'hold';
    this.set = {
      exercise: spec.id, kind: 'hold', startT: this.holdSince, holdSec, lastOkT: t, tick: Math.floor(holdSec),
      issueSince: {}, issueSec: {}, cuedAt: {},
    };
    this.valid = {};
    ev.push({ type: 'setStart', exercise: spec.id, holdSec, t });
  }

  // 버티는 동안 1초마다 자세 확인 → 2초 이상 계속된 문제만, 같은 말은 8초 간격
  _holdForm(t, ev) {
    const spec = this.holdSpec;
    const s = this.set;
    if (!spec.form) return;
    const rows = spec.form(this._window(t - 1.5, t), []);
    for (const [code, bad, text, tip] of rows) {
      if (bad === true) {
        s.issueSince[code] ??= t;
        s.issueSec[code] = (s.issueSec[code] || 0) + 1;
        if (t - s.issueSince[code] >= 2 && !(t - (s.cuedAt[code] ?? -Infinity) < 8)) {
          s.cuedAt[code] = t;
          ev.push({ type: 'cue', exercise: spec.id, code, text, tip, t });
        }
      } else {
        delete s.issueSince[code];
      }
    }
  }

  _maybeEndSet(t, ev) {
    const s = this.set;
    if (!s) return;
    if (s.kind === 'hold') {
      const brokeAt = s.lastOkT;
      if (t - brokeAt > this.o.holdBreak) {
        s.holdSec = brokeAt - s.startT;
        this._endSet(ev, this.present ? 'break' : 'lost');
      }
      return;
    }
    const gaps = [];
    for (let i = 1; i < s.reps.length; i++) gaps.push(s.reps[i].tEnd - s.reps[i - 1].tEnd);
    const period = gaps.length ? median(gaps) : 2.5;
    const idle = Math.min(this.o.idleMax, Math.max(this.o.idleMin, period * this.o.idleFactor));
    const ex = EXERCISE_BY_ID[s.exercise];
    const c = this.counters[s.exercise];
    const midRep = c.mode === 'valley' && c.peak && t - c.peak.t < ex.maxDur; // 내려간 채 버티는 중
    const lost = !this.present && t - this.lastSeenT > this.o.lostEnd;
    if (lost || (!midRep && t - s.lastRepT > idle)) this._endSet(ev, lost ? 'lost' : 'idle');
  }

  _endSet(ev, reason) {
    const s = this.set;
    let rec = null;
    if (s.kind === 'reps' && s.count >= this.o.minSetReps) {
      const issues = {};
      for (const r of s.reps) for (const code of r.issues || []) issues[code] = (issues[code] || 0) + 1;
      rec = {
        exercise: s.exercise, kind: 'reps', reps: s.count,
        good: s.reps.filter((r) => !r.issues?.length).length, issues,
        startT: round2(s.startT), endT: round2(s.lastRepT),
        repTimes: s.reps.map((r) => round2(r.tEnd)),
      };
    } else if (s.kind === 'hold' && s.holdSec >= this.o.holdMin) {
      rec = {
        exercise: s.exercise, kind: 'hold', holdSec: Math.round(s.holdSec), issues: { ...s.issueSec },
        startT: round2(s.startT), endT: round2(s.startT + s.holdSec),
      };
    }
    if (rec) {
      this.sets.push(rec);
      ev.push({ type: 'setEnd', set: rec, reason, t: this.t });
    } else {
      ev.push({ type: 'setDiscard', exercise: s.exercise, reason, t: this.t });
    }
    this.state = 'search';
    this.set = null;
    this.valid = {};
    if (s.kind === 'hold') this.holdSince = null;
    for (const c of Object.values(this.counters)) c.clearAdapt();
  }

  /** 운동 종료 시 진행 중인 세트를 마무리 */
  finish() {
    const ev = [];
    if (this.set) {
      if (this.set.kind === 'hold') this.set.holdSec = this.set.lastOkT - this.set.startT;
      this._endSet(ev, 'finish');
    }
    return ev;
  }

  snapshot() {
    const s = this.set;
    return {
      state: this.state,
      present: this.present,
      exercise: s?.exercise ?? null,
      count: s?.kind === 'reps' ? s.count : 0,
      holdSec: s?.kind === 'hold' ? s.holdSec : 0,
      features: this.lastF,
    };
  }
}

const round2 = (x) => Math.round(x * 100) / 100;
