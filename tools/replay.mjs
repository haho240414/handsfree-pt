#!/usr/bin/env node
// 앱의 '진단 기록'(handsfree-pt-diag-*.json[.gz])을 그대로 재현한다: 그때 AI 가 본 관절 좌표를 같은 추적기에 다시 넣고
// 앱이 실제로 낸 결과와 비교, 왜 안 셌는지(후보 반복과 탈락 이유)를 보여준다.
//   node tools/replay.mjs <파일> [--why] [--fixed 운동id] [--save 이름]
//   --why   : 후보 반복마다 통과/탈락 이유 (어떤 조건이 막았는지)
//   --save  : test/fixtures/<이름>.full.json 으로 저장 → test/truth.json 에 정답을 적으면 eval 에 들어간다
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Tracker } from '../app/js/engine/tracker.js';
import { EXERCISE_BY_ID } from '../app/js/engine/exercises.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : null);
const file = argv.find((a) => !a.startsWith('--') && a !== opt('--fixed') && a !== opt('--save'));
if (!file) {
  console.error('사용법: node tools/replay.mjs <진단기록 파일> [--why] [--fixed 운동id] [--save 이름]');
  process.exit(1);
}

let buf = fs.readFileSync(file);
if (buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
const doc = JSON.parse(buf.toString('utf8'));
if (doc.format !== 'hfpt-diag-1') throw new Error(`모르는 형식: ${doc.format}`);

// 프레임 → 테스트 fixture 와 같은 모양 {t, lm:[[x,y,z,v]...], wl:[[x,y,z,v]...]}
const S = doc.scale;
export const frames = doc.frames.map((f) => {
  const t = f[0] / 1000;
  if (f.length === 1) return { t, lm: null, wl: null };
  const lm = [], wl = [];
  for (let k = 0; k < 33; k++) {
    const o = 1 + k * 4;
    lm.push([f[o] / S, f[o + 1] / S, f[o + 2] / S, f[o + 3] / S]);
  }
  for (let k = 0; k < 33; k++) {
    const o = 1 + 132 + k * 3;
    wl.push([f[o] / S, f[o + 1] / S, f[o + 2] / S, lm[k][3]]);
  }
  return { t, lm, wl };
});

const m = doc.meta || {};
const name = (id) => EXERCISE_BY_ID[id]?.name ?? id;
const dur = frames.length ? frames[frames.length - 1].t - frames[0].t : 0;
const seen = frames.filter((f) => f.lm).length;
console.log(`기록 ${doc.meta?.startedAt ?? ""} · ${Math.floor(dur / 60)}분 ${Math.round(dur % 60)}초 · 프레임 ${frames.length}(사람 보임 ${Math.round((100 * seen) / Math.max(1, frames.length))}%)`);
console.log(`폰: ${m.ua ?? '?'}`);
console.log(`설정: 모델 ${m.settings?.model} · ${m.delegate ?? '?'} · 확정 ${m.settings?.lockReps}회 · 모드 ${m.mode}${m.candidates ? ` (${m.candidates.map(name).join(', ')})` : ''} · 앱 fps ${m.fps ?? '?'} · 기울기 ${m.tilt ?? '-'}°`);
if (doc.note) console.log(`사용자 메모: ${doc.note}`);
console.log('\n앱이 기록한 세트:');
for (const s of doc.sets || []) console.log(`  ${name(s.exercise)} ${s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`}  (${s.startT}~${s.endT}초)`);

// 재현: 같은 설정 + 같은 시점의 기울기 보정
const tilts = (doc.events || []).filter((e) => e[1] === 'tilt');
const fixed = opt('--fixed');
const tr = new Tracker({
  lockReps: m.settings?.lockReps ?? 2,
  candidates: fixed ? [fixed] : m.candidates || null,
});
let ti = 0;
for (const f of frames) {
  while (ti < tilts.length && tilts[ti][0] <= f.t) tr.setCameraUp(tilts[ti++][2]);
  const un = (a) => a.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
  tr.update(f.t, f.lm ? un(f.lm) : null, f.wl ? un(f.wl) : null);
}
tr.finish();
console.log(`\n재현 결과${fixed ? ` (운동 고정: ${name(fixed)})` : ''}:`);
for (const s of tr.sets) {
  const tempo = s.tempoSum ? `  템포 ${s.tempoSum.con}/${s.tempoSum.ecc}초${s.tempoSum.speed != null ? ` ${s.tempoSum.speed}m/s` : ''}` : '';
  console.log(`  ${name(s.exercise)} ${s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`}  (${s.startT}~${s.endT}초)${tempo}`);
}

// 운동별 후보 반복: 몇 번 잡혔고 몇 번 통과했는지, 가장 많이 막은 조건
const by = {};
for (const c of tr.log) {
  const b = (by[c.ex] ||= { n: 0, ok: 0, why: {} });
  b.n++;
  if (c.valid) b.ok++;
  for (const w of c.failed) b.why[w] = (b.why[w] || 0) + 1;
}
console.log('\n후보 반복 (운동별 잡힌 수 / 통과 / 주로 막은 조건):');
for (const [ex, b] of Object.entries(by).sort((a, b2) => b2[1].n - a[1].n).slice(0, 12)) {
  const top = Object.entries(b.why).sort((a, b2) => b2[1] - a[1]).slice(0, 3).map(([w, n]) => `${w}×${n}`).join(', ');
  console.log(`  ${name(ex).padEnd(14)} ${String(b.n).padStart(4)} / ${String(b.ok).padStart(3)}  ${top}`);
}
if (argv.includes('--why')) {
  console.log('\n후보 반복 전체:');
  for (const c of tr.log) {
    console.log(`  ${c.tStart.toFixed(1)}~${c.tEnd.toFixed(1)}초 ${c.valid ? '✔' : '·'} ${name(c.ex)} 폭 ${c.amp.toFixed(2)} ${c.failed.join(' / ')}`);
  }
}

const save = opt('--save');
if (save) {
  const out = path.join(ROOT, 'test/fixtures', `${save}.full.json`);
  const round = (a) => a && a.map((p) => p.map((v) => Math.round(v * 10000) / 10000));
  fs.writeFileSync(out, JSON.stringify({
    name: save, url: null, source: 'app-diag', fps: 15, model: m.settings?.model ?? 'full', duration: dur,
    note: doc.note || '', tilts, frames: frames.map((f) => ({ t: Math.round(f.t * 1000) / 1000, lm: round(f.lm), wl: round(f.wl) })),
  }));
  console.log(`\n저장: ${path.relative(ROOT, out)} — test/truth.json 에 "${save}": { "exercise": "...", "reps": N, "split": "dev" } 를 추가하세요`);
}
