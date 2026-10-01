#!/usr/bin/env node
// 카메라 모드 전체 점검: 시범 영상을 '가짜 카메라'로 헤드리스 크롬(폰 화면 크기)에 넣고 실제 앱을 그대로 돌린다.
// 화면에 나온 안내·카운트·템포를 시간순으로 기록하고, 끝나면 요약 화면·진단 기록 내보내기 → tools/replay.mjs 재현까지 확인한다.
//   node tools/camera-sim.mjs [영상이름=squat_mensgarage] [--shots 폴더] [--tilt 20]
//   --tilt N : 폰을 N°(+ = 뒤로 기대 올려다봄) 기울여 둔 것처럼 기울기 센서 값을 흘려 넣는다
//   --set 키=값 : 설정을 바꿔서 실행 (여러 번 가능, 예: --set rest=15 --set setEndSec=3 --set restAlerts=10,5,3)
//   --after N : 영상이 끝난 뒤 N초 더 지켜본다 (휴식 타이머·알림 확인용, 기본 4)
//   --edit N  : 요약 화면에서 첫 세트를 N회로 고친 뒤 진단 기록을 낸다 (고친 값 = 정답이 기록·재현에 나오는지)
//   --plan 'warmup:6s,squat:t8x1,squat:3x2:rest=6,plank:20sx1' : 오늘의 루틴(PT 모드)으로 시작
//          운동:횟수x세트[:rest=초], 버티기는 '20s', 인터벌(시간 동안)은 't30', 준비운동/마무리는 'warmup:60s'
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
const landscape = argv.includes('--landscape');
const after = Number(opt('--after', 4));
const editTo = opt('--edit', null);
const planArg = opt('--plan', null);
const plan = planArg && {
  name: '점검 루틴',
  items: planArg.split(',').map((tok) => {
    const [ex, rs, ...more] = tok.split(':');
    if (ex === 'warmup' || ex === 'cooldown') return { timer: ex, name: ex === 'warmup' ? '준비운동' : '마무리 스트레칭', sec: Number(rs.replace('s', '')), sets: 1, rest: 0 };
    const [target, sets] = rs.split('x');
    const it = { exercise: ex, sets: Number(sets || 1), rest: 6 };
    if (target.startsWith('t')) it.workSec = Number(target.slice(1));
    else if (target.endsWith('s')) it.holdSec = Number(target.slice(0, -1)); else it.reps = Number(target);
    for (const m of more) { const [k, v] = m.split('='); it[k] = Number(v); }
    return it;
  }),
};
const sets = argv.flatMap((a, i) => (a === '--set' ? [argv[i + 1]] : [])).map((kv) => {
  const [k, v] = kv.split('=');
  const val = v.includes(',') || k === 'restAlerts' ? v.split(',').filter(Boolean).map(Number) : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
  return [k, val];
});
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
  await page.setViewport(landscape
    ? { width: 844, height: 390, deviceScaleFactor: 2, isMobile: true, hasTouch: true, isLandscape: true }
    : { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
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
  await page.evaluate((kv) => {
    window.__hfpt.store.setSetting('gpu', false);
    window.__hfpt.store.setSetting('rest', 30);
    for (const [k, v] of kv) window.__hfpt.store.setSetting(k, v);
    // 앱이 말하는 내용을 시각과 함께 기록
    window.__said = [];
    const voice = window.__hfpt.workout.voice;
    const t0 = performance.now();
    for (const fn of ['say', 'count', 'beep']) {
      const orig = voice[fn].bind(voice);
      voice[fn] = (...args) => { window.__said.push([((performance.now() - t0) / 1000).toFixed(1), fn, String(args[0]), args[1] && typeof args[1] === 'string' ? args[1] : '']); return orig(...args); };
    }
  }, sets);
  if (plan) await page.evaluate((p) => { window.__hfpt.workout.start({ plan: p }); }, plan);
  else await page.click('#btn-start-auto');

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
      restBtns: !$('wo-rest-actions').hidden,
      frame: $('wo-frame').hidden ? '' : $('wo-frame').className.replace('wo-frame', '').trim(),
      target: $('wo-target').hidden ? '' : $('wo-target').innerText,
      plan: $('wo-plan').hidden ? '' : `${$('wo-plan-step').innerText} | ${$('wo-plan-sets').innerText}`,
      next: $('wo-next').hidden ? '' : $('wo-next-text').innerText,
    };
  });
  let prev = '', shotN = 0, sawPending = false, sawTempo = false, endedAt = null, pressedPlus = false, pressedAdj = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    await new Promise((r) => setTimeout(r, 300));
    const s = await read();
    const key = JSON.stringify({ ...s, t: 0, ended: 0, status: s.status.replace(/\d+fps/, '') });
    if (key !== prev) {
      prev = key;
      console.log(`${String(s.t).padStart(5)}s  ${s.status.padEnd(14)} | ${(s.ex + (s.tentative ? '(후보)' : '')).padEnd(14)} ${(s.count + s.target).padStart(5)} | ${s.msg}${s.plan ? ` | 진행: ${s.plan} | ${s.next}` : ''}${s.tempo && !plan ? ` | 템포: ${s.tempo}` : ''}${s.cue ? ` | 교정: ${s.cue}` : ''}${s.restBtns ? ' | [+30초][휴식 끝내기]' : ''}${s.frame ? ` | 테두리:${s.frame}` : ''}`);
      // 휴식 버튼 시험: 처음 보이면 +30초를 한 번 눌러 본다
      // 휴식 중 무게·목표 조정 시험: 처음 휴식에서 + 를 한 번씩
      if (s.restBtns && plan && !pressedAdj) {
        pressedAdj = true;
        const r = await page.evaluate(() => {
          const v = () => [document.getElementById('adj-w-val').innerText, document.getElementById('adj-r-val').innerText, document.getElementById('wo-next-text').innerText];
          const before = v();
          document.querySelector('[data-adj="w"][data-d="1"]').click();
          document.querySelector('[data-adj="r"][data-d="1"]').click();
          return { before, after: v(), shown: !document.getElementById('wo-adjust').hidden };
        });
        console.log(`        [무게+][횟수+] 눌러 봄: ${JSON.stringify(r)}`);
      }
      if (s.restBtns && !pressedPlus && !plan) {
        pressedPlus = true;
        const before = await page.evaluate(() => document.getElementById('wo-count').innerText);
        await page.click('#btn-rest-plus');
        await new Promise((r) => setTimeout(r, 300));
        const afterTxt = await page.evaluate(() => document.getElementById('wo-count').innerText);
        console.log(`        [+30초] 눌러 봄: ${before} → ${afterTxt}`);
      }
      const first = (s.tentative && !sawPending) || (s.tempo && !sawTempo);
      sawPending ||= s.tentative;
      sawTempo ||= !!s.tempo;
      if (shots && (first || shotN < 1)) await page.screenshot({ path: path.join(shots, `${clip}-${++shotN}.png`) });
    }
    if (s.ended && endedAt == null) endedAt = Date.now();
    if (endedAt && Date.now() - endedAt > after * 1000) break;
  }
  if (shots) await page.screenshot({ path: path.join(shots, `${clip}-rest.png`) });
  const said = await page.evaluate(() => window.__said);
  console.log('\n앱이 말한 내용(시작 기준 초):');
  for (const [t, fn, text, cue] of said) console.log(`  ${t.padStart(5)}s ${fn === 'count' ? '카운트' : fn === 'beep' ? '삐' : '음성'}: ${fn === 'beep' ? `${text}Hz` : text}${cue ? ` (${cue})` : ''}`);
  // 루틴을 끝까지 하면 앱이 스스로 요약 화면으로 넘어간다
  if (await page.evaluate(() => !document.getElementById('screen-workout').hidden)) await page.click('#btn-end');
  await new Promise((r) => setTimeout(r, 800));
  const sum = await page.evaluate(() => ({
    title: document.getElementById('summary-title').innerText,
    body: document.getElementById('summary-body').innerText.replace(/\s+/g, ' ').slice(0, 400),
    diagBtn: !!document.getElementById('btn-diag'),
  }));
  console.log(`\n요약 화면: ${sum.title} · 진단 기록 버튼 ${sum.diagBtn ? '있음' : '없음'}\n  ${sum.body}`);
  if (shots) await page.screenshot({ path: path.join(shots, `${clip}-summary.png`), fullPage: true });

  if (editTo != null) {
    // 사용자가 요약 화면에서 횟수를 고치는 것처럼: 첫 세트 [수정] → 횟수 입력 → 저장
    await page.evaluate(() => document.querySelector('[data-edit-set]').click());
    await page.evaluate((n) => { document.getElementById('ed-val').value = n; document.getElementById('ed-ok').click(); }, editTo);
    await new Promise((r) => setTimeout(r, 300));
    // 진단 기록 창: 고친 내용이 메모 칸에 미리 적혀 있는지
    await page.evaluate(() => document.getElementById('btn-diag').click());
    const pre = await page.evaluate(() => ({ note: document.getElementById('diag-note').value, hint: document.querySelector('#dialog p.small:not(.muted)')?.innerText }));
    console.log(`\n세트 수정 → 진단 기록 창 미리 적힌 메모: ${JSON.stringify(pre.note)} · ${pre.hint ?? '(안내 없음)'}`);
    if (!pre.note.includes(`실제`)) code = 1;
    await page.evaluate(() => document.getElementById('dialog').close('cancel'));
  }
  // 진단 기록 → 파일 → 재현 (앱과 같이 저장소의 기록 = 요약 화면에서 고친 값으로)
  const b64 = await page.evaluate(async () => {
    const { workout, store } = window.__hfpt;
    const f = await workout.exportDiag('camera-sim 자동 점검', store.getSession(workout.lastSession?.id));
    let s = '';
    for (let i = 0; i < f.bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, f.bytes.subarray(i, i + 0x8000));
    return { name: f.name, data: btoa(s) };
  });
  const out = path.join(os.tmpdir(), b64.name);
  fs.writeFileSync(out, Buffer.from(b64.data, 'base64'));
  console.log(`\n진단 기록 ${(fs.statSync(out).size / 1024).toFixed(0)}KB → 재현:`);
  const rep = execFileSync('node', [path.join(ROOT, 'tools/replay.mjs'), out], { encoding: 'utf8' });
  console.log(rep.split('\n').slice(0, editTo != null ? 40 : 14).join('\n'));
  if (editTo != null && !rep.includes('사용자가 고친 부분 = 정답')) { console.log('※ 재현에 정답이 안 나옴'); code = 1; }
  if (!sawPending) console.log('※ 확정 전 후보 표시를 못 봤어요(너무 빨리 지나갔을 수 있음)');
  if (!sawTempo) { console.log('※ 템포 패널이 안 보였어요'); code = 1; }
  if (!sum.diagBtn) code = 1;
} finally {
  await browser.close();
  server.close();
}
process.exit(code);
