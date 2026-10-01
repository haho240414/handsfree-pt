#!/usr/bin/env node
// 실사용 조건 시뮬레이션: 시범 영상(조건이 이상적)에 폰 기울기·저사양·몸 잘림·흔들림을 덧입혀 정확도가 얼마나 떨어지는지 잰다.
//   node test/robust.mjs [--only 이름,이름]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tracker } from '../app/js/engine/tracker.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const truth = JSON.parse(fs.readFileSync(path.join(ROOT, 'test/truth.json'), 'utf8'));
const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;

const unpack = (arr) => arr.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}
const gauss = (r) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

// 월드 좌표 회전: pitch = 폰을 뒤로 기대 세워 위를 올려다봄(x축), roll = 폰이 옆으로 기움(z축)
const rotX = (p, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { ...p, y: p.y * c - p.z * s, z: p.y * s + p.z * c };
};
const rotZ = (p, deg) => {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  return { ...p, x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
const rot2D = (p, deg) => { // 화면 좌표도 같은 각도로 (가로세로 비 무시)
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  const x = p.x - 0.5, y = p.y - 0.5;
  return { ...p, x: 0.5 + x * c - y * s, y: 0.5 + x * s + y * c };
};
const LEGS = [25, 26, 27, 28, 29, 30, 31, 32];

// 회전 방향: rotX(+θ) = 카메라가 θ만큼 아래를 내려다봄, rotX(-θ) = 위를 올려다봄(바닥에 두고 벽에 기댐)
// sensor: 폰 기울기 센서가 알려줄 '카메라 좌표의 위쪽' (앱은 이걸로 보정한다)
const upAfter = (deg, axis = 'x') => {
  const p = axis === 'x' ? rotX({ x: 0, y: -1, z: 0 }, deg) : rotZ({ x: 0, y: -1, z: 0 }, deg);
  return [p.x, p.y, p.z];
};
export const PERTURB = {
  '기준(시범 영상 그대로)': { f: (fr) => fr },
  '올려다봄 15°(바닥·벽 기댐)': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, -15)) }) },
  '올려다봄 25°': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, -25)) }) },
  '올려다봄 25° + 센서 보정': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, -25)) }), sensor: upAfter(-25) },
  '올려다봄 25° + 센서 5° 오차': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, -25)) }), sensor: upAfter(-20) },
  '내려다봄 15°(높은 곳)': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, 15)) }) },
  '내려다봄 25°': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, 25)) }) },
  '내려다봄 25° + 센서 보정': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotX(p, 25)) }), sensor: upAfter(25) },
  '옆으로 10° 기움': { f: (fr) => ({ ...fr, wl: fr.wl.map((p) => rotZ(p, 10)), lm: fr.lm.map((p) => rot2D(p, 10)) }) },
  '저사양 폰(초당 8장)': { f: 'fps8' },
  '흔들림 큼(관절 ±2cm)': { f: (fr, r) => ({ ...fr, wl: fr.wl.map((p) => ({ ...p, x: p.x + 0.02 * gauss(r), y: p.y + 0.02 * gauss(r), z: p.z + 0.04 * gauss(r) })) }) },
  '발목 아래 잘림': { f: (fr) => ({ ...fr, lm: fr.lm.map((p, i) => ([27, 28, 29, 30, 31, 32].includes(i) ? { ...p, visibility: 0.05 } : p)) }) },
  '무릎 아래 잘림': { f: (fr) => ({ ...fr, lm: fr.lm.map((p, i) => (LEGS.includes(i) ? { ...p, visibility: 0.05 } : p)) }) },
};

function runClip(fx, spec, opts) {
  const perturb = spec.f;
  const tr = new Tracker({ ...opts, ...(spec.sensor ? { cameraUp: spec.sensor } : {}) });
  const r = rng(7);
  let frames = fx.frames;
  if (perturb === 'fps8') frames = frames.filter((_, i) => i % 2 === 0); // 15 → 7.5 fps
  for (const raw of frames) {
    let fr = raw.lm ? { t: raw.t, lm: unpack(raw.lm), wl: unpack(raw.wl) } : { t: raw.t, lm: null, wl: null };
    if (fr.lm && typeof perturb === 'function') fr = perturb(fr, r);
    tr.update(fr.t, fr.lm, fr.wl);
  }
  tr.finish();
  return tr.sets;
}

const clips = Object.entries(truth).filter(([k, t]) => !k.startsWith('_') && t.reps != null && (!only || only.includes(k)));
const fixtures = Object.fromEntries(clips.map(([k]) => [k, JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', `${k}.full.json`), 'utf8'))]));

export function evaluateAll() {
  const out = [];
  for (const [pname, perturb] of Object.entries(PERTURB)) {
    let autoExact = 0, auto1 = 0, fixExact = 0, fix1 = 0, wrong = 0, autoErr = 0;
    const misses = [];
    for (const [clip, t] of clips) {
      const auto = runClip(fixtures[clip], perturb, {});
      const fixed = runClip(fixtures[clip], perturb, { fixed: t.exercise });
      const a = auto.filter((s) => s.exercise === t.exercise).reduce((x, s) => x + (s.reps || 0), 0);
      const f = fixed.reduce((x, s) => x + (s.reps || 0), 0);
      if (a === t.reps) autoExact++;
      if (Math.abs(a - t.reps) <= 1) auto1++;
      else misses.push(`${clip}(${a}/${t.reps})`);
      autoErr += Math.abs(a - t.reps);
      if (f === t.reps) fixExact++;
      if (Math.abs(f - t.reps) <= 1) fix1++;
      if (auto.some((s) => s.exercise !== t.exercise)) wrong++;
    }
    out.push({ pname, n: clips.length, autoExact, auto1, autoErr, fixExact, fix1, wrong, misses });
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const res = evaluateAll();
  console.log(`정답 있는 영상 ${clips.length}개 · 자동=운동 안 고르고 시작 · 선택=운동 골라서 시작`);
  console.log('조건'.padEnd(22), '자동 정확', '자동±1', '선택 정확', '선택±1', '오인식', '  자동에서 크게 틀린 영상');
  for (const r of res) {
    console.log(r.pname.padEnd(22), String(r.autoExact).padStart(5), String(r.auto1).padStart(7), String(r.fixExact).padStart(8), String(r.fix1).padStart(7), String(r.wrong).padStart(6), '  ' + r.misses.join(' '));
  }
}
