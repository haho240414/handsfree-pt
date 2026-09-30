// 안드로이드 WebView(디버그 빌드)에 크롬 개발자 도구 프로토콜로 붙어 앱 상태를 확인한다
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const OUT = process.argv[2];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = (name) => fs.writeFileSync(`${OUT}/${name}.png`, execFileSync('adb', ['exec-out', 'screencap', '-p']));

let targets = [];
for (let i = 0; i < 20 && !targets.length; i++) {
  try {
    targets = (await (await fetch('http://127.0.0.1:9222/json/list')).json()).filter((t) => t.type === 'page');
  } catch { /* 아직 준비 안 됨 */ }
  if (!targets.length) await sleep(1500);
}
if (!targets.length) { console.error('WebView 디버그 대상을 못 찾음'); process.exit(1); }
const ws = new WebSocket(targets[0].webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
};
const evaluate = (expression) => new Promise((resolve) => {
  const mid = ++id;
  pending.set(mid, (msg) => resolve(msg.result?.result?.value ?? msg.result?.exceptionDetails?.exception?.description ?? msg));
  ws.send(JSON.stringify({ id: mid, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
});

const report = {};
report.app = await evaluate(`(async () => ({
  url: location.href, title: document.title, native: window.__hfpt?.isNative,
  platform: Capacitor.getPlatform(), plugins: ['TextToSpeech','App','Share','Filesystem'].filter((p) => Capacitor.isPluginAvailable(p)),
  koreanTTS: await window.__hfpt?.workout.voice.koreanAvailable(),
  ua: navigator.userAgent, simd: typeof WebAssembly === 'object',
  home: document.getElementById('btn-start-auto')?.innerText,
}))()`);

// 운동 시작 → 카메라 + AI 모델 + 매 프레임 분석이 도는지
await evaluate(`document.getElementById('btn-start-auto').click(), true`);
let wo = null;
for (let i = 0; i < 12; i++) {
  await sleep(5000);
  wo = await evaluate(`(() => { const w = window.__hfpt.workout; return {
    running: w.running, fps: w.fps, delegate: w.landmarker?.delegate ?? null,
    loading: document.getElementById('wo-loading').hidden ? null : document.getElementById('wo-loading-text').innerText,
    status: document.getElementById('wo-status-text').innerText, message: document.getElementById('wo-message').innerText,
    video: [document.getElementById('cam').videoWidth, document.getElementById('cam').videoHeight],
  }; })()`);
  if (wo.running && wo.fps > 0 && i >= 3) break;
}
report.workout = wo;
shot('2_workout');

// 운동 중 뒤로가기 → 앱이 꺼지지 않아야 함
execFileSync('adb', ['shell', 'input', 'keyevent', 'KEYCODE_BACK']);
await sleep(1500);
report.afterBack = await evaluate(`({ stillInWorkout: !document.getElementById('screen-workout').hidden, toast: document.getElementById('toast').innerText })`);
shot('3_after_back');

// 엔진 계산이 기기에서도 같은지: 합성 포즈 한 장으로 특징 계산
report.engine = await evaluate(`(async () => {
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

await evaluate(`window.__hfpt.workout.end(), true`);
await sleep(1500);
shot('4_after_end');
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();

const ok = report.app?.native === true && report.workout?.running && report.workout?.fps > 0
  && report.afterBack?.stillInWorkout === true && report.engine?.knee === 180;
if (!ok) { console.error('점검 실패'); process.exit(1); }
console.log('점검 통과');
