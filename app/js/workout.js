// 운동 화면: 카메라 → 포즈 인식 → 추적기 → 음성·화면 안내 → 세트 기록

import { Tracker } from './engine/tracker.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';
import { summarize as tempoSummary, speeds as tempoSpeeds } from './engine/tempo.js';
import { createPoseLandmarker, BONES, JOINTS } from './pose.js';
import { Voice, nativeKorean } from './voice.js';
import { TiltSensor } from './tilt.js';
import { DiagRecorder } from './diag.js';
import { openCamera, widenCamera } from './camera.js';
import * as store from './store.js';

const $ = (id) => document.getElementById(id);
const exName = (id) => EXERCISE_BY_ID[id]?.name ?? id;
const fmtClock = (sec) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
};

const landmarkers = {}; // 모델별로 한 번만 만든다
const sec = (v) => (v == null ? '-' : `${v.toFixed(1)}초`);
const median = (xs) => { const a = xs.filter(Number.isFinite).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : NaN; };

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
    this.tilt = new TiltSensor();
    this.diag = new DiagRecorder();
    this.running = false;
    this.el = {
      screen: $('screen-workout'), video: $('cam'), canvas: $('skeleton'),
      dot: $('wo-dot'), status: $('wo-status-text'), clock: $('wo-clock'),
      exercise: $('wo-exercise'), count: $('wo-count'), message: $('wo-message'), cue: $('wo-cue'),
      sets: $('wo-sets'), debug: $('wo-debug'), loading: $('wo-loading'), loadingText: $('wo-loading-text'),
      voiceBtn: $('btn-voice'), endBtn: $('btn-end'),
      tempo: $('wo-tempo'), tempoText: $('wo-tempo-text'), tempoCanvas: $('wo-tempo-canvas'), bottom: $('wo-bottom'),
      restActions: $('wo-rest-actions'),
    };
    // 휴식 중: 30초 늘리기 / 바로 끝내기
    $('btn-rest-plus').addEventListener('click', () => {
      if (!this.restUntil) return;
      this.restUntil += 30000;
      this.restSaid = new Set(); // 늘린 만큼 알림을 다시
      this._hud();
    });
    $('btn-rest-skip').addEventListener('click', () => {
      if (!this.restUntil) return;
      this.restUntil = 0;
      this.voice.say('다음 세트를 시작하세요.', { interrupt: true });
      this._hud();
    });
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
    if (!source) this.tilt.start(); // 폰 기울기 센서 (iOS 는 이 탭 안에서 권한을 물어야 함)
    this.el.voiceBtn.textContent = this.voice.enabled ? '🔊' : '🔇';
    // 저장값이 깨져 있어도(옛 백업 등) 멈추지 않게 숫자 배열로 맞춘다
    const alerts = [].concat(st.restAlerts ?? [10]).map(Number).filter((n) => n > 0);
    this.cfg = { cues: st.cues, rest: Number(st.rest) || 0, debug: st.debug, restAlerts: alerts };
    this.isFile = !!source;
    this.el.screen.hidden = false;
    this.el.screen.classList.toggle('mirror', st.mirror && !source); // 후면 카메라면 카메라를 연 뒤 끈다
    document.body.classList.add('in-workout');
    this.el.debug.hidden = !st.debug;
    this.el.loading.hidden = false;
    this.el.loadingText.textContent = 'AI 자세 인식 준비 중…';
    this.el.sets.innerHTML = '';
    this._setText('exercise', '');
    this._setText('count', '');
    this._setText('message', '');
    this.el.cue.hidden = true;
    this._showTempo(false);

    this.session = {
      id: store.uid(), start: Date.now(), end: null, sets: [],
      mode: candidates?.length ? 'pick' : 'auto', candidates: candidates || null,
      source: source ? 'video' : 'camera',
    };
    this.tracker = new Tracker({ candidates, lockReps: st.lockReps, idleSec: st.setEndSec || null });
    this.setCount = {};
    this.restUntil = 0;
    this.greeted = false;
    this.lastTs = 0;
    this.frames = 0;
    this.fps = 0;
    this.fpsT = performance.now();
    this.cueUntil = 0;
    this.appliedUp = null;   // 마지막으로 보정에 쓴 폰 기울기
    this.lastTiltDeg = null;
    this.frameIssue = null;  // 화면 구도 문제 { code, since }
    this.frameSaid = {};     // 구도 안내를 말한 횟수 (같은 말은 두 번까지)
    this.lastFrameSay = -Infinity;
    this.lastTempo = null;   // 쉬는 동안 보여줄 직전 세트 템포
    if (!source) {
      this.diag.start({
        app: 'handsfree-pt', ua: navigator.userAgent, mode: this.session.mode, candidates: candidates || null,
        settings: { model: st.model, gpu: st.gpu, mirror: st.mirror, lockReps: st.lockReps },
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
      });
    }

    try {
      await this._openSource(source, st);
      const key = `${st.model}-${st.gpu ? 'auto' : 'CPU'}`;
      if (st.gpu && !landmarkers[key]) guard('starting');
      landmarkers[key] ||= await createPoseLandmarker({
        model: st.model,
        delegate: st.gpu ? 'auto' : 'CPU',
        onStatus: (s) => { this.el.loadingText.textContent = s; },
      });
      this.landmarker = landmarkers[key];
      this.diag.event(0, 'ready', { delegate: this.landmarker?.delegate ?? null, video: [this.el.video.videoWidth, this.el.video.videoHeight], camera: this.camInfo ?? null });
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

  async _openSource(source, st = store.settings()) {
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
      this.stream = await openCamera(st);
      this.camInfo = await widenCamera(this.stream, st.cameraWide);
      // 거울 보기는 나를 비추는(전면) 카메라일 때만
      this.el.screen.classList.toggle('mirror', !!st.mirror && this.camInfo.facing !== 'environment');
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
    if (!this.isFile) this.diag.add(t, lm, wl);
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
    if (!this.isFile && e.type !== 'holdTick' && e.type !== 'tempo') {
      this.diag.event(e.t ?? this.tracker.t, e.type, e.type === 'setEnd' ? { exercise: e.set.exercise, reps: e.set.reps ?? null, holdSec: e.set.holdSec ?? null }
        : { exercise: e.exercise ?? null, count: e.count ?? null });
    }
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
        if (e.set.tempo) this.lastTempo = { exercise: e.set.exercise, list: e.set.tempo, sum: e.set.tempoSum };
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
    if (s.tempo) { rec.tempo = s.tempo; rec.tempoSum = s.tempoSum; }
    this.session.sets.push(rec);
    store.upsertSession(this.session);
    this.setCount[s.exercise] = (this.setCount[s.exercise] || 0) + 1;
    this._renderSets();
    if (quiet || this.quiet) return;
    const what = s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`;
    let msg = `${exName(s.exercise)} ${what}. ${this.setCount[s.exercise]}세트 완료.`;
    if (this.cfg.rest > 0 && !this.isFile) {
      this.restUntil = performance.now() + this.cfg.rest * 1000;
      this.restSaid = new Set();
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
    if (!this.isFile && this.running) this._applyTilt(now);
    const elapsed = this.isFile ? (this.progress || 0) * (this.el.video.duration || 0) : (now - this.t0) / 1000;
    this._setText('clock', fmtClock(elapsed));
    if (this.restUntil) {
      const left = (this.restUntil - now) / 1000;
      for (const a of this.cfg.restAlerts) {
        if (a === 3) continue;
        if (left <= a && left > a - 2 && !this.restSaid.has(a)) {
          this.restSaid.add(a);
          this.voice.beep(880, 0.08);
          this.voice.say(a >= 60 ? `${a / 60}분 남았어요` : `${a}초 남았어요`);
        }
      }
      if (this.cfg.restAlerts.includes(3)) {
        for (const [n, word] of [[3, '셋'], [2, '둘'], [1, '하나']]) {
          if (left <= n && left > n - 1 && !this.restSaid.has(`c${n}`)) {
            this.restSaid.add(`c${n}`);
            this.voice.beep(n === 1 ? 990 : 880, 0.07);
            this.voice.say(word, { interrupt: true });
          }
        }
      }
      if (left <= 0) {
        this.restUntil = 0;
        this.voice.beep(660, 0.25);
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
    const now = performance.now();
    const active = snap.state === 'reps' || snap.state === 'hold';
    const frame = this.isFile ? null : this._framing(snap);
    let dot = 'warn', status, message = '';
    if (this.isFile) {
      status = `영상 분석 중 ${Math.round((this.progress || 0) * 100)}%`;
      dot = snap.present ? 'ok' : 'warn';
      if (!snap.present) message = '사람이 안 보이는 구간';
    } else if (!snap.present) {
      status = snap.raw ? '몸이 덜 보여요' : '사람을 찾는 중';
      message = frame?.text || '전신이 보이게 2~3m 뒤로 가 주세요';
    } else {
      status = `인식 중 · ${this.fps}fps`;
      dot = 'ok';
      message = frame?.text || '';
    }
    this.el.dot.className = `dot ${dot}`;
    this._setText('status', status);
    if (!active) this._sayFraming(frame, now);

    const count = this.el.count;
    this.el.restActions.hidden = !(this.restUntil && !active && !snap.pending);
    if (active) {
      const no = (this.setCount[snap.exercise] || 0) + 1;
      this._setText('exercise', `${exName(snap.exercise)} · ${no}세트`);
      this._setText('count', snap.state === 'hold' ? `${Math.floor(snap.holdSec)}초` : String(snap.count));
      count.classList.remove('rest', 'tentative');
      // 멈춘 지 1.5초가 넘으면 '몇 초 더 멈추면 이 세트를 기록'하는지 보여준다 (설정 → 세트 끝 판정)
      const left = snap.setEndIn;
      const hint = left != null && snap.idleSec - left > 1.5 && left > 0 ? `${Math.ceil(left)}초 더 쉬면 세트 기록` : '';
      this._setText('message', snap.present ? hint : message);
    } else if (snap.pending) {
      // 자동 인식: 1회째는 아직 확정 전 — 알아챘다는 걸 바로 보여준다
      const left = this.tracker.o.lockReps - snap.pending.count;
      this._setText('exercise', `${exName(snap.pending.exercise)} 같아요`);
      this._setText('count', String(snap.pending.count));
      count.classList.remove('rest');
      count.classList.add('tentative');
      this._setText('message', `${left === 1 ? '한 번' : `${left}번`} 더 하면 세기 시작해요`);
    } else if (this.restUntil) {
      const left = Math.ceil((this.restUntil - now) / 1000);
      this._setText('exercise', '휴식');
      this._setText('count', fmtClock(left));
      count.classList.remove('tentative');
      count.classList.add('rest');
      this._setText('message', '다음 세트는 그냥 시작하면 알아서 세요');
    } else {
      this._setText('exercise', '');
      this._setText('count', '');
      count.classList.remove('rest', 'tentative');
      this._setText('message', message || (this.session.sets.length ? '다음 운동을 시작하세요' : '운동을 시작하세요'));
    }
    this._drawTempo(snap);
    if (this.cfg.debug) this._debug(snap);
  }

  // 화면 구도: 안 보이는 부위에 따라 어떻게 하면 되는지. speak = 소리로도 알려줄 만큼 중요한지
  _framing(snap) {
    const raw = snap.raw;
    if (!raw) return null;
    const s = raw.seen || {};
    if (raw.torsoFrac > 0.42) return { code: 'close', text: '너무 가까워요. 두세 걸음 뒤로 가 주세요', speak: true };
    if (!s.knees) return { code: 'knees', text: '무릎까지 보이게 뒤로 가거나 폰을 낮춰 주세요', speak: true };
    if (!s.head) return { code: 'head', text: '머리까지 보이게 폰을 세우거나 뒤로 가 주세요', speak: true };
    if (raw.cutoff) return { code: 'edge', text: '몸 일부가 화면 밖이에요. 화면 가운데로 와 주세요', speak: false };
    if (!s.feet) return { code: 'feet', text: '발까지 보이면 하체 운동을 더 잘 세요', speak: false };
    return null;
  }

  // 구도 안내 음성: 첫 세트를 기록하기 전(자리 잡는 중)에만, 3초 넘게 계속될 때, 같은 말은 두 번까지, 12초 간격
  _sayFraming(frame, now) {
    if (!frame) { this.frameIssue = null; return; }
    if (this.frameIssue?.code !== frame.code) this.frameIssue = { code: frame.code, since: now };
    if (!frame.speak || this.session.sets.length || this.isFile) return;
    if (now - this.frameIssue.since < 3000 || now - this.lastFrameSay < 12000) return;
    if ((this.frameSaid[frame.code] || 0) >= 2) return;
    this.frameSaid[frame.code] = (this.frameSaid[frame.code] || 0) + 1;
    this.lastFrameSay = now;
    this.voice.say(frame.text);
  }

  // 폰 기울기 센서로 3D 좌표를 바로 세운다 (1.5° 넘게 바뀔 때만 — 세트 중 판정이 흔들리지 않게)
  _applyTilt(now) {
    const up = this.tilt.cameraUp();
    if (!up) return;
    const p = this.appliedUp;
    if (p && up[0] * p[0] + up[1] * p[1] + up[2] * p[2] > Math.cos((1.5 * Math.PI) / 180)) return;
    this.appliedUp = up;
    this.tracker.setCameraUp(up);
    this.session.tilt = this.lastTiltDeg = Math.round(this.tilt.pitchDeg());
    this.diag.event((now - this.t0) / 1000, 'tilt', up.map((v) => Math.round(v * 10000) / 10000));
  }

  // 템포 패널: 세트 중엔 '힘주기·돌아오기' 속도 곡선 + 반복별 속도 막대, 쉬는 동안엔 직전 세트 막대와 평균
  _drawTempo(snap) {
    const live = snap.state === 'reps' && EXERCISE_BY_ID[snap.exercise]?.tempo;
    const rest = !live && !snap.pending && this.restUntil && this.lastTempo;
    if (!live && !rest) { this._showTempo(false); return; }
    const exId = live ? snap.exercise : this.lastTempo.exercise;
    const def = EXERCISE_BY_ID[exId].tempo;
    const list = live ? snap.tempo : this.lastTempo.list;
    const sum = live ? tempoSummary(list) : this.lastTempo.sum;
    const last = live ? [...list].reverse().find(Boolean) : null;
    this._showTempo(true);

    const x = last || sum;
    let html = '';
    if (x) {
      html = `${rest ? '<span class="lbl">평균</span>' : ''}<span class="con">${def.con} ${sec(x.con)}</span><span class="ecc">${def.ecc} ${sec(x.ecc)}</span>`;
      const spd = last ? last.conSpeed : sum.speed;
      if (spd != null) html += `<span class="spd">${spd.toFixed(2)}m/s</span>`;
      if (sum?.loss >= 15) html += `<span class="loss">속도 −${sum.loss}%</span>`;
    } else {
      html = `<span class="lbl">${def.con}·${def.ecc} 속도 재는 중</span>`;
    }
    if (this.el.tempoText.innerHTML !== html) {
      this.el.tempoText.innerHTML = html;
      this._liftCenter();
    }

    const c = this.el.tempoCanvas;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (!W || !H) return;
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    g.clearRect(0, 0, W, H);
    const LIME = '#c8f53c', BLUE = '#5ab8ff', WARN = '#ffb020';
    const gap = 10 * dpr;
    const curveW = live ? Math.round(W * 0.6) : 0;

    // 속도 곡선(최근 6초): 위 = 힘주는 쪽(라임), 아래 = 돌아오는 쪽(파랑). 단위는 '한 번 움직이는 폭/초'
    if (live) {
      const ex = EXERCISE_BY_ID[exId];
      const reps = this.tracker.set?.reps || [];
      const range = median(reps.map((r) => r.top - r.bottom)) || 2 * ex.prom;
      const dir = def.first === 'con' ? -1 : 1;
      const buf = this.tracker.buf;
      const tEnd = buf.length ? buf[buf.length - 1].t : 0;
      const pts = [];
      for (let i = buf.length - 1; i >= 0 && buf[i].t >= tEnd - 6.3; i--) {
        const v = ex.signal(buf[i]);
        if (Number.isFinite(v)) pts.push({ t: buf[i].t, s: v });
      }
      pts.reverse();
      const vel = [];
      for (let i = 1; i < pts.length - 1; i++) {
        const dt = pts[i + 1].t - pts[i - 1].t;
        if (dt > 0) vel.push({ t: pts[i].t, v: (dir * (pts[i + 1].s - pts[i - 1].s)) / dt / range });
      }
      const sm = vel.map((p, i) => ({ t: p.t, v: (vel[Math.max(0, i - 1)].v + p.v + vel[Math.min(vel.length - 1, i + 1)].v) / 3 }));
      const scale = Math.max(1.2, ...sm.map((p) => Math.abs(p.v)));
      const mid = H / 2;
      const X = (t) => ((t - (tEnd - 6)) / 6) * curveW;
      const Y = (v) => mid - (v / scale) * (mid - 3 * dpr);
      g.strokeStyle = 'rgba(255,255,255,.25)';
      g.lineWidth = dpr;
      g.beginPath(); g.moveTo(0, mid); g.lineTo(curveW, mid); g.stroke();
      for (const [sign, color] of [[1, LIME], [-1, BLUE]]) {
        if (sm.length < 2) break;
        g.beginPath();
        g.moveTo(X(sm[0].t), mid);
        for (const p of sm) g.lineTo(X(p.t), Y(sign > 0 ? Math.max(0, p.v) : Math.min(0, p.v)));
        g.lineTo(X(sm[sm.length - 1].t), mid);
        g.closePath();
        g.fillStyle = color;
        g.globalAlpha = 0.85;
        g.fill();
        g.globalAlpha = 1;
      }
    }

    // 반복별 힘주기 속도 막대 (처음 빠른 반복보다 20% 넘게 느려지면 주황)
    const sp = tempoSpeeds(list);
    const vals = list.map((x) => (x ? (sp.metric ? x.conSpeed : x.conRate) : null)).slice(-12);
    const x0 = live ? curveW + gap : 0;
    const bw = W - x0;
    const n = Math.max(vals.length, live ? 6 : 1);
    const slot = bw / n;
    const top = Math.max(...vals.filter((v) => v != null), 1e-9);
    const valid = vals.filter((v) => v != null);
    const best = valid.length ? Math.max(...valid.slice(0, 3)) : 0;
    vals.forEach((v, i) => {
      const bx = x0 + i * slot + slot * 0.18;
      const w = slot * 0.64;
      const h = v == null ? 3 * dpr : Math.max(3 * dpr, (v / top) * (H - 4 * dpr));
      g.fillStyle = v == null ? 'rgba(255,255,255,.3)' : v < 0.8 * best && i >= 1 ? WARN : LIME;
      g.fillRect(bx, H - h, w, h);
    });
  }

  _showTempo(on) {
    if (this.el.tempo.hidden === !on) return;
    this.el.tempo.hidden = !on;
    this._liftCenter();
  }

  // 아래쪽(템포 패널·세트 칩)이 커지면 큰 숫자를 그만큼 위로 올려 겹치지 않게
  _liftCenter() {
    const h = this.el.bottom.offsetHeight;
    if (h !== this.lift) {
      this.lift = h;
      this.el.screen.style.setProperty('--wo-lift', `${h}px`);
    }
  }

  _debug(snap) {
    const f = snap.features || {};
    const n = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '-');
    const recent = this.tracker.log.slice(-4).map((c) =>
      `${c.valid ? '✔' : '·'} ${c.ex} ${n(c.amp, 2)} ${c.failed.join('/')}`).join('\n');
    const pitch = this.tilt.pitchDeg();
    const cam = this.camInfo;
    this.el.debug.textContent =
      `모델 ${this.landmarker?.delegate ?? ''} ${this.fps}fps · 상태 ${snap.state}\n`
      + (cam ? `카메라 ${cam.facing || '?'} ${cam.width}×${cam.height}${cam.zoom != null ? ` 줌 ${cam.zoom}` : ''}\n` : '')
      + `폰 기울기 ${pitch == null ? '센서 없음' : `${n(pitch)}°(보정 ${n(snap.tiltDeg)}°)`}\n`
      + `무릎 ${n(f.knee)} 엉덩이 ${n(f.hip)} 팔꿈치 ${n(f.elbow)} 몸통 ${n(f.torsoTilt)}\n`
      + `엉덩이높이 ${n(f.hipH, 2)} 손목높이 ${n(f.wristH, 2)} 가시성 ${n(f.visAll, 2)}\n${recent}`;
  }

  /** 마지막 운동의 진단 기록 파일 (관절 좌표만) */
  get canExportDiag() { return this.diag.hasData; }
  exportDiag(note) {
    return this.diag.exportFile({
      note,
      sets: this.tracker?.sets || [],
      log: (this.tracker?.log || []).slice(-1500),
      extra: { fps: this.fps, delegate: this.landmarker?.delegate ?? null, tilt: this.lastTiltDeg ?? null },
    });
  }

  _draw(lm) {
    const c = this.el.canvas;
    const v = this.el.video;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(c.clientWidth * dpr), H = Math.round(c.clientHeight * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const g = c.getContext('2d');
    // AI 가 보는 프레임 전체를 잘리지 않게(contain) 그리고 그 위에 뼈대를 그린다
    // (꽉 채우면 화면엔 안 보이는 부분을 AI 는 보고 있어서 '화면 안에 다 들어왔는지' 판단이 어긋난다)
    const scale = Math.min(W / v.videoWidth, H / v.videoHeight);
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
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
    this.tilt.stop();
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
