#!/usr/bin/env node
// 조정용: 랜드마크 fixture 에서 특징값 시계열을 표로 본다
//   node tools/features.mjs <이름> [키,키,...] [--every 0.33] [--from 0] [--to 99]
import fs from 'node:fs';
import { computeFeatures, SMOOTH_KEYS } from '../app/js/engine/features.js';
import { FeatureSmoother } from '../app/js/engine/filters.js';

const argv = process.argv.slice(2);
const opt = (n, d) => (argv.includes(n) ? Number(argv[argv.indexOf(n) + 1]) : d);
const name = argv[0];
const keys = (argv[1] && !argv[1].startsWith('--') ? argv[1] : 'knee,hip,elbow,elbowMin,arm,torsoTilt,hipH,wristH,shoulderOverWrist,visAll').split(',');
const every = opt('--every', 0.33), from = opt('--from', 0), to = opt('--to', 1e9);
const fx = JSON.parse(fs.readFileSync(`test/fixtures/${name}.full.json`, 'utf8'));
const u = (a) => a.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
const sm = new FeatureSmoother(SMOOTH_KEYS, 0.07);
let next = from;
console.log(['t', ...keys].map((k) => k.slice(0, 8).padStart(8)).join(''));
for (const fr of fx.frames) {
  if (!fr.lm) continue;
  const f = sm.update(fr.t, computeFeatures(u(fr.lm), u(fr.wl)));
  if (fr.t < next || fr.t > to) continue;
  next = fr.t + every;
  console.log([fr.t.toFixed(1), ...keys.map((k) => (Number.isFinite(f[k]) ? (Math.abs(f[k]) < 5 ? f[k].toFixed(2) : f[k].toFixed(0)) : '-'))].map((s) => String(s).padStart(8)).join(''));
}
