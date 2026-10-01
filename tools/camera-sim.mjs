#!/usr/bin/env node
// 카메라 모드 전체 점검: 시범 영상을 '가짜 카메라'로 헤드리스 크롬(폰 화면 크기)에 넣고 실제 앱을 그대로 돌린다.
// 화면에 나온 안내·카운트·템포를 시간순으로 기록하고, 끝나면 요약 화면·진단 기록 내보내기 → tools/replay.mjs 재현까지 확인한다.
//   node tools/camera-sim.mjs [영상이름=squat_mensgarage] [--shots 폴더] [--tilt 20]
//   --tilt N : 폰을 N°(+ = 뒤로 기대 올려다봄) 기울여 둔 것처럼 기울기 센서 값을 흘려 넣는다
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { createServer } from './serve.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const clip = argv.find((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--')) || 'squat_mensgarage';
const shots = opt('--shots', null);
const tilt = opt('--tilt', null);
if (shots) fs.mkdirSync(shots, { recursive: true });

const server = createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true, protocolTimeout: 0,
  args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio', '--use-fake-ui-for-media-stream'],
});
let code = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => { console.error('[페이지 오류]', e.message); code = 1; });
  page.on('console', (m) => { if (m.type() === 'error') console.error('[콘솔 오류]', m.text()); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.evaluateOnNewDocument((src, tiltDeg) => {
    navigator.mediaDevices.getUserMedia = async () => {
      const v = document.createElement('video');
      v.src = src; v.muted = true; v.playsInline = true;
      await v.play();
      window.__fakeVideo = v;
      return v.captureStream();
    };
    if (tiltDeg != null) {
      const r = (tiltDeg * Math.PI) / 180;
      setInterval(() => window.dispatchEvent(new DeviceMotionEvent('devicemotion', {
        accelerationIncludingGravity: { x: 0, y: 9.81 * Math.cos(r), z: 9.81 * Math.sin(r) },
      })), 50);
    }
  }, `/test/videos_web/${clip}.mp4`, tilt == null ? null : Number(tilt));
  await page.goto(`${base}/`);
  await page.evaluate(() => { window.__hfpt.store.setSetting('gpu', false); window.__hfpt.store.setSetting('rest', 30); });
  await page.click('#btn-start-auto');

  // 화면 상태를 0.3초마다 읽어 바뀔 때만 기록
  const read = () => page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const v = window.__fakeVideo;
    return {
      t: v ? +v.currentTime.toFixed(1) : null, ended: v?.ended ?? false,
      status: $('wo-status-text').innerText, ex: $('wo-exercise').innerText, count: $('wo-count').innerText,
      tentative: $('wo-count').classList.contains('tentative'), msg: $('wo-message').innerText,
      tempo: $('wo-tempo').hidden ? '' : $('wo-tempo-text').innerText.replace(/\s+/g, ' '),
      cue: $('wo-cue').hidden ? '' : $('wo-cue').innerText,
    };
  });
  let prev = '', shotN = 0, sawPending = false, sawTempo = false, endedAt = null;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    await new Promise((r) => setTimeout(r, 300));
    const s = await read();
    const key = JSON.stringify({ ...s, t: 0, ended: 0, status: s.status.replace(/\d+fps/, '') });
    if (key !== prev) {
      prev = key;
      console.log(`${String(s.t).padStart(5)}s  ${s.status.padEnd(14)} | ${(s.ex + (s.tentative ? '(후보)' : '')).padEnd(14)} ${s.count.padStart(3)} | ${s.msg}${s.tempo ? ` | 템포: ${s.tempo}` : ''}${s.cue ? ` | 교정: ${s.cue}` : ''}`);
      const first = (s.tentative && !sawPending) || (s.tempo && !sawTempo);
      sawPending ||= s.tentative;
      sawTempo ||= !!s.tempo;
      if (shots && (first || shotN < 1)) await page.screenshot({ path: path.join(shots, `${clip}-${++shotN}.png`) });
    }
    if (s.ended && endedAt == null) endedAt = Date.now();
    if (endedAt && Date.now() - endedAt > 4000) break;
  }
  if (shots) await page.screenshot({ path: path.join(shots, `${clip}-rest.png`) });
  await page.click('#btn-end');
  await new Promise((r) => setTimeout(r, 800));
  const sum = await page.evaluate(() => ({
    title: document.getElementById('summary-title').innerText,
    body: document.getElementById('summary-body').innerText.replace(/\s+/g, ' ').slice(0, 400),
    diagBtn: !!document.getElementById('btn-diag'),
  }));
  console.log(`\n요약 화면: ${sum.title} · 진단 기록 버튼 ${sum.diagBtn ? '있음' : '없음'}\n  ${sum.body}`);
  if (shots) await page.screenshot({ path: path.join(shots, `${clip}-summary.png`), fullPage: true });

  // 진단 기록 → 파일 → 재현
  const b64 = await page.evaluate(async () => {
    const f = await window.__hfpt.workout.exportDiag('camera-sim 자동 점검');
    let s = '';
    for (let i = 0; i < f.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 0x8000));
    return { name: f.name, data: btoa(s) };
  });
  const out = path.join(os.tmpdir(), b64.name);
  fs.writeFileSync(out, Buffer.from(b64.data, 'base64'));
  console.log(`\n진단 기록 ${(fs.statSync(out).size / 1024).toFixed(0)}KB → 재현:`);
  console.log(execFileSync('node', [path.join(ROOT, 'tools/replay.mjs'), out], { encoding: 'utf8' }).split('\n').slice(0, 14).join('\n'));
  if (!sawPending) console.log('※ 확정 전 후보 표시를 못 봤어요(너무 빨리 지나갔을 수 있음)');
  if (!sawTempo) { console.log('※ 템포 패널이 안 보였어요'); code = 1; }
  if (!sum.diagBtn) code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
