// 운동 화면: 카메라 → 포즈 인식 → 추적기 → 음성·화면 안내 → 세트 기록

import { Tracker } from './engine/tracker.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';
import { createPoseLandmarker, BONES, JOINTS } from './pose.js';
import { Voice, nativeKorean } from './voice.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const exName = (id) => EXERCISE_BY_ID[id]?.name ?? id;
const fmtClock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

const landmarkers = {}; // 모델별로 한 번만 만든다

// GPU 안전장치: GPU 로 AI 를 켜는 동안 앱이 통째로 멈추면(일부 폰·에뮬레이터 실측) 다음 실행 때 호환 모드로 바꾼다.
// 켜기 직전 'starting' 을 적고, 60프레임을 무사히 처리하면 지운다. 앱을 스스로 내린 경우도 지운다.
export const GPU_GUARD = 'hfpt.gpuGuard';
const guard = (v) => {
  try { if (v) localStorage.setItem(GPU_GUARD, v); else localStorage.removeItem(GPU_GUARD); } catch { /* 무시 */ }
};
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') guard(null); });

export class Workout {
  constructor({ onDone }) {
    this.onDone = onDone;
    this.voice = new Voice();
    this.running = false;
    this.el = {
      screen: $('screen-workout'), video: $('cam'), canvas: $('skeleton'),
      dot: $('wo-dot'), status: $('wo-status-text'), clock: $('wo-clock'),
      exercise: $('wo-exercise'), count: $('wo-count'), message: $('wo-message'), cue: $('wo-cue'),
      sets: $('wo-sets'), debug: $('wo-debug'), loading: $('wo-loading'), loadingText: $('wo-loading-text'),
      voiceBtn: $('btn-voice'), endBtn: $('btn-end'),
    };
    this.el.endBtn.addEventListener('click', () => this.end());
    this.el.voiceBtn.addEventListener('click', () => {
      this.voice.enabled = !this.voice.enabled;
      if (!this.voice.enabled) this.voice.stop();
      this.el.voiceBtn.textContent = this.voice.enabled ? '🔊' : '🔇';
    });
  }

  /**
   * @param {object} o
   * @param {string[]|null} o.candidates 오늘 할 운동(없으면 전체 자동 인식)
   * @param {File|string|null} o.source   영상 파일/주소로 분석 (없으면 전면 카메라)
   */
  async start({ candidates = null, source = null } = {}) {
    const st = store.settings();
    this.voice.enabled = st.voice;
    this.voice.style = st.countStyle;
    this.voice.unlock(); // 시작 버튼 탭 안에서 소리 잠금 해제
    this.el.voiceBtn.textContent = this.voice.enabled ? '🔊' : '🔇';
    this.cfg = { cues: st.cues, rest: st.rest, debug: st.debug };
    this.isFile = !!source;
    this.el.screen.hidden = false;
    this.el.screen.classList.toggle('mirror', st.mirror && !source);
    document.body.classList.add('in-workout');
    this.el.debug.hidden = !st.debug;
    this.el.loading.hidden = false;
    this.el.loadingText.textContent = 'AI 자세 인식 준비 중…';
    this.el.sets.innerHTML = '';
    this._setText('exercise', '');
    this._setText('count', '');
    this._setText('message', '');
    this.el.cue.hidden = true;

    this.session = {
      id: store.uid(), start: Date.now(), end: null, sets: [],
      mode: candidates?.length ? 'pick' : 'auto', candidates: candidates || null,
      source: source ? 'video' : 'camera',
    };
    this.tracker = new Tracker({ candidates, lockReps: st.lockReps });
    this.setCount = {};
    this.restUntil = 0;
    this.greeted = false;
    this.lastTs = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsT = performance.now();
    this.cueUntil = 0;

    try {
      await this._openSource(source);
      const key = `${st.model}-${st.gpu ? 'auto' : 'CPU'}`;
      if (st.gpu && !landmarkers[key]) guard('starting');
      landmarkers[key] ||= await createPoseLandmarker({
        model: st.model,
        delegate: st.gpu ? 'auto' : 'CPU',
        onStatus: (s) => { this.el.loadingText.textContent = s; },
      });
      this.landmarker = landmarkers[key];
    } catch (e) {
      console.error(e);
      if (this.session) this._fail(e);
      return;
    }
    if (!this.session) return; // 준비 중에 닫힘
    this.el.loading.hidden = true;
    this.t0 = performance.now();
    this.wallT0 = Date.now();
    this.running = true;
    this._keepAwake();
    if (this.isFile) this._runFile();
    else this._schedule();
    this.ticker = setInterval(() => this._tick(), 250);
    if (!this.isFile) this.voice.say('준비됐어요. 전신이 보이게 뒤로 가 주세요.');
  }

  async _openSource(source) {
    const v = this.el.video;
    v.muted = true;
    v.playsInline = true;
    if (source) {
      this.el.loadingText.textContent = '영상 여는 중…';
      v.srcObject = null;
      v.loop = false;
      v.preload = 'auto';
      v.src = typeof source === 'string' ? source : URL.createObjectURL(source);
    } else {
      if (!window.isSecureContext) throw Object.assign(new Error('insecure'), { name: 'InsecureContext' });
      if (!navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error('nocam'), { name: 'NotSupportedError' });
      this.el.loadingText.textContent = '카메라 켜는 중…';
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      v.removeAttribute('src');
      v.srcObject = this.stream;
      v.onended = null;
    }
    await new Promise((res, rej) => {
      if (v.readyState >= 2) return res();
      v.onloadeddata = () => res();
      v.onerror = () => rej(new Error('영상을 열 수 없어요'));
    });
    if (!source) await v.play().catch(() => {});
  }

  _fail(e) {
    guard(null);
    const msg = {
      NotAllowedError: '카메라 권한이 필요해요. 브라우저 설정에서 이 사이트의 카메라를 허용해 주세요.',
      NotFoundError: '카메라를 찾을 수 없어요.',
      NotReadableError: '다른 앱이 카메라를 쓰고 있어요. 그 앱을 닫고 다시 시도해 주세요.',
      InsecureContext: '카메라는 https 주소(또는 이 컴퓨터의 localhost)에서만 쓸 수 있어요.',
      NotSupportedError: '이 브라우저는 카메라를 지원하지 않아요. 사파리나 크롬 최신 버전을 써 주세요.',
    }[e?.name] || `시작하지 못했어요: ${e?.message || e}`;
    this.el.loadingText.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = msg;
    const b = document.createElement('button');
    b.className = 'btn btn-primary btn-lg';
    b.textContent = '돌아가기';
    b.style.maxWidth = '280px';
    b.onclick = () => this._close();
    this.el.loadingText.append(p, b);
    this.el.loading.querySelector('.spinner').hidden = true;
  }

  // 공식 MediaPipe 예제와 같은 방식: 매 화면 갱신(rAF)마다 새 영상 프레임이 왔는지 확인해 처리.
  // (requestVideoFrameCallback 은 영상이 다른 요소에 가려지면 크롬이 거의 안 불러줘서 쓰지 않는다 — 실측 0~1fps)
  _schedule() {
    this.raf = requestAnimationFrame(() => {
      if (!this.running) return;
      const v = this.el.video;
      if (v.currentTime !== this.lastVT) this._process(v.currentTime);
      this._schedule();
    });
  }

  // 영상 파일은 재생하지 않고 1/15초씩 넘기며 분석한다 (재생보다 빠르고, 화면이 가려져도 멈추지 않음)
  async _runFile() {
    const v = this.el.video;
    const step = 1 / 15;
    const dur = v.duration;
    this.quiet = true; // 분석은 빨리 감기라 횟수를 소리 내 세지 않는다
    for (let i = 0; this.running; i++) {
      const t = i * step;
      if (t > dur - 0.02) break;
      await new Promise((res) => {
        const done = () => { clearTimeout(timer); res(); };
        const timer = setTimeout(done, 1500);
        v.addEventListener('seeked', done, { once: true });
        v.currentTime = t;
      });
      if (!this.running) return;
      this._process(t);
      this.progress = t / dur;
      if (i % 4 === 0) await new Promise((r) => setTimeout(r, 0)); // 화면 갱신 틈
    }
    this.quiet = false;
    if (this.running) this.end();
  }

  _process(mediaTime) {
    const v = this.el.video;
    if (v.readyState < 2 || v.videoWidth === 0) return;
    this.lastVT = v.currentTime;
    const now = performance.now();
    const ts = Math.max(now, this.lastTs + 1); // 인식기는 타임스탬프가 늘 증가해야 한다
    this.lastTs = ts;
    let res;
    try {
      res = this.landmarker.detectForVideo(v, ts);
    } catch (e) {
      console.error(e);
      return;
    }
    const lm = res.landmarks?.[0] || null;
    const wl = res.worldLandmarks?.[0] || null;
    const t = this.isFile ? mediaTime : (now - this.t0) / 1000;
    const events = this.tracker.update(t, lm, wl);
    this.frames++;
    this.totalFrames = (this.totalFrames || 0) + 1;
    if (this.totalFrames === 60) guard(null); // GPU 로 60프레임 무사히 처리 → 안전
    if (now - this.fpsT > 1000) {
      this.fps = Math.round(this.frames * 1000 / (now - this.fpsT));
      this.frames = 0;
      this.fpsT = now;
    }
    this._draw(lm);
    for (const e of events) this._onEvent(e);
    this._hud();
  }

  _onEvent(e) {
    if (this.quiet && e.type !== 'setEnd') return this._onEventQuiet(e);
    const name = exName(e.exercise);
    const cueText = this.cfg.cues && e.cue ? e.cue.text : '';
    switch (e.type) {
      case 'personFound':
        if (!this.greeted && !this.isFile) {
          this.greeted = true;
          this.voice.say('인식됐어요. 운동을 시작하세요.', { interrupt: true });
        }
        break;
      case 'setStart':
        this.restUntil = 0;
        if (EXERCISE_BY_ID[e.exercise]?.kind === 'hold') {
          this.voice.say(`${name} 시작`, { interrupt: true });
        } else {
          const word = this.voice.style === 'native' ? nativeKorean(e.count) : String(e.count);
          this.voice.say(`${name}. ${word}${cueText ? '. ' + cueText : ''}`, { interrupt: true });
          this._bump();
        }
        if (cueText) this._showCue(e.cue.text);
        break;
      case 'rep':
        this.voice.count(e.count, cueText);
        this._bump();
        if (cueText) this._showCue(e.cue.text);
        break;
      case 'holdTick':
        if (e.sec > 0 && e.sec % 10 === 0) this.voice.say(`${e.sec}초`);
        break;
      case 'cue':
        if (this.cfg.cues) {
          this.voice.say(e.text);
          this._showCue(e.text);
        }
        break;
      case 'setEnd':
        this._recordSet(e.set, e.reason === 'finish');
        break;
      default:
        break;
    }
  }

  _onEventQuiet(e) {
    if ((e.type === 'rep' || e.type === 'setStart') && e.cue) this._showCue(e.cue.text);
  }

  _recordSet(s, quiet) {
    const toMs = (t) => (this.isFile ? this.session.start : this.wallT0) + t * 1000;
    const rec = {
      id: store.uid(), exercise: s.exercise, kind: s.kind,
      reps: s.reps ?? null, holdSec: s.holdSec ?? null, good: s.good ?? null, issues: s.issues || {},
      weight: store.lastWeight(s.exercise), start: Math.round(toMs(s.startT)), end: Math.round(toMs(s.endT)),
    };
    this.session.sets.push(rec);
    store.upsertSession(this.session);
    this.setCount[s.exercise] = (this.setCount[s.exercise] || 0) + 1;
    this._renderSets();
    if (quiet || this.quiet) return;
    const what = s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`;
    let msg = `${exName(s.exercise)} ${what}. ${this.setCount[s.exercise]}세트 완료.`;
    if (this.cfg.rest > 0 && !this.isFile) {
      this.restUntil = performance.now() + this.cfg.rest * 1000;
      this.restWarned = false;
      msg += ` ${this.cfg.rest}초 쉬세요.`;
    }
    this.voice.say(msg);
  }

  _renderSets() {
    this.el.sets.innerHTML = this.session.sets.map((s) => {
      const v = s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`;
      return `<span class="wo-set-chip">${exName(s.exercise)} <b>${v}</b></span>`;
    }).join('');
    this.el.sets.scrollLeft = this.el.sets.scrollWidth;
  }

  _tick() {
    const now = performance.now();
    const elapsed = this.isFile ? (this.progress || 0) * (this.el.video.duration || 0) : (now - this.t0) / 1000;
    this._setText('clock', fmtClock(elapsed));
    if (this.restUntil) {
      const left = (this.restUntil - now) / 1000;
      if (left <= 10 && !this.restWarned) {
        this.restWarned = true;
        this.voice.say('10초 남았어요');
      }
      if (left <= 0) {
        this.restUntil = 0;
        this.voice.beep(660, 0.15);
        this.voice.say('휴식 끝. 다음 세트를 시작하세요.');
      }
      this._hud();
    }
    if (this.cueUntil && now > this.cueUntil) {
      this.cueUntil = 0;
      this.el.cue.hidden = true;
    }
  }

  _hud() {
    const snap = this.tracker.snapshot();
    const f = snap.features;
    const now = performance.now();
    let dot = 'warn', status, message = '';
    if (this.isFile) {
      status = `영상 분석 중 ${Math.round((this.progress || 0) * 100)}%`;
      dot = snap.present ? 'ok' : 'warn';
    } else if (!snap.present) {
      status = '사람을 찾는 중';
      message = '전신이 보이게 2~3m 뒤로 가 주세요';
    } else if (f?.cutoff) {
      status = `인식 중 · ${this.fps}fps`;
      message = '몸 일부가 화면 밖이에요. 조금 더 뒤로';
      dot = 'ok';
    } else {
      status = `인식 중 · ${this.fps}fps`;
      dot = 'ok';
    }
    if (this.isFile && !snap.present) message = '사람이 안 보이는 구간';
    this.el.dot.className = `dot ${dot}`;
    this._setText('status', status);

    if (snap.state === 'reps' || snap.state === 'hold') {
      const no = (this.setCount[snap.exercise] || 0) + 1;
      this._setText('exercise', `${exName(snap.exercise)} · ${no}세트`);
      this._setText('count', snap.state === 'hold' ? `${Math.floor(snap.holdSec)}초` : String(snap.count));
      this.el.count.classList.remove('rest');
      this._setText('message', snap.present ? '' : message);
    } else if (this.restUntil) {
      const left = Math.ceil((this.restUntil - now) / 1000);
      this._setText('exercise', '휴식');
      this._setText('count', fmtClock(left));
      this.el.count.classList.add('rest');
      this._setText('message', '다음 세트는 그냥 시작하면 알아서 세요');
    } else {
      this._setText('exercise', '');
      this._setText('count', '');
      this.el.count.classList.remove('rest');
      this._setText('message', message || (this.session.sets.length ? '다음 운동을 시작하세요' : '운동을 시작하세요'));
    }
    if (this.cfg.debug) this._debug(snap);
  }

  _debug(snap) {
    const f = snap.features || {};
    const n = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
    const recent = this.tracker.log.slice(-4).map((c) =>
      `${c.valid ? '✔' : '·'} ${c.ex} ${n(c.amp, 2)} ${c.failed.join('/')}`).join('\n');
    this.el.debug.textContent =
      `모델 ${this.landmarker?.delegate ?? ''} ${this.fps}fps · 상태 ${snap.state}\n`
      + `무릎 ${n(f.knee)} 엉덩이 ${n(f.hip)} 팔꿈치 ${n(f.elbow)} 몸통 ${n(f.torsoTilt)}\n`
      + `엉덩이높이 ${n(f.hipH, 2)} 손목높이 ${n(f.wristH, 2)} 가시성 ${n(f.visAll, 2)}\n${recent}`;
  }

  _draw(lm) {
    const c = this.el.canvas;
    const v = this.el.video;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    // 화면을 꽉 채우도록(cover) 영상 프레임을 그리고 그 위에 뼈대를 그린다
    const scale = Math.max(W / v.videoWidth, H / v.videoHeight);
    const ox = (W - v.videoWidth * scale) / 2, oy = (H - v.videoHeight * scale) / 2;
    g.drawImage(v, ox, oy, v.videoWidth * scale, v.videoHeight * scale);
    if (!lm) return;
    const X = (p) => ox + p.x * v.videoWidth * scale;
    const Y = (p) => oy + p.y * v.videoHeight * scale;
    const warn = this.cueUntil > 0;
    g.lineCap = 'round';
    g.lineWidth = 5 * dpr;
    g.strokeStyle = warn ? 'rgba(255,176,32,.95)' : 'rgba(255,255,255,.85)';
    for (const [a, b] of BONES) {
      if ((lm[a].visibility ?? 1) < 0.5 || (lm[b].visibility ?? 1) < 0.5) continue;
      g.beginPath();
      g.moveTo(X(lm[a]), Y(lm[a]));
      g.lineTo(X(lm[b]), Y(lm[b]));
      g.stroke();
    }
    g.fillStyle = warn ? '#ffb020' : '#c8f53c';
    for (const i of JOINTS) {
      if ((lm[i].visibility ?? 1) < 0.5) continue;
      g.beginPath();
      g.arc(X(lm[i]), Y(lm[i]), (i === 0 ? 7 : 6) * dpr, 0, Math.PI * 2);
      g.fill();
    }
  }

  _showCue(text) {
    this.el.cue.textContent = text;
    this.el.cue.hidden = false;
    this.cueUntil = performance.now() + 2600;
  }

  _bump() {
    const el = this.el.count;
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }

  _setText(key, text) {
    const el = this.el[key];
    if (el.textContent !== text) el.textContent = text;
  }

  async _keepAwake() {
    try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 지원 안 함 */ }
    this.onVis = async () => {
      if (document.visibilityState === 'visible' && this.running) {
        try { this.wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 무시 */ }
      }
    };
    document.addEventListener('visibilitychange', this.onVis);
  }

  end() {
    if (!this.session) return;
    const wasRunning = this.running;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    clearInterval(this.ticker);
    if (wasRunning) for (const e of this.tracker.finish()) this._onEvent(e);
    this.voice.stop();
    if (this.session.sets.length) {
      this.session.end = Date.now();
      if (this.isFile) {
        const last = this.session.sets[this.session.sets.length - 1];
        this.session.end = last.end;
      }
      store.upsertSession(this.session);
      this.voice.say(this.isFile ? '분석이 끝났어요.' : '운동 끝. 수고했어요!');
    } else {
      store.deleteSession(this.session.id);
    }
    const done = this.session.sets.length ? this.session : null;
    this._close();
    this.onDone(done);
  }

  _close() {
    this.running = false;
    clearInterval(this.ticker);
    this.stream?.getTracks().forEach((tr) => tr.stop());
    this.stream = null;
    const v = this.el.video;
    v.pause();
    v.onended = null;
    if (v.src?.startsWith('blob:')) URL.revokeObjectURL(v.src);
    v.removeAttribute('src');
    v.srcObject = null;
    this.wakeLock?.release?.().catch(() => {});
    if (this.onVis) document.removeEventListener('visibilitychange', this.onVis);
    this.el.screen.hidden = true;
    this.el.loading.querySelector('.spinner').hidden = false;
    document.body.classList.remove('in-workout');
    this.session = null;
  }
}
