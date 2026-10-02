// 운동 화면: 카메라 → 포즈 인식 → 추적기 → 음성·화면 안내 → 세트 기록

import { SessionClock } from './session-clock.js';
import { editRecordedSet } from './session-edit.js';
import { icon } from './icons.js';
import { Tracker } from './engine/tracker.js';
import { isHandsUp } from './engine/features.js';
import { EXERCISE_BY_ID } from './engine/exercises.js';
import { summarize as tempoSummary, speeds as tempoSpeeds } from './engine/tempo.js';
import { createPoseLandmarker, BONES, JOINTS } from './pose.js';
import { Voice, nativeKorean } from './voice.js';
import { TiltSensor } from './tilt.js';
import { DiagRecorder, corrections } from './diag.js';
import { openCamera, widenCamera, cameraSummary } from './camera.js';
import { framingIssue, FramingGuide } from './framing.js';
import { PlanRunner, isHold, isTimer, isTimed, TIMER_STEPS, PLAN_META, weightStep } from './routine.js';
import { loadDemos, playDemo, hasDemo } from './demo.js';
import * as store from './store.js';
import { esc } from './format.js';

const $ = (id) => document.getElementById(id);
const exName = (id) => EXERCISE_BY_ID[id]?.name ?? id;
const fmtMinSec = (sec) => (sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ''}`);
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
    this.clock = new SessionClock();
    this.el = {
      screen: $('screen-workout'), video: $('cam'), canvas: $('skeleton'),
      dot: $('wo-dot'), status: $('wo-status-text'), clock: $('wo-clock'),
      exercise: $('wo-exercise'), count: $('wo-count'), message: $('wo-message'), cue: $('wo-cue'),
      sets: $('wo-sets'), debug: $('wo-debug'), loading: $('wo-loading'), loadingText: $('wo-loading-text'),
      voiceBtn: $('btn-voice'), endBtn: $('btn-end'),
      tempo: $('wo-tempo'), tempoText: $('wo-tempo-text'), tempoCanvas: $('wo-tempo-canvas'), bottom: $('wo-bottom'),
      restActions: $('wo-rest-actions'), frame: $('wo-frame'), framing: $('wo-framing'), camera: $('wo-camera'),
      adjust: $('wo-adjust'), adjW: $('adj-w'), adjWVal: $('adj-w-val'), adjR: $('adj-r'), adjRVal: $('adj-r-val'),
      plan: $('wo-plan'), planStep: $('wo-plan-step'), planSets: $('wo-plan-sets'), planFill: $('wo-plan-fill'),
      target: $('wo-target'), next: $('wo-next'), nextText: $('wo-next-text'), planDoneBtn: $('btn-plan-done'), demo: $('wo-demo'),
    };
    this.primary = $('btn-workout-primary');
    this.primary.addEventListener('click', () => {
      if (this.phase === 'prepare' && this.ready) { this.phase = 'countdown'; this.countdownUntil = performance.now()+3000; this.voice.say('셋, 둘, 하나'); }
      else if (this.phase === 'paused') this.resume();
      else if (this.restUntil) this.skipRest();
      else if (this.phase === 'work') this.pause();
      this._hud();
    });
    $('btn-set-end').addEventListener('click', () => this.completeCurrentSet());
    $('btn-last-edit').addEventListener('click', () => this.editLastSet());
    $('btn-camera-flip').addEventListener('click', () => this.flipCamera());
    $('btn-camera-help').addEventListener('click', () => this.cameraHelp());
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.phase === 'work' && !this.isFile) this.pause(); });
    // 루틴(PT 모드): 인식이 안 될 때를 위한 수동 버튼
    $('btn-plan-done').addEventListener('click', () => this.completeCurrentSet());
    $('btn-plan-skip').addEventListener('click', () => this._ptSkip());
    // 쉬는 동안 다음 세트 무게·목표 바로 고치기
    $('wo-adjust').addEventListener('click', (e) => {
      const b = e.target.closest('[data-adj]');
      if (b) this._adjust(b.dataset.adj, Number(b.dataset.d));
    });
    // 휴식 중: 30초 늘리기 / 바로 끝내기
    $('btn-rest-plus').addEventListener('click', () => {
      if (!this.restUntil) return;
      this.restUntil += 30000;
      this.restSaid = new Set(); // 늘린 만큼 알림을 다시
      this._hud();
    });
    $('btn-rest-skip').addEventListener('click', () => this.skipRest());
    this.el.endBtn.addEventListener('click', () => this.end());
    this.el.voiceBtn.addEventListener('click', () => {
      this.voice.enabled = !this.voice.enabled;
      if (!this.voice.enabled) this.voice.stop();
      this.el.voiceBtn.innerHTML = icon(this.voice.enabled ? 'speaker-high' : 'speaker-slash');
      this.el.voiceBtn.setAttribute('aria-pressed', String(this.voice.enabled));
    });
  }

  /**
   * @param {object} o
   * @param {string[]|null} o.candidates 오늘 할 운동(없으면 전체 자동 인식)
   * @param {File|string|null} o.source   영상 파일/주소로 분석 (없으면 전면 카메라)
   * @param {{name:string, items:Array}|null} o.plan 오늘의 루틴(PT 모드): 정해 둔 순서·세트·목표대로 안내
   */
  async start({ candidates = null, source = null, plan = null } = {}) {
    const st = store.settings();
    this.voice.enabled = st.voice;
    this.voice.style = st.countStyle;
    this.voice.unlock(); // 시작 버튼 탭 안에서 소리 잠금 해제
    if (!source) this.tilt.start(); // 폰 기울기 센서 (iOS 는 이 탭 안에서 권한을 물어야 함)
    this.el.voiceBtn.innerHTML = icon(this.voice.enabled ? 'speaker-high' : 'speaker-slash');
      this.el.voiceBtn.setAttribute('aria-pressed', String(this.voice.enabled));
    // 저장값이 깨져 있어도(옛 백업 등) 멈추지 않게 숫자 배열로 맞춘다
    const alerts = [].concat(st.restAlerts ?? [10]).map(Number).filter((n) => n > 0);
    this.cfg = { cues: st.cues, rest: Number(st.rest) || 0, debug: st.debug, restAlerts: alerts, setEndSec: Number(st.setEndSec) || 0 };
    this.isFile = !!source;
    this.phase = source ? 'work' : 'prepare';
    this.ready = false;
    this.readySince = null;
    this.clock = new SessionClock();
    this.primary.disabled = true;
    this.primary.hidden = this.isFile;
    this.el.screen.dataset.phase = this.phase;
    $('wo-bottom').open = false;
    this.el.screen.hidden = false;
    this.el.screen.classList.toggle('mirror', st.mirror && !source); // 후면 카메라면 카메라를 연 뒤 끈다
    document.body.classList.add('in-workout');
    document.querySelectorAll('.screen.page').forEach(page=>page.inert=true);
    this.el.debug.hidden = !st.debug;
    this.el.loading.hidden = false;
    this.el.loadingText.textContent = '자세 인식 준비 중…';
    this.el.sets.innerHTML = '';
    this._setText('exercise', '');
    this._setText('count', '');
    this._setText('message', '');
    this.el.cue.hidden = true;
    this._showTempo(false);

    this.session = {
      id: store.uid(), start: Date.now(), end: null, sets: [],
      mode: plan ? 'routine' : candidates?.length ? 'pick' : 'auto', candidates: candidates || null,
      source: source ? 'video' : 'camera',
    };
    const startingSession = this.session;
    this.plan = plan?.items?.length ? new PlanRunner(plan.items) : null;
    if (this.plan) loadDemos();
    this._setDemo(null);
    if (this.plan) this.session.plan = { name: plan.name || '오늘 루틴', items: this.plan.items };
    this.pt = this.plan ? { stage: 'work', accum: 0, recs: [], lastActiveAt: 0, readyAt: 0, reminded: false } : null;
    this.el.plan.hidden = !this.plan;
    this.el.next.hidden = !this.plan;
    this.el.target.hidden = true;
    this.tracker = this.plan
      ? this._makeTracker(this._exFor(this.plan.i))
      : new Tracker({ candidates, lockReps: st.lockReps, idleSec: st.setEndSec || null });
    this.setCount = {};
    this.restUntil = 0;
    this.greeted = false;
    this.lastTs = 0;
    this.lastInferAt = 0;
    this.lastLm = null;
    this.camInfo = null;
    this.frameGuide = new FramingGuide();
    this.el.framing.hidden = true;
    this.el.camera.hidden = true;
    this.lastVT = null;
    this.totalFrames = 0;
    this.inferEvery = 1000 / Math.max(5, Number(st.analysisFps) || 15);
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
    this.lastEx = null;      // 자유 운동: 방금 끝낸 세트의 운동(휴식 중 무게 조정용)
    this.frameOkAt = null;   // 자리 잡기 확인한 시각
    this.frameGoodSince = null;
    this.prevLogs = [];
    if (!source) {
      this.diag.start({
        app: 'handsfree-pt', ua: navigator.userAgent, mode: this.session.mode, candidates: candidates || null,
        settings: { model: st.model, gpu: st.gpu, mirror: st.mirror, lockReps: st.lockReps, cameraWide: st.cameraWide },
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio },
      });
    }

    try {
      await this._openSource(source, st);
      if (this.session !== startingSession) return;
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
      if (this.session === startingSession) this._fail(e);
      return;
    }
    if (this.session !== startingSession) return; // 준비 중에 닫힘
    this.el.loading.hidden = true;
    this.t0 = performance.now();
    this.wallT0 = Date.now();
    if (this.isFile) this.clock.start(this.t0);
    this.running = true;
    this._keepAwake();
    if (this.isFile) this._runFile();
    else this._schedule();
    this.ticker = setInterval(() => this._tick(), 250);
    this._hud();
    if (!this.isFile) this.voice.say(this._framingOptions(this.tracker.snapshot()).upperBody
      ? '카메라에 상체와 움직이는 팔 전체가 들어오도록 자리 잡아 주세요.' : '카메라에 전신이 들어오도록 자리 잡아 주세요.');
  }

  _prepareHUD() {
    const now=performance.now(), snap=this.tracker.snapshot(), frame=this._framing(snap);
    const good=snap.present && (!frame || frame.code==='feet');
    if(good) this.readySince ??= now; else this.readySince=null;
    this.ready=good && now-this.readySince>=600;
    this.el.screen.dataset.phase=this.phase;
    $('wo-heading').textContent='운동 준비';
    $('wo-subheading').textContent=this.plan ? this.session.plan.name : this.session.candidates?.length ? this.session.candidates.map(exName).join(' · ') : '자유 운동';
    this.el.plan.hidden=true;this.el.next.hidden=true;
    this.el.dot.className=`dot ${this.ready?'ok':'warn'}`;
    this.el.status.textContent=this.ready ? (frame?'자세를 확인했어요':this._framingOptions(snap).upperBody?'팔과 상체가 보여요':'전신이 보여요') : '촬영 위치를 확인해 주세요';
    this.el.framing.hidden=!frame;this.el.framing.textContent=frame?.text||'';
    this.el.frame.hidden=false;this.el.frame.className=`wo-frame ${good?'ok':'bad'}`;
    this.primary.disabled=!this.ready || this.phase==='countdown' || this.switchingCamera;
    this.primary.textContent=this.phase==='countdown'?`${Math.max(1,Math.ceil((this.countdownUntil-now)/1000))}초 뒤 시작`:'운동 시작';
    this._setText('message',this.phase==='countdown'?'준비 자세를 유지해 주세요.':'시작하면 3초 뒤에 횟수를 셉니다.');
    $('btn-camera-flip').hidden=false;$('btn-camera-help').hidden=false;
    $('btn-set-end').hidden=true;$('wo-rest-record').hidden=true;
    this.el.target.hidden=true;$('wo-progress').hidden=true;this._setText('count','');
  }

  beginWorkout() {
    if(this.phase!=='countdown' && this.phase!=='prepare')return;
    const now=performance.now();
    this.clock.start(now);this.t0=now;this.wallT0=Date.now();this.session.start=this.wallT0;
    // 준비 화면의 시각을 제외해 진단 좌표도 운동 시작부터 증가하게 한다.
    this.diag.start({...this.diag.meta,camera:this.camInfo,delegate:this.landmarker?.delegate});
    this.tracker=this.plan?this._makeTracker(this._exFor(this.plan.i)):new Tracker({candidates:this.session.candidates,lockReps:store.settings().lockReps,idleSec:this.cfg.setEndSec||null});
    if(this.appliedUp)this.tracker.setCameraUp(this.appliedUp);
    this.phase='work';this.el.frame.hidden=true;
    if(this.pt){this.pt.readyAt=now;this.pt.lastActiveAt=now;}
    this.voice.beep(990,.15);this.voice.say('시작하세요.',{interrupt:true});this._hud();
  }

  pause(reason = '') {
    if(this.phase!=='work' || this.isFile)return;
    const now=performance.now();this.clock.pause(now);this.pausedAt=now;this.pauseReason=reason;this.phase='paused';this.voice.stop();this._hud();
  }

  resume() {
    if(this.phase!=='paused')return;
    const now=performance.now(), gap=this.clock.resume(now);
    if(this.restUntil)this.restUntil+=gap;
    if(this.pt)for(const key of ['lastActiveAt','readyAt','timerStart','workEnd','leadUntil'])if(this.pt[key]!=null)this.pt[key]+=gap;
    // A half-finished motion must not become a new rep after changing posture while paused.
    for(const counter of Object.values(this.tracker.counters))counter.reset();
    this.tracker.valid={};this.tracker.buf=[];
    this.tracker.smoother=new this.tracker.smoother.constructor(Object.keys(this.tracker.smoother.s),this.tracker.o.smoothTau);
    if (this.tracker.set?.kind === 'reps') this.tracker.set.lastRepT=this.clock.elapsed(now);
    this.resumeGrace=now+1500;
    this.phase='work';this.pauseReason='';this.voice.say('이어서 시작하세요.',{interrupt:true});this._hud();
  }

  skipRest() {
    if(!this.restUntil || this.phase!=='work')return;
    if(this.plan)this._ptEndRest(true);else this.restUntil=0;
    this.voice.say('다음 세트를 시작하세요.',{interrupt:true});this._hud();
  }

  completeCurrentSet() {
    if(this.phase!=='work' || this.restUntil || this.isFile)return;
    if(this.plan)this._ptComplete({manual:true,partial:true});
    else {
      const options={minSetReps:this.tracker.o.minSetReps,holdMin:this.tracker.o.holdMin};
      Object.assign(this.tracker.o,{minSetReps:1,holdMin:1});
      for(const e of this.tracker.finish())this._onEvent(e);
      Object.assign(this.tracker.o,options);
      for(const c of Object.values(this.tracker.counters))c.reset();
    }
    this._hud();
  }

  editLastSet() {
    const set=this.session?.sets.at(-1);
    if(!set || !this.restUntil || this.phase!=='work')return;
    this.pause();
    const d=$('dialog');
    d.innerHTML=`<form method="dialog"><h3>${esc(exName(set.exercise))} 기록 수정</h3><label for="last-reps">${set.kind==='hold'?'버틴 시간(초)':'실제로 한 횟수'}</label><div class="stepper"><button class="mini-btn" type="button" data-last-step="-1" aria-label="줄이기">−</button><input id="last-reps" type="number" inputmode="numeric" min="0" max="9999" value="${set.kind==='hold'?set.holdSec:set.reps}"><button class="mini-btn" type="button" data-last-step="1" aria-label="늘리기">+</button></div><div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">저장</button></div></form>`;
    d.querySelectorAll('[data-last-step]').forEach(b=>b.onclick=()=>{$('last-reps').value=Math.max(0,Number($('last-reps').value)+Number(b.dataset.lastStep));});
    d.onclose=()=>{
      if(d.returnValue==='ok'){
        const value=Number($('last-reps').value);
        if(Number.isFinite(value) && value>=0){
          editRecordedSet(set,{value});
          const logged=this.plan?.log.at(-1);if(logged && logged.i===set.plan?.item && logged.setNo===set.plan?.setNo){logged.done=Math.round(value);this.session.planProgress=this.plan.progress();}
          store.upsertSession(this.session);this._renderSets();
        }
      }
      if(this.session)this.resume();
    };d.showModal();
  }

  async flipCamera() {
    if(this.phase!=='prepare' || this.switchingCamera)return;
    this.switchingCamera=true;this.primary.disabled=true;this.ready=false;this.readySince=null;
    const switchingSession=this.session;
    const previousStream=this.stream;
    try{
      const st={...store.settings(),cameraId:'',facingMode:this.camInfo?.facing==='environment'?'user':'environment'};
      // Release the current camera first: many Android devices permit only one active stream.
      previousStream?.getTracks().forEach(t=>t.stop());
      await this._openSource(null,st);if(this.session!==switchingSession)return;
      this.tracker=this.plan?this._makeTracker(this._exFor(this.plan.i)):new Tracker({candidates:this.session.candidates});
      this.lastVT=null;
    }catch(e){if(this.session===switchingSession)try{await this._openSource(null,store.settings());}catch(error){if(this.session===switchingSession)this._fail(error);}}
    finally{this.switchingCamera=false;if(this.session===switchingSession)this._hud();}
  }

  cameraHelp() {
    const d=$('dialog');d.innerHTML='<form method="dialog"><h3>촬영 위치</h3><p>휴대폰을 안정적인 곳에 세우고 화면 가운데에 서 주세요. 머리와 발이 함께 보이도록 거리를 조절해 주세요.</p><p>몸이 작게 보이면 조금 가까이, 다리가 잘리면 조금 뒤로 이동해 주세요. 조명은 몸 앞쪽이 좋아요.</p><button value="ok" class="btn btn-primary">확인</button></form>';d.onclose=null;d.showModal();
  }

  _modernHUD() {
    const snap=this.tracker.snapshot(), resting=!!this.restUntil && (this.plan?this.pt.stage==='rest':snap.state==='search' && !snap.pending);
    if (this.phase==='work' && !this.isFile && !resting && !snap.present && ['reps','hold'].includes(snap.state) && performance.now()>(this.resumeGrace||0)) {
      this.pause('몸이 화면에서 벗어났어요');
      return;
    }
    this.el.screen.dataset.phase=this.phase==='paused'?'paused':resting?'rest':'work';
    const item=this.plan?.item;
    const current=snap.exercise || (item && !isTimer(item)?item.exercise:this.session.candidates?.length===1?this.session.candidates[0]:null);
    $('wo-heading').textContent=this.phase==='paused'?(this.pauseReason||'일시정지'):resting?'휴식':item&&isTimer(item)?item.name:current?exName(current):'자유 운동';
    $('wo-subheading').textContent=resting?`${this.session.sets.length}세트 완료`:this.plan&&!isTimer(item)?`${this.plan.setNo} / ${item.sets}세트`:current?`${(this.setCount[current]||0)+1}세트`:'동작을 인식해 횟수를 셉니다.';
    if(this.phase==='paused'){this.el.status.textContent=this.pauseReason?'자리를 잡고 이어서 운동하세요':'기록을 멈췄어요';this.el.framing.hidden=true;}
    else if(!resting && snap.present && !this.isFile){this.el.status.textContent='인식 중';}
    // Position advice has one owner; keep the separate cue and repetition count readable.
    if(!resting && !this.el.framing.hidden)this._setText('message','');
    this.primary.disabled=false;
    const progress=$('wo-progress');progress.hidden=!item || isTimer(item) || isTimed(item) || resting;
    if(!progress.hidden){progress.max=this.plan.target||1;progress.value=Math.min(progress.max,this._ptCount(snap));}
    this.primary.innerHTML=this.phase==='paused'?`${icon('play')} 이어서 운동`:resting?'다음 세트 시작':`${icon('pause')} 일시정지`;
    $('btn-set-end').hidden=resting || this.phase==='paused' || this.isFile || !!(item&&isTimer(item));
    $('btn-camera-flip').hidden=true;$('btn-camera-help').hidden=true;
    const last=this.session.sets.at(-1);$('wo-rest-record').hidden=!resting || !last;
    if(resting && last){
      $('wo-last-name').textContent=`${exName(last.exercise)} · ${last.plan?.setNo||this.setCount[last.exercise]}세트`;
      $('wo-last-value').textContent=`${last.kind==='hold'?last.holdSec+'초':last.reps+'회'}${last.edited?' · 직접 수정':''}`;
      $('wo-rest-next').textContent=item?(isTimer(item)?item.name:`${exName(item.exercise)} · ${this.plan.setNo}/${item.sets}세트 · 목표 ${this._targetWords(item)}`):`${exName(last.exercise)} · 다음 세트`;
      this._setText('message',store.settings().handGesture?'두 손을 2초 들면 휴식이 끝나요.':'준비되면 다음 세트를 시작하세요.');
    }
    this.el.plan.hidden=true;
    if(!this.plan && snap.state==='search' && !resting && !snap.pending)this._setText('count','0');
    this.el.restActions.hidden=!resting;
    this.el.camera.hidden=true;
  }

  /* ---------- 오늘의 루틴(PT 모드) ---------- */

  // 루틴용 추적기: 그 운동만 보고 1회째부터 센다. 멈춰도 세트를 스스로 나누지 않는다(끝은 목표 달성·버튼·오래 멈춤으로)
  _makeTracker(exId) {
    const st = store.settings();
    if (this.tracker?.log?.length) this.prevLogs = [...(this.prevLogs || []), ...this.tracker.log].slice(-3000); // 진단 기록용
    const tr = new Tracker({ fixed: exId, lockReps: st.lockReps, idleSec: 600, minSetReps: 1, holdMin: 1 });
    if (this.appliedUp) tr.setCameraUp(this.appliedUp);
    return tr;
  }

  _targetWords(it) {
    if (isTimer(it)) return fmtMinSec(it.sec);
    if (isTimed(it)) return `${it.workSec}초 동안`;
    return isHold(it.exercise) ? `${it.holdSec}초` : `${it.reps}회`;
  }

  // 준비운동(시간만 재는 칸)이면 그다음 운동을 봐 둔다 — 자리 잡기 확인용
  _exFor(i) {
    const items = this.plan.items;
    for (let k = i; k < items.length; k++) if (!isTimer(items[k])) return items[k].exercise;
    return items[i]?.exercise;
  }

  // 지금 세트에서 한 만큼 (이미 끊긴 추적기 세트 + 진행 중)
  _ptCount(snap = this.tracker.snapshot()) {
    if (isTimer(this.plan.item)) return 0;
    const hold = isHold(this.plan.item.exercise);
    const cur = hold ? (snap.state === 'hold' ? snap.holdSec : 0) : (snap.state === 'reps' ? snap.count : 0);
    return this.pt.accum + cur;
  }

  _onEventPT(e) {
    const pt = this.pt;
    if (!this.plan.item || isTimer(this.plan.item)) return; // 준비운동·마무리 중엔 세지 않는다
    const cueText = this.cfg.cues && e.cue ? e.cue.text : '';
    const now = performance.now();
    switch (e.type) {
      case 'setStart':
        if (pt.stage === 'rest') this._ptEndRest(true); // 쉬는 중에 시작하면 휴식을 끝내고 그대로 센다
        pt.lastActiveAt = now;
        if (EXERCISE_BY_ID[e.exercise]?.kind === 'hold') {
          this.voice.say(pt.accum ? '다시 버텨요' : `시작! ${this.plan.target}초 버티세요`, { interrupt: true });
        } else {
          this._ptSayCount(pt.accum + e.count, cueText);
          this._bump();
        }
        if (cueText) this._showCue(e.cue.text);
        break;
      case 'rep':
        if (pt.stage === 'rest') this._ptEndRest(true);
        pt.lastActiveAt = now;
        this._ptSayCount(pt.accum + e.count, cueText);
        this._bump();
        if (cueText) this._showCue(e.cue.text);
        break;
      case 'holdTick': {
        pt.lastActiveAt = now;
        const sec = pt.accum + e.sec;
        const left = this.plan.target - sec;
        if (left === 10 && this.plan.target >= 20) this.voice.say('10초 남았어요');
        else if (left > 0 && left <= 3) this.voice.say(nativeKorean(left), { interrupt: true });
        else if (left > 10 && sec % 10 === 0) this.voice.say(`${sec}초`);
        break;
      }
      case 'cue':
        if (this.cfg.cues) { this.voice.say(e.text); this._showCue(e.text); }
        break;
      case 'setEnd': // 추적기가 세트를 끊었다(화면 밖으로 나감·버티기 자세 무너짐) → 이번 세트에 이어 붙인다
        pt.recs.push(e.set);
        pt.accum += e.set.kind === 'hold' ? (e.set.holdSec || 0) : (e.set.reps || 0);
        if (e.set.tempo) this.lastTempo = { exercise: e.set.exercise, list: e.set.tempo, sum: e.set.tempoSum };
        break;
      default:
        break;
    }
  }

  // 숫자 + PT 추임새: 3개 남았을 때, 하나 남았을 때, 목표 달성
  _ptSayCount(n, cueText) {
    if (isTimed(this.plan.item)) { this.voice.count(n, cueText); return; } // 인터벌은 시간이 목표
    const left = this.plan.target - n;
    let extra = cueText;
    if (!extra) {
      if (left === 3 && this.plan.target >= 8) extra = '세 개 남았어요';
      else if (left === 1) extra = '하나 더';
      else if (left === 0) extra = '완료!';
    }
    this.voice.count(n, extra);
  }

  // 매 0.25초: 목표를 채웠는지, 목표 전에 오래 멈췄는지, 시작을 안 하고 있는지
  _ptTick(now) {
    const pt = this.pt;
    if (!this.plan || this.plan.finished || pt.stage !== 'work') return;
    const cur = this.plan.item;
    if (isTimer(cur)) return this._ptTimerTick(now, cur);
    if (isTimed(cur)) return this._ptTimedTick(now, cur);
    const snap = this.tracker.snapshot();
    const hold = isHold(this.plan.item.exercise);
    if (hold && snap.state === 'hold') pt.lastActiveAt = now;
    const n = this._ptCount(snap);
    const tgt = this.plan.target;
    if (n >= tgt) {
      // 반복 운동은 마지막 회가 끝까지 올라올 1.2초를 기다린다(그 사이 더 하면 그것까지 기록)
      if (hold || now - pt.lastActiveAt > 1200) this._ptComplete();
      return;
    }
    const stopSec = Math.max(8, this.cfg.setEndSec || 0);
    if (n > 0 && !snap.midRep && now - pt.lastActiveAt > stopSec * 1000) {
      this._ptComplete({ partial: true });
      return;
    }
    if (n === 0 && !pt.reminded && now - pt.readyAt > 45000) {
      pt.reminded = true;
      const it = this.plan.item;
      this.voice.say(`${exName(it.exercise)} ${this._targetWords(it)} 시작하세요. ${EXERCISE_BY_ID[it.exercise]?.tip ?? ''}`);
    }
  }

  // 준비운동·마무리: 시간을 나눠 동작을 바꿔 가며 안내 (세지 않음)
  _ptTimerTick(now, it) {
    const pt = this.pt;
    if (pt.timerStart == null) { pt.timerStart = now; pt.stepSaid = -1; }
    const el = (now - pt.timerStart) / 1000;
    const steps = TIMER_STEPS[it.timer] || [];
    const k = Math.min(steps.length - 1, Math.floor((el / it.sec) * steps.length));
    if (steps.length && k !== pt.stepSaid) {
      pt.stepSaid = k;
      this.voice.say(k === 0 ? `${it.name} ${fmtMinSec(it.sec)}. ${steps[0]}` : `다음, ${steps[k]}`);
    }
    if (el >= it.sec) this._ptComplete();
  }

  // 인터벌: (준비) → '시작!' → 정해진 시간 동안 세고 → '그만!'
  _ptTimedTick(now, it) {
    const pt = this.pt;
    if (pt.workEnd == null) {
      if (pt.leadUntil == null) { // 쉬는 시간 없이 바로 이어지면 3초 준비
        pt.leadUntil = now + 3500;
        this.voice.say(`${exName(it.exercise)} ${it.workSec}초. 셋, 둘, 하나`);
      }
      if (now < pt.leadUntil) return;
      pt.workEnd = now + it.workSec * 1000;
      pt.timeSaid = new Set();
      pt.lastActiveAt = now;
      this.voice.beep(990, 0.25);
      this.voice.say('시작!', { interrupt: true });
      return;
    }
    const left = (pt.workEnd - now) / 1000;
    if (left <= 10 && left > 9 && it.workSec >= 20 && !pt.timeSaid.has(10)) { pt.timeSaid.add(10); this.voice.say('10초 남았어요'); }
    for (const n of [3, 2, 1]) {
      if (left <= n && left > n - 1 && !pt.timeSaid.has(n)) { pt.timeSaid.add(n); this.voice.beep(n === 1 ? 990 : 880, 0.07); }
    }
    if (left <= 0) {
      this.voice.beep(660, 0.35);
      this._ptComplete();
    }
  }

  /**
   * 지금 세트를 끝내고 기록 → 다음 세트·운동 준비(휴식).
   * manual = 사용자가 실제 인식 횟수로 종료, partial = 목표 전에 멈춤, final = 운동 종료(다음 준비 안 함)
   */
  _ptComplete({ manual = false, partial = false, final = false } = {}) {
    const pt = this.pt;
    for (const e of this.tracker.finish()) if (e.type === 'setEnd') this._onEventPT(e);
    const item = this.plan.item;
    const setNo = this.plan.setNo;
    const tgt = this.plan.target;
    const timer = isTimer(item), timed = isTimed(item);
    const done = timer ? tgt : pt.accum;
    if (final && (timer || done <= 0)) return; // 운동을 끝낼 때 시작도 안 한 세트는 남기지 않는다
    if (!timer && (done > 0 || manual)) this._recordPlanSet({ item, setNo, tgt, done, manual, timed, recs: pt.recs });
    const res = this.plan.completeSet(done, { manual });
    pt.accum = 0;
    pt.recs = [];
    pt.reminded = false;
    pt.timerStart = null;
    pt.workEnd = null;
    pt.leadUntil = null;
    if (final) return;
    if (res.finished) { this._ptFinish(); return; }
    if (res.exerciseDone) {
      this.tracker = this._makeTracker(this._exFor(this.plan.i));
      if (!timer) { // 운동이 바뀌면 카메라 자리를 다시 확인 (준비운동 뒤는 이미 자리를 잡았으니 그대로)
        this.frameOkAt = null;
        this.frameGoodSince = null;
      }
    }
    // 음성: 이번 세트 결과 (+ 쉬는 시간이 있으면 휴식·다음 안내, 없으면 다음 시작 안내는 _ptEndRest 가)
    const nx = this.plan.item;
    const what = timed ? `${done}회` : isHold(item.exercise) ? `${Math.round(done)}초` : `${done}회`;
    let msg = timer ? `${item.name} 끝.`
      : timed ? `그만! ${what}.` : partial ? `${what}로 기록할게요.` : manual ? '좋아요, 완료.' : `좋아요! ${setNo}세트 끝.`;
    if (res.exerciseDone && !timer) msg += ` ${exName(item.exercise)} 끝.`;
    if (res.rest > 0) {
      msg += ` ${res.rest}초 쉬세요.`;
      msg += isTimer(nx) ? ` 다음은 ${nx.name}.`
        : res.exerciseDone ? ` 다음은 ${exName(nx.exercise)} ${this._targetWords(nx)} ${nx.sets}세트. ${EXERCISE_BY_ID[nx.exercise]?.tip ?? ''}`
          : ` 다음은 ${this.plan.setNo}세트, ${this._targetWords(nx)}.`;
    }
    this.voice.say(msg);
    pt.stage = 'rest';
    if (res.rest > 0) {
      this.restUntil = performance.now() + res.rest * 1000;
      this.restSaid = new Set();
    } else this._ptEndRest(false);
  }

  _ptEndRest(early) {
    const now = performance.now();
    const pt = this.pt;
    this.restUntil = 0;
    pt.stage = 'work';
    pt.readyAt = now;
    pt.lastActiveAt = now;
    pt.timerStart = null;
    pt.workEnd = null;
    const it = this.plan.item;
    // 인터벌: 쉬다가 먼저 움직이면 바로, 휴식이 끝나서면 이름을 말할 1.5초 뒤 '시작!'
    pt.leadUntil = isTimed(it) ? now + (early ? 0 : 1500) : null;
    if (early || isTimer(it)) return; // 준비운동·마무리는 _ptTimerTick 이 안내
    this.voice.beep(660, 0.25);
    const newEx = this.plan.setNo === 1;
    const tip = newEx ? ` ${EXERCISE_BY_ID[it.exercise]?.tip ?? ''}` : '';
    if (isTimed(it)) { this.voice.say(`${exName(it.exercise)} ${this.plan.setNo}세트, ${it.workSec}초.`); return; }
    this.voice.say(`${exName(it.exercise)} ${this.plan.setNo}세트, ${this._targetWords(it)} 시작하세요.${tip}`);
  }

  // '다음 운동' 버튼: 하던 세트는 한 만큼 기록하고 남은 세트를 건너뛴다
  _ptSkip() {
    if (!this.plan || this.plan.finished || this.phase!=='work') return;
    const exBefore = this.plan.i;
    if (this.pt.stage === 'work' && this._ptCount() > 0) this._ptComplete({ final: true });
    if (this.plan.i === exBefore) this.plan.skipExercise();
    this.restUntil = 0;
    if (this.plan.finished) { this._ptFinish(); return; }
    this.tracker = this._makeTracker(this._exFor(this.plan.i));
    this.frameOkAt = null;
    this.frameGoodSince = null;
    this.pt.stage = 'work';
    this.pt.timerStart = null;
    this.pt.workEnd = null;
    this.pt.leadUntil = null;
    this.pt.accum = 0;
    this.pt.recs = [];
    this.pt.readyAt = performance.now();
    const it = this.plan.item;
    if (isTimer(it)) this.voice.say(`다음, ${it.name}`, { interrupt: true });
    else this.voice.say(`다음 운동, ${exName(it.exercise)} ${this._targetWords(it)} ${it.sets}세트. ${EXERCISE_BY_ID[it.exercise]?.tip ?? ''}`, { interrupt: true });
    this._hud();
  }

  _ptFinish() {
    this.pt.stage = 'done';
    setTimeout(() => this.end(), 300);
  }

  _recordPlanSet({ item, setNo, tgt, done, manual, timed = false, recs }) {
    const ex = item.exercise;
    const hold = isHold(ex);
    const nowT = this.clock.elapsed(performance.now());
    const issues = {};
    for (const r of recs) for (const [k, v] of Object.entries(r.issues || {})) issues[k] = (issues[k] || 0) + v;
    const tempo = recs.flatMap((r) => r.tempo || []);
    const good = hold ? null : recs.reduce((a, r) => a + (r.good ?? 0), 0);
    const startT = recs.length ? recs[0].startT : nowT;
    const endT = recs.length ? recs[recs.length - 1].endT : nowT;
    const rec = {
      id: store.uid(), exercise: ex, kind: hold ? 'hold' : 'reps',
      reps: hold ? null : done, holdSec: hold ? Math.round(done) : null, good, issues,
      weight: item.weight ?? store.lastWeight(ex),
      start: Math.round(this.wallT0 + this.clock.wallOffset(startT)), end: Math.round(this.wallT0 + this.clock.wallOffset(endT)),
      plan: { item: this.plan.i, setNo, target: tgt, manual, ...(timed ? { timed: true } : {}) },
    };
    if (tempo.length) { rec.tempo = tempo; rec.tempoSum = tempoSummary(tempo); }
    this.session.sets.push(rec);
    this.session.planProgress = { ...this.plan.progress(), setsLogged: this.plan.log.length + 1 };
    store.upsertSession(this.session);
    this.setCount[ex] = (this.setCount[ex] || 0) + 1;
    this._renderSets();
  }

  async _openSource(source, st = store.settings()) {
    const openingSession=this.session;
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
      const stream = await openCamera(st);
      const info = await widenCamera(stream, st.cameraWide);
      if(this.session!==openingSession){stream.getTracks().forEach(t=>t.stop());throw Object.assign(new Error('카메라 준비 취소'),{name:'AbortError'});}
      this.stream = stream;
      this.camInfo = info;
      this.el.camera.textContent = cameraSummary(this.camInfo);
      this.el.camera.hidden = false;
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
  // 배터리·발열: AI 분석은 초당 analysisFps 장만(기본 15 — 인식 기준을 맞춘 영상도 초당 15장이라 정확도는 같다).
  // 화면은 새 카메라 프레임마다 그리되 뼈대는 마지막 분석 결과를 쓴다(미리보기는 부드럽게).
  _schedule() {
    this.raf = requestAnimationFrame(() => {
      if (!this.running) return;
      const v = this.el.video;
      if (v.currentTime !== this.lastVT) {
        const now = performance.now();
        if (now - this.lastInferAt >= this.inferEvery - 4) {
          this.lastInferAt = now;
          this._process(v.currentTime);
        } else {
          this.lastVT = v.currentTime;
          this._draw(this.lastLm);
        }
      }
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
    const t = this.isFile ? mediaTime : this.phase === 'prepare' || this.phase === 'countdown' ? (now-this.t0)/1000 : this.clock.elapsed(now);
    if (this.phase === 'paused') { this.lastLm=lm; this._draw(lm); return; }
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
    this.lastLm = lm;
    this._draw(lm);
    if (this.phase === 'work') for (const e of events) this._onEvent(e);
    this._hud();
  }

  _onEvent(e) {
    if (!this.isFile && e.type !== 'holdTick' && e.type !== 'tempo') {
      this.diag.event(e.t ?? this.tracker.t, e.type, e.type === 'setEnd' ? { exercise: e.set.exercise, reps: e.set.reps ?? null, holdSec: e.set.holdSec ?? null }
        : { exercise: e.exercise ?? null, count: e.count ?? null });
    }
    if (this.plan) return this._onEventPT(e);
    if (this.quiet && e.type !== 'setEnd') return this._onEventQuiet(e);
    const name = exName(e.exercise);
    const cueText = this.cfg.cues && e.cue ? e.cue.text : '';
    switch (e.type) {
      case 'personFound': // 인사는 자리 잡기 확인('좋아요. 이 자리에서 시작하세요')이 맡는다
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
    const toMs = (t) => this.isFile ? this.session.start+t*1000 : this.wallT0+this.clock.wallOffset(t);
    const rec = {
      id: store.uid(), exercise: s.exercise, kind: s.kind,
      reps: s.reps ?? null, holdSec: s.holdSec ?? null, good: s.good ?? null, issues: s.issues || {},
      weight: store.lastWeight(s.exercise), start: Math.round(toMs(s.startT)), end: Math.round(toMs(s.endT)),
    };
    if (s.tempo) { rec.tempo = s.tempo; rec.tempoSum = s.tempoSum; }
    this.session.sets.push(rec);
    store.upsertSession(this.session);
    this.setCount[s.exercise] = (this.setCount[s.exercise] || 0) + 1;
    this.lastEx = s.exercise;
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
    if (this.phase==='prepare' || this.phase==='countdown') {
      if(this.phase==='countdown' && now>=this.countdownUntil) { if(this.ready) this.beginWorkout(); else this.phase='prepare'; }
      this._hud();return;
    }
    if (this.phase==='paused') { this._hud();return; }
    if (!this.isFile && this.running) this._applyTilt(now);
    if (this.plan && this.running) this._ptTick(now);
    if (this.running && !this.isFile) this._gestureTick(now);
    const elapsed = this.isFile ? (this.progress || 0) * (this.el.video.duration || 0) : this.clock.elapsed(now);
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
        if (this.plan) this._ptEndRest(false);
        else {
          this.restUntil = 0;
          this.voice.beep(660, 0.25);
          this.voice.say('휴식 끝. 다음 세트를 시작하세요.');
        }
      }
      this._hud();
    }
    if (this.cueUntil && now > this.cueUntil) {
      this.cueUntil = 0;
      this.el.cue.hidden = true;
    }
  }

  _hud() {
    if (!this.tracker) return;
    if (this.phase==='prepare' || this.phase==='countdown') { this._prepareHUD(); return; }
    if (this.phase==='paused') { this._modernHUD(); return; }
    const snap = this.tracker.snapshot();
    const now = performance.now();
    const active = snap.state === 'reps' || snap.state === 'hold';
    const frame = this.isFile ? null : this._framing(snap);
    const shown = this.frameGuide.update(frame, now);
    this.el.framing.hidden = !shown || this.isFile;
    if (shown) this.el.framing.textContent = shown.text;
    let dot = 'warn', status, message = '';
    if (this.isFile) {
      status = `영상 분석 중 ${Math.round((this.progress || 0) * 100)}%`;
      dot = snap.present ? 'ok' : 'warn';
      if (!snap.present) message = '사람이 안 보이는 구간';
    } else if (!snap.present) {
      status = snap.raw ? '몸이 덜 보여요' : '사람을 찾는 중';
      message = frame?.text || '전신이 보이게 2~3m 뒤로 가 주세요';
    } else {
      status = '인식 중';
      dot = shown && shown.code !== 'feet' ? 'warn' : 'ok';
      message = frame?.text || '';
    }
    this.el.dot.className = `dot ${dot}`;
    this._setText('status', status);
    if (!active) this._sayFraming(frame, now);
    this._frameCheck(snap, frame, now);
    if (this.plan) {
      this._hudPT(snap, message, now);
      this._drawAdjust();
      this._drawTempo(snap);
      this._liftCenter(); // 시범 그림이 생기고 없어지며 아래 패널 높이가 바뀐다
      if (this.cfg.debug) this._debug(snap);
      this._modernHUD();
      return;
    }

    const count = this.el.count;
    this.el.restActions.hidden = !(this.restUntil && !active && !snap.pending);
    if (active) {
      const no = (this.setCount[snap.exercise] || 0) + 1;
      this._setText('exercise', `${exName(snap.exercise)} · ${no}세트`);
      this._setText('count', snap.state === 'hold' ? `${Math.floor(snap.holdSec)}초` : String(snap.count));
      count.classList.remove('rest', 'tentative');
      // 멈춘 지 1.5초가 넘으면 '몇 초 더 멈추면 이 세트를 기록'하는지 보여준다 (설정 → 세트 끝 판정)
      const left = snap.setEndIn;
      // 평소 반복 간격보다 오래 멈췄을 때만 (느린 운동은 반복 사이에도 2~3초 쉰다)
      const quietFor = snap.idleSec - (left ?? 0);
      const hint = left != null && left > 0 && quietFor > Math.max(1.5, 1.3 * (snap.repGap || 0)) ? `${Math.ceil(left)}초 더 쉬면 세트 기록` : '';
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
      const g = this.gesture && !this.gesture.done ? `🙌 ${Math.max(0, 2 - (now - this.gesture.since) / 1000).toFixed(1)}초 더 들고 있으면 휴식 끝` : '';
      this._setText('message', g || '그냥 시작하거나 두 손을 머리 위로 2초 들면 휴식 끝');
    } else {
      this._setText('exercise', '');
      this._setText('count', '');
      count.classList.remove('rest', 'tentative');
      this._setText('message', message || (this.session.sets.length ? '다음 운동을 시작하세요' : '운동을 시작하세요'));
    }
    this._drawAdjust();
    this._drawTempo(snap);
    if (this.cfg.debug) this._debug(snap);
    this._modernHUD();
  }

  // 손 제스처: 쉬는 동안 두 손을 머리 위로 쭉 뻗고 2초 → 휴식 끝 (폰을 만지지 않고).
  // 팔을 머리 위로 드는 운동(풀업·랫풀다운·프레스 등)을 앞두고는 바를 잡는 동작과 헷갈려서 끈다
  _gestureTick(now) {
    const resting = this.restUntil > 0 && (!this.plan || this.pt?.stage === 'rest');
    const OVERHEAD = ['pullup', 'latpulldown', 'hanglegraise', 'press', 'triext', 'jumpingjack', 'lateral', 'frontraise', 'uprightrow'];
    const ex = this.plan ? this.plan.item?.exercise : this.lastEx;
    if (!store.settings().handGesture || !resting || OVERHEAD.includes(ex)) { this.gesture = null; return; }
    const f = this.tracker.snapshot().features;
    const up = isHandsUp(f);
    if (!up) { this.gesture = null; return; }
    this.gesture ??= { since: now };
    const held = (now - this.gesture.since) / 1000;
    if (held >= 2 && !this.gesture.done) {
      this.gesture.done = true;
      this.voice.beep(990, 0.2);
      if (this.plan) {
        this.voice.say('휴식 끝! 시작하세요.', { interrupt: true });
        this._ptEndRest(true);
      } else {
        this.restUntil = 0;
        this.voice.say('휴식 끝! 다음 세트를 시작하세요.', { interrupt: true });
      }
      this._hud();
    }
  }

  // 휴식 중 조정: 루틴은 다음 세트(남은 세트 전부)의 무게·목표, 자유 운동은 방금 한 운동의 다음 세트 무게
  _adjustTarget() {
    if (this.plan && this.pt?.stage === 'rest' && this.plan.item) return { ex: this.plan.item.exercise, item: this.plan.item };
    if (!this.plan && this.restUntil && this.lastEx) return { ex: this.lastEx, item: null };
    return null;
  }

  _adjust(kind, d) {
    const tg = this._adjustTarget();
    if (!tg) return;
    const { ex, item } = tg;
    if (kind === 'w') {
      const w = item?.weight ?? store.lastWeight(ex) ?? 0;
      const step = weightStep(ex, d < 0 ? Math.max(0, w - 0.01) : w);
      const nw = Math.max(0, Math.round((w + d * step) * 10) / 10);
      if (item) item.weight = nw || undefined;
      store.rememberWeight(ex, nw || null);
    } else if (item) {
      if (isHold(ex)) item.holdSec = Math.max(5, (item.holdSec || 30) + d * 5);
      else item.reps = Math.max(1, (item.reps || 10) + d);
    }
    this.voice.beep(d > 0 ? 990 : 660, 0.05);
    this._hud();
  }

  _drawAdjust() {
    const tg = this._adjustTarget();
    this.el.adjust.hidden = !tg;
    if (!tg) return;
    const { ex, item } = tg;
    const w = item?.weight ?? store.lastWeight(ex);
    this._setText('adjWVal', w ? `${w}kg` : '무게 없음');
    this.el.adjR.hidden = !item;
    if (item) this._setText('adjRVal', isHold(ex) ? `${item.holdSec}초` : `${item.reps}회`);
  }

  // 동작 시범(막대 인형): 쉬는 동안엔 다음에 할 운동, 시작 전(0회)엔 지금 운동
  _setDemo(exId) {
    const ok = exId && hasDemo(exId);
    if (this.demoEx === (ok ? exId : null)) return;
    this.stopDemo?.();
    this.stopDemo = null;
    this.demoEx = ok ? exId : null;
    this.el.demo.hidden = !ok;
    if (ok) this.stopDemo = playDemo(this.el.demo, exId);
  }

  // PT 화면: 위엔 전체 진행, 가운데엔 지금 운동·세트와 '한 횟수 / 목표', 아래엔 다음 운동과 수동 버튼
  _hudPT(snap, message, now) {
    const pl = this.plan;
    const pt = this.pt;
    const count = this.el.count;
    const prog = pl.progress();
    if (pl.finished || pt.stage === 'done') {
      this._setText('planSets', `전체 ${prog.setsDone}/${prog.setsTotal}세트`);
      this.el.planFill.style.width = '100%';
      this._setText('exercise', '루틴 완료');
      this._setText('count', '완료');
      this._setText('message', '수고했어요!');
      count.classList.remove('rest', 'tentative', 'done');
      this.el.target.hidden = true;
      this.el.next.hidden = true;
      return;
    }
    const it = pl.item;
    const name = isTimer(it) ? it.name : exName(it.exercise);
    const exItems = pl.items.filter((x) => !isTimer(x));
    const exNo = pl.items.slice(0, pl.i + 1).filter((x) => !isTimer(x)).length;
    this._setText('planStep', isTimer(it) ? name : `운동 ${exNo}/${exItems.length} · ${name}`);
    this._setText('planSets', `전체 ${prog.setsLogged}/${prog.setsTotal}세트`);
    this.el.planFill.style.width = `${Math.round((100 * prog.setsLogged) / Math.max(1, prog.setsTotal))}%`;
    const unit = !isTimer(it) && !isTimed(it) && isHold(it.exercise) ? '초' : '';
    const nx = pl.peekNext();
    const nxName = (x) => (isTimer(x) ? x.name : exName(x.exercise));
    const nxText = nx ? `${nx.newExercise ? nxName(nx.item) : `${nx.setNo}세트`} · ${this._targetWords(nx.item)}${nx.newExercise && !isTimer(nx.item) ? ` × ${nx.item.sets}세트` : ''}` : '';
    this.el.restActions.hidden = pt.stage !== 'rest';
    this.el.planDoneBtn.hidden = pt.stage !== 'work';
    if (pt.stage === 'rest') {
      // 쉬는 동안: 남은 시간 + 다음에 할 것(운동이 바뀌면 카메라 자리 안내)
      const left = Math.max(0, Math.ceil((this.restUntil - now) / 1000));
      this._setText('exercise', '휴식');
      this._setText('count', fmtClock(left));
      count.classList.remove('tentative', 'done');
      count.classList.add('rest');
      this.el.target.hidden = true;
      const tip = pl.setNo === 1 && !isTimer(it) ? EXERCISE_BY_ID[it.exercise]?.tip : '';
      const g = this.gesture && !this.gesture.done ? `🙌 ${Math.max(0, 2 - (now - this.gesture.since) / 1000).toFixed(1)}초 더 들고 있으면 휴식 끝` : '';
      this._setText('message', g || (tip ? `📱 ${tip}` : isTimer(it) ? '쉬고 나면 시간에 맞춰 안내해요' : '바로 시작하거나 두 손을 머리 위로 2초 들면 휴식 끝'));
      const html = isTimer(it) ? `다음: <b>${esc(name)} ${this._targetWords(it)}</b>`
        : `다음: <b>${esc(name)} ${pl.setNo}/${it.sets}세트 · ${this._targetWords(it)}${it.weight ? ` · ${it.weight}kg` : ''}</b>`;
      if (this.el.nextText.innerHTML !== html) this.el.nextText.innerHTML = html;
      this._setDemo(isTimer(it) ? null : it.exercise);
      return;
    }
    if (isTimer(it)) {
      // 준비운동·마무리: 남은 시간 + 지금 동작 / 다음 동작
      const el = pt.timerStart == null ? 0 : (now - pt.timerStart) / 1000;
      const steps = TIMER_STEPS[it.timer] || [];
      const k = Math.min(steps.length - 1, Math.floor((el / it.sec) * steps.length));
      this._setText('exercise', name);
      this._setText('count', fmtClock(Math.max(0, Math.ceil(it.sec - el))));
      count.classList.remove('tentative', 'done');
      count.classList.add('rest');
      this.el.target.hidden = true;
      this._setText('message', steps[k] ? `지금: ${steps[k]}${steps[k + 1] ? ` → ${steps[k + 1]}` : ''}` : '');
      const html = nx ? `다음: <b>${esc(nxText)}</b>` : '<b>마지막이에요!</b>';
      if (this.el.nextText.innerHTML !== html) this.el.nextText.innerHTML = html;
      this._setDemo(nx && !isTimer(nx.item) ? nx.item.exercise : null);
      return;
    }
    if (isTimed(it)) {
      // 인터벌: 큰 숫자는 한 횟수, 옆에 남은 시간
      const n = Math.floor(this._ptCount(snap));
      const left = pt.workEnd == null ? null : Math.max(0, Math.ceil((pt.workEnd - now) / 1000));
      this._setText('exercise', `${name} · ${pl.setNo}/${it.sets}세트`);
      this._setText('count', `${n}`);
      this._setText('target', left == null ? '준비' : `⏱${left}`);
      this.el.target.hidden = false;
      count.classList.remove('rest', 'tentative', 'done');
      this._setText('message', message || (left == null ? `${it.workSec}초 동안 최대한 많이` : `${left}초 남았어요`));
      const html = nx ? `다음: <b>${esc(nxText)}</b>` : '<b>마지막 세트예요!</b>';
      if (this.el.nextText.innerHTML !== html) this.el.nextText.innerHTML = html;
      this._setDemo(left == null ? it.exercise : null);
      return;
    }
    const n = Math.floor(this._ptCount(snap));
    const tgt = pl.target;
    this._setText('exercise', `${name} · ${pl.setNo}/${it.sets}세트`);
    this._setText('count', `${n}${unit}`);
    this._setText('target', `/${tgt}${unit||'회'}`);
    this.el.target.hidden = false;
    count.classList.remove('rest', 'tentative');
    count.classList.toggle('done', n >= tgt);
    const left = tgt - n;
    let msg = message;
    if (!msg) {
      if (n >= tgt) msg = '완료! 잠깐 쉬어요';
      else if (n === 0) msg = `${it.weight ? `${it.weight}kg · ` : ''}${PLAN_META[it.exercise]?.note ? `${PLAN_META[it.exercise].note} · ` : ''}시작하면 알아서 세요`;
      else msg = `${left}${unit || '회'} 남았어요`;
    }
    this._setText('message', msg);
    const html = n === 0 && hasDemo(it.exercise)
      ? `<b>${esc(name)}</b> 이렇게 해요${nx ? `<br><span class="sub">다음: ${esc(nxText)}</span>` : ''}`
      : nx ? `다음: <b>${esc(nxText)}</b>` : '<b>마지막 세트예요!</b>';
    if (this.el.nextText.innerHTML !== html) this.el.nextText.innerHTML = html;
    this._setDemo(n === 0 ? it.exercise : null);
  }

  // 자리 잡기: 첫 세트 전(루틴은 운동이 바뀔 때마다) 화면 테두리 색으로 구도를 알려준다.
  // 주황 = 몸이 덜 보임(이유는 화면·음성 안내), 1.5초 동안 잘 보이면 초록 + "좋아요" 한 번, 2.5초 뒤 사라짐
  _frameCheck(snap, frame, now) {
    const el = this.el.frame;
    const busy = snap.state !== 'search' || (this.plan && this.pt?.stage === 'work'
      && (this._ptCount(snap) > 0 || (isTimed(this.plan.item) && this.pt.workEnd != null)));
    if (this.isFile || busy || (this.frameOkAt && now - this.frameOkAt > 2500)) { el.hidden = true; return; }
    el.hidden = false;
    if (this.frameOkAt) { el.className = 'wo-frame ok'; return; }
    const good = snap.present && (!frame || frame.code === 'feet');
    if (good) {
      this.frameGoodSince ??= now;
      if (now - this.frameGoodSince > 1500) {
        this.frameOkAt = now;
        this.voice.say(this.restUntil ? '자리 좋아요.' : '좋아요. 이 자리에서 시작하세요.');
      }
    } else this.frameGoodSince = null;
    el.className = `wo-frame ${good ? 'ok' : 'bad'}`;
  }

  // 화면 구도: 안 보이는 부위에 따라 어떻게 하면 되는지. speak = 소리로도 알려줄 만큼 중요한지
  _framingOptions(snap) {
    const ex = EXERCISE_BY_ID[this.tracker.o.fixed || snap.exercise];
    const upperBody = ex && ['팔', '등', '가슴·어깨'].includes(ex.group);
    return { upperBody, bothArms: ex && ['fly', 'reversefly'].includes(ex.id) };
  }
  _framing(snap) { return framingIssue(snap, this._framingOptions(snap)); }

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
    // 가로 화면에선 아래쪽 안내가 오른쪽 기둥으로 가므로 들어올릴 필요가 없다
    const h = matchMedia('(orientation: landscape)').matches ? 0 : this.el.bottom.offsetHeight;
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
  /** session: 저장소의 이 운동 기록(요약 화면에서 고친 세트·정답 포함), 없으면 운동 끝날 때의 기록 */
  exportDiag(note, session = null) {
    const s = session || this.lastSession;
    return this.diag.exportFile({
      note,
      sets: s?.sets || this.tracker?.sets || [],
      truth: corrections(s, exName),
      log: [...(this.prevLogs || []), ...(this.tracker?.log || [])].slice(-1500),
      extra: { fps: this.fps, delegate: this.landmarker?.delegate ?? null, tilt: this.lastTiltDeg ?? null, wallT0: this.wallT0 ?? null },
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
    // 세로 화면에서 남는 위아래 공간은 아래로 몰아 큰 숫자·안내가 사람을 가리지 않게(영상은 위쪽 상태 줄 바로 아래)
    const topInset = H;
    const ox = (W - v.videoWidth * scale) / 2;
    const oy = Math.min((H - v.videoHeight * scale) / 2, topInset);
    g.drawImage(v, ox, oy, v.videoWidth * scale, v.videoHeight * scale);
    if (!lm || !this.cfg.debug) return;
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
    const wasRunning = this.running && (this.phase==='work' || this.phase==='paused');
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    clearInterval(this.ticker);
    if (wasRunning && this.plan && !this.plan.finished && this.pt?.stage === 'work') this._ptComplete({ final: true }); // 하던 세트까지
    else if (wasRunning && !this.plan) for (const e of this.tracker.finish()) this._onEvent(e);
    if (this.plan) this.session.planProgress = this.plan.progress();
    this.voice.stop();
    if (this.session.sets.length) {
      this.session.end = Date.now();
      if (!this.isFile) this.session.activeSec = Math.round(this.clock.elapsed(performance.now()));
      if (this.isFile) {
        const last = this.session.sets[this.session.sets.length - 1];
        this.session.end = last.end;
      }
      store.upsertSession(this.session);
      const pp = this.session.planProgress;
      this.voice.say(this.isFile ? '분석이 끝났어요.'
        : this.plan ? (this.plan.finished ? `오늘 루틴 끝! ${pp.setsDone}세트 했어요. 수고했어요.` : `루틴을 여기까지 했어요. ${pp.setsDone}세트, 수고했어요.`)
          : '운동 끝. 수고했어요!');
    } else {
      store.deleteSession(this.session.id);
    }
    const done = this.session.sets.length ? this.session : null;
    this.lastSession = this.session;
    this._close();
    this.onDone(done);
  }

  _close() {
    this.running = false;
    this._setDemo(null);
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
    document.querySelectorAll('.screen.page').forEach(page=>page.inert=false);
    this.session = null;
    this.phase = 'closed';
  }
}
