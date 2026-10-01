// 안드로이드 WebView(디버그 빌드)에 크롬 개발자 도구 프로토콜로 붙어 앱을 단계별로 점검한다.
// 필수: 앱 실행·네이티브 연결, 판단 엔진, AI 모델(CPU) 로드·추론 / 참고: 카메라로 운동 화면, 뒤로가기
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { stages: [] };
const save = () => fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
const shot = (name) => {
  try { fs.writeFileSync(`${OUT}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p'], { timeout: 30000 })); } catch (e) { report[`${name}_error`] = String(e.message).slice(0, 200); }
};
setTimeout(() => { report.fatal = '전체 시간 초과'; save(); process.exit(2); }, 10 * 60 * 1000).unref();

let targets = [];
for (let i = 0; i < 20 && !targets.length; i++) {
  try { targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page'); } catch { /* 준비 중 */ }
  if (!targets.length) await sleep(1500);
}
if (!targets.length) { report.fatal = 'WebView 디버그 대상 없음'; save(); process.exit(1); }
let ws;
let id = 0;
const pending = new Map();
const connect = async () => {
  ws = new WebSocket(targets[0].webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  ws.onmessage = (m) => { const msg = JSON.parse(m.data); pending.get(msg.id)?.(msg); pending.delete(msg.id); };
  ws.onclose = () => { report.wsClosedAt = report.stages.at(-1)?.name ?? 'start'; save(); };
};
await connect();
// 모든 평가에 제한 시간: 앱 쪽 약속이 끝나지 않거나 연결이 끊겨도 점검은 계속 진행
const evaluate = (expression, ms = 60000) => new Promise((resolve) => {
  if (ws.readyState !== 1) return resolve({ error: '연결 끊김' });
  const mid = ++id;
  const timer = setTimeout(() => { pending.delete(mid); resolve({ error: '시간 초과' }); }, ms);
  pending.set(mid, (msg) => {
    clearTimeout(timer);
    const r = msg.result;
    resolve(r?.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? r.exceptionDetails.text } : r?.result?.value);
  });
  ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});
const stage = async (name, expression, ms) => {
  const t0 = Date.now();
  const value = await evaluate(expression, ms);
  report.stages.push({ name, ms: Date.now() - t0, value });
  save();
  console.log(`[${name}]`, JSON.stringify(value));
  return value;
};

const app = await stage('앱', `(async () => ({
  url: location.href, native: window.__hfpt?.isNative, platform: Capacitor.getPlatform(),
  plugins: ['TextToSpeech','App','Share','Filesystem'].filter((p) => Capacitor.isPluginAvailable(p)),
  koreanTTS: await window.__hfpt?.workout.voice.koreanAvailable(),
  webview: (navigator.userAgent.match(/Chrome\\/([\\d.]+)/) || [])[1], home: document.getElementById('btn-start-auto')?.innerText,
}))()`);

const engine = await stage('엔진', `(async () => {
  const { computeFeatures } = await import('./js/engine/features.js');
  const p = (x, y, z) => ({ x, y, z, visibility: 0.99 });
  const lm = Array.from({ length: 33 }, () => p(0.5, 0.5, 0));
  const wl = Array.from({ length: 33 }, () => p(0, 0, 0));
  Object.assign(wl, { 11: p(0.18, -0.5, 0), 12: p(-0.18, -0.5, 0), 23: p(0.1, 0, 0), 24: p(-0.1, 0, 0),
    25: p(0.1, 0.45, 0), 26: p(-0.1, 0.45, 0), 27: p(0.1, 0.9, 0), 28: p(-0.1, 0.9, 0),
    13: p(0.2, -0.22, 0), 14: p(-0.2, -0.22, 0), 15: p(0.2, 0.05, 0), 16: p(-0.2, 0.05, 0) });
  const f = computeFeatures(lm, wl);
  return { knee: Math.round(f.knee), hipH: +f.hipH.toFixed(2), torsoTilt: Math.round(f.torsoTilt) };
})()`);

const model = await stage('AI 모델(CPU)', `(async () => {
  const { createPoseLandmarker } = await import('./js/pose.js');
  const t0 = performance.now();
  const lm = await createPoseLandmarker({ model: 'full', delegate: 'CPU' });
  const loadMs = Math.round(performance.now() - t0);
  const c = document.createElement('canvas'); c.width = 480; c.height = 640;
  const g = c.getContext('2d'); g.fillStyle = '#888'; g.fillRect(0, 0, 480, 640);
  const times = [];
  for (let i = 0; i < 5; i++) { const a = performance.now(); lm.detectForVideo(c, performance.now() + i); times.push(Math.round(performance.now() - a)); }
  lm.close();
  return { loadMs, detectMs: times };
})()`, 180000);
shot('2_after_model');

// 참고 단계: 카메라로 운동 화면 (에뮬레이터 가상 카메라, CPU 호환 모드)
const cam = await stage('카메라 운동 화면', `(async () => {
  window.__hfpt.store.setSetting('gpu', false);
  document.getElementById('btn-start-auto').click();
  const w = window.__hfpt.workout;
  let s;
  for (let i = 0; i < 24; i++) {
    await new Promise((r) => setTimeout(r, 2500));
    s = { running: w.running, fps: w.fps, delegate: w.landmarker?.delegate ?? null,
      loading: document.getElementById('wo-loading').hidden ? null : document.getElementById('wo-loading-text').innerText,
      status: document.getElementById('wo-status-text').innerText,
      video: [document.getElementById('cam').videoWidth, document.getElementById('cam').videoHeight],
      // 앱(WebView) 안에서 기울기 센서 값이 실제로 들어오는지 (에뮬레이터 가상 가속도계)
      tiltRaw: w.tilt.g ? w.tilt.g.map((v) => +v.toFixed(2)) : null, pitch: w.tilt.pitchDeg() };
    if (s.running && s.fps > 0 && i >= 4) break;
  }
  return s;
})()`, 120000);
shot('3_workout');

let back = null;
if (cam?.running) {
  try { execFileSync('adb', ['shell', 'input', 'keyevent', 'KEYCODE_BACK'], { timeout: 20000 }); } catch { /* 무시 */ }
  await sleep(1500);
  back = await stage('운동 중 뒤로가기', `({ stillInWorkout: !document.getElementById('screen-workout').hidden, toast: document.getElementById('toast').innerText })`);
  shot('4_after_back');
  await stage('종료', `(window.__hfpt.workout.end(), window.__hfpt.store.setSetting('gpu', true), true)`);
}

const required = app?.native === true && app?.plugins?.includes('TextToSpeech')
  && engine?.knee === 180 && engine?.hipH === 0.9 && typeof model?.loadMs === 'number';
report.required = required;
report.cameraOk = !!(cam?.running && cam?.fps > 0);
report.backOk = back ? back.stillInWorkout === true : null;
report.tiltOk = cam ? cam.tiltRaw != null : null;
save();
console.log(`필수 점검 ${required ? '통과' : '실패'} · 카메라 ${report.cameraOk ? '동작' : '확인 안 됨'} · 뒤로가기 ${report.backOk} · 기울기 센서 ${report.tiltOk ? `${cam.pitch?.toFixed?.(1) ?? '-'}°` : '값 없음'}`);
try { ws.close(); } catch { /* 무시 */ }
process.exit(required ? 0 : 1);
