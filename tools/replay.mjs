#!/usr/bin/env node
// 앱의 '진단 기록'(handsfree-pt-diag-*.json[.gz])을 그대로 재현한다: 그때 AI 가 본 관절 좌표를 같은 추적기에 다시 넣고
// 앱이 실제로 낸 결과와 비교, 왜 안 셌는지(후보 반복과 탈락 이유)를 보여준다.
//   node tools/replay.mjs <파일> [--why] [--fixed 운동id] [--save 이름]
//   --why   : 후보 반복마다 통과/탈락 이유 (어떤 조건이 막았는지)
//   --save  : test/fixtures/<이름>.full.json 으로 저장 → eval 에 들어간다. 운동이 한 종류면 정답표(test/truth.json)에도
//             자동으로 넣는다(사용자가 요약 화면에서 고친 값 = 정답). 여러 종류면 운동별 합계를 보여주고 직접 적게 한다
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
console.log('\n앱이 기록한 세트 (요약 화면에서 고친 값 반영):');
const rel = (s, k) => s[`${k}T`] ?? (m.wallT0 && s[k] ? ((s[k] - m.wallT0) / 1000).toFixed(1) : '?');
const fmtV = (s) => `${s.exercise !== undefined ? `${name(s.exercise)} ` : ''}${s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`}`;
for (const s of doc.sets || []) {
  const plan = s.plan ? ` · 목표 ${s.plan.target}${s.plan.manual ? '(직접 완료)' : ''}` : '';
  const fix = s.added ? ' · 사용자가 추가(앱이 못 셈)' : s.orig ? ` · 앱이 센 값 ${fmtV(s.orig)} → 사용자가 고침` : '';
  console.log(`  ${fmtV(s)}  (${rel(s, 'start')}~${rel(s, 'end')}초)${plan}${fix}`);
}
if (doc.truth?.length) {
  console.log('\n사용자가 고친 부분 = 정답:');
  const cv = (x) => `${name(x.exercise)} ${x.value}${x.kind === 'hold' ? '초' : '회'}`;
  for (const c of doc.truth) {
    const what = c.type === 'edit' ? `앱 ${cv(c.app)} → 실제 ${cv(c.actual)}`
      : c.type === 'add' ? `${cv(c.actual)} — 앱이 못 센 세트(직접 추가)` : `${cv(c.app)} — 안 한 세트(지움)`;
    console.log(`  ${rel(c, 'start')}~${rel(c, 'end')}초  ${what}`);
  }
}

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
// 운동별 합계: 정답(사용자가 확인·고친 기록) vs 지금 엔진으로 재현
const totals = (sets) => {
  const o = {};
  for (const s of sets || []) o[s.exercise] = (o[s.exercise] || 0) + (s.kind === 'hold' ? s.holdSec || 0 : s.reps || 0);
  return o;
};
const want = totals(doc.sets), got = totals(tr.sets);
console.log(`\n운동별 합계 — ${doc.truth?.length ? '정답(사용자가 고친 기록)' : '앱 기록'} / 재현:`);
for (const ex of new Set([...Object.keys(want), ...Object.keys(got)])) {
  const a = want[ex] ?? 0, b = got[ex] ?? 0;
  console.log(`  ${name(ex).padEnd(14)} ${String(a).padStart(4)} / ${String(b).padStart(4)}${a === b ? '  ✓' : `  (${b - a > 0 ? '+' : ''}${b - a})`}`);
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
  console.log(`\n저장: ${path.relative(ROOT, out)}`);
  const exs = Object.keys(want);
  const truthFile = path.join(ROOT, 'test/truth.json');
  const table = JSON.parse(fs.readFileSync(truthFile, 'utf8'));
  if (table[save]) console.log(`정답표에 이미 "${save}" 가 있어 그대로 둡니다`);
  else if (exs.length === 1) {
    const ex = exs[0];
    const hold = EXERCISE_BY_ID[ex]?.kind === 'hold';
    const src = doc.truth?.length ? '앱 진단 기록(사용자가 고친 값)' : '앱 진단 기록(사용자가 고치지 않음 — 맞는지 확인)';
    table[save] = hold
      ? { exercise: ex, reps: null, hold: want[ex], conf: 'user', view: src, split: 'dev' }
      : { exercise: ex, reps: want[ex], conf: 'user', view: src, split: 'dev' };
    fs.writeFileSync(truthFile, `${JSON.stringify(table, null, 1)}\n`);
    console.log(`정답표에 추가: "${save}": ${JSON.stringify(table[save])}`);
  } else {
    console.log(`운동이 ${exs.length}종이라 정답표는 직접 적어 주세요 (eval 은 영상 하나에 운동 하나): ${exs.map((e) => `${e} ${want[e]}`).join(', ')}`);
  }
}
