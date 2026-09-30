#!/usr/bin/env node
// 실제 영상에서 뽑은 랜드마크(test/fixtures)를 앱과 같은 추적기에 넣어 정답표(test/truth.json)와 비교한다.
//   node test/eval.mjs [--model lite|full] [--debug 이름] [--fps 15]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tracker } from '../app/js/engine/tracker.js';
import { EXERCISE_BY_ID } from '../app/js/engine/exercises.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : d);
const model = opt('--model', 'lite');
const debug = opt('--debug', null);
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/truth.json'), 'utf8'));

const unpack = (arr) => arr.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));

export function loadFixture(name, m = model) {
  const file = path.join(ROOT, 'test/fixtures', `${name}.${m}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function run(fx, opts = {}) {
  const tr = new Tracker(opts);
  const events = [];
  for (const fr of fx.frames) {
    const lm = fr.lm ? unpack(fr.lm) : null;
    const wl = fr.wl ? unpack(fr.wl) : null;
    for (const e of tr.update(fr.t, lm, wl)) events.push(e);
    if (opts.onFrame) opts.onFrame(fr.t, tr);
  }
  for (const e of tr.finish()) events.push(e);
  return { tr, events, sets: tr.sets };
}

const name = (id) => EXERCISE_BY_ID[id]?.name ?? id;
const fmtSets = (sets) => sets.map((s) => `${name(s.exercise)} ${s.kind === 'hold' ? s.holdSec + '초' : s.reps + '회'}`).join(', ') || '-';

if (debug) {
  const fx = loadFixture(debug);
  const { tr, sets } = run(fx);
  console.log(`[${debug}] 세트: ${fmtSets(sets)}`);
  for (const c of tr.log) {
    console.log(`${c.valid ? '✔' : '·'} ${c.ex.padEnd(12)} ${c.tStart.toFixed(2)}→${c.tBottom.toFixed(2)}→${c.tEnd.toFixed(2)}  진폭 ${c.amp.toFixed(3)}  ${c.failed.join(' / ')}`);
  }
  process.exit(0);
}

const score = { dev: { n: 0, exact: 0, within1: 0, err: 0 }, holdout: { n: 0, exact: 0, within1: 0, err: 0 } };
let wrongTotal = 0;
const rows = [];
for (const [clip, t] of Object.entries(truth)) {
  if (clip.startsWith('_')) continue;
  const fx = loadFixture(clip);
  if (!fx) { rows.push([clip, '(랜드마크 없음)']); continue; }
  const auto = run(fx);
  const fixed = run(fx, { fixed: t.exercise });
  const autoReps = auto.sets.filter((s) => s.exercise === t.exercise).reduce((a, s) => a + (s.reps || 0), 0);
  const fixedReps = fixed.sets.reduce((a, s) => a + (s.reps || 0), 0);
  const wrong = auto.sets.filter((s) => s.exercise !== t.exercise);
  let verdict = '';
  if (wrong.length) wrongTotal++;
  if (t.reps != null) {
    const sc = score[t.split || 'dev'];
    sc.n++;
    const err = Math.abs(autoReps - t.reps);
    sc.err += err;
    if (err === 0) sc.exact++;
    if (err <= 1) sc.within1++;
    verdict = err === 0 ? '정확' : err <= 1 ? '±1' : `오차 ${autoReps - t.reps}`;
    if (wrong.length) verdict += ' / 오인식 있음';
  } else {
    verdict = wrong.length ? '오인식 있음' : '오작동 없음';
  }
  rows.push([clip, `[${t.split === 'holdout' ? '처음' : '조정'}] ${name(t.exercise)} · ${t.view} | 정답 ${t.reps ?? '?'} | 자동: ${fmtSets(auto.sets)} | 직접선택: ${fixedReps}회 | ${verdict}`]);
}
console.log(`모델: ${model}`);
for (const [c, r] of rows) console.log(`${c.padEnd(22)} ${r}`);
for (const [k, sc] of Object.entries(score)) {
  if (!sc.n) continue;
  console.log(`${k === 'dev' ? '조정에 쓴 영상' : '처음 보는 영상'} ${sc.n}개: 정확 ${sc.exact}, ±1 이내 ${sc.within1}, 평균 절대오차 ${(sc.err / sc.n).toFixed(2)}회`);
}
console.log(`다른 운동으로 잘못 인식한 영상: ${wrongTotal}개`);
