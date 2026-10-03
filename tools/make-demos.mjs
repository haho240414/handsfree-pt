#!/usr/bin/env node
// 운동별 '동작 시범' 데이터: 시범 영상에서 뽑아 둔 관절 좌표(test/fixtures)에서 1회 동작을 잘라
// 막대 인형으로 그릴 수 있는 작은 좌표 묶음으로 만든다 → app/data/demos.json (영상·사진은 담지 않는다)
//   node tools/make-demos.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Tracker } from '../app/js/engine/tracker.js';
import { EXERCISES, EXERCISE_BY_ID } from '../app/js/engine/exercises.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// 운동별로 동작이 가장 잘 보이는 영상(대개 옆모습)과, 필요하면 쓸 구간 [시작, 끝](초)
const PICK = {
  squat: ['squat_side_nicke'], lunge: ['lunge_alt_demo'], deadlift: ['deadlift_glossop_side'], calf: ['calf_balance'],
  legpress: ['legpress_puregym', [2.5, 10]], legext: ['legext_puregym'], legcurl: ['legcurl_puregym', [34, 60]],
  sidelunge: ['sidelunge_medstar'], bulgarian: ['bulgarian_denvyr', [21, 30]], wallsit: ['wallsit_fb', [17.5, 21.5]],
  donkey: ['donkey_puregym', null, 'donkey_nuffield'], pushup: ['pushup_isolated_side'], press: ['press_livelean'], lateral: ['lateral_nasm'],
  frontraise: ['frontraise_puregym'], fly: ['cablefly_rp'], uprightrow: ['uprightrow_rp'], reversefly: ['reversefly_atomic', [10, 21.5]],
  pullup: ['pullup_crossfit'], latpulldown: ['latpulldown_puregym'], seatedrow: ['seatedrow_rp'], curl: ['curl_mccarthy'],
  triext: ['triext_opex'], dips: ['dips_floor_tasha'], pushdown: ['pushdown_rp'], situp: ['situp_clinical'],
  bridge: ['bridge_puregym', null, 'hipthrust_rusin'], legraise: ['legraise_livestrong'], hanglegraise: ['hanglegraise_puregym'],
  russian: ['russian_larsen', [4.3, 13.2]], bicycle: ['bicycle_medbridge', [10, 17]], sideplank: ['sideplank_nasm', [2, 12]],
  jumpingjack: ['jacks_xhit'], climber: ['climber_grouphiit'], burpee: ['burpee_crossfit'], kbswing: ['kbswing_strongfirst'],
  highknees: ['highknees_puregym', null, 'highknees_xhit'],
  kickback: ['kickback_puregym', [0, 6.6]], concentrationcurl: ['concentration_strengthlog'],
  pullover: ['pullover_strengthlog'], shrug: ['shrug_strengthlog'], hammercurl: ['hammer_strengthlog'],
  gobletsquat: ['goblet_strengthlog'], dumbbellrdl: ['dbrdl_strengthlog'], dumbbellbench: ['dbbench_puregym'],
  birddog: ['birddog_lyndhurst'], deadbug: ['deadbug_strengthlog'], shouldertap: ['shouldertap_strengthlog'],
  pikepushup: ['pikepushup_strengthlog'], kneepushup: ['kneepushup_strengthlog'], inclinepushup: ['inclinepushup_strengthlog'],
  reverselunge: ['reverselunge_strengthlog'], chairsquat: ['chairsquat_strengthlog'],
};
// 영상이 없는 운동: 비슷한 자세를 빌려 정지 화면으로
const STILL = { plank: ['pushup_isolated_side', 'top'] };
const J = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]; // 코·어깨·팔꿈치·손목·엉덩이·무릎·발목
// 좌우를 번갈아 하는 운동(한쪽 1회)은 양쪽 2회를 한 묶음으로 보여준다
const ALTERNATE = new Set(['highknees', 'climber', 'russian', 'bicycle']);
const PAIR_DEMOS = new Set(['deadbug', 'shouldertap', 'reverselunge']);

const un = (a) => a.map(([x, y, z, visibility]) => ({ x, y, z, visibility }));
const load = (n) => JSON.parse(fs.readFileSync(path.join(ROOT, 'test/fixtures', `${n}.full.json`), 'utf8'));

function window(fx, ex, range) {
  const kind = EXERCISE_BY_ID[ex].kind;
  const tr = new Tracker({ fixed: ex, minSetReps: 1, holdMin: 1, idleSec: 600 });
  const frames = fx.frames.filter((f) => !range || (f.t >= range[0] && f.t <= range[1]));
  let holdAt = null;
  for (const f of frames) {
    tr.update(f.t, f.lm ? un(f.lm) : null, f.lm ? un(f.wl) : null);
    if (kind === 'hold' && holdAt == null && tr.state === 'hold') holdAt = f.t;
  }
  if (kind === 'hold') return holdAt != null ? [holdAt + 0.5, holdAt + 2.5] : range ? [range[0] + 1, range[0] + 3] : null;
  const reps = tr.log.filter((c) => c.valid);
  if (!reps.length) return null;
  if (PAIR_DEMOS.has(ex) && reps.length >= 2) return [reps[0].tStart - 0.15, reps[1].tEnd + 0.9];
  // 진폭이 중앙값에 가장 가까운 반복(너무 얕거나 튄 반복 대신 '보통'인 1회)
  const amps = reps.map((r) => r.amp).sort((a, b) => a - b);
  const med = amps[amps.length >> 1];
  const r = [...reps].sort((a, b) => Math.abs(a.amp - med) - Math.abs(b.amp - med))[0];
  let last = r;
  if (ALTERNATE.has(ex)) last = reps.find((x) => x.tStart > r.tEnd - 0.1 && x.tStart < r.tEnd + 0.6) || r;
  const next = reps.find((x) => x.tStart > last.tStart + 0.2);
  return [r.tStart - 0.15, Math.min(next ? next.tStart + 0.1 : last.tEnd + 0.9, last.tEnd + 1.2)];
}

function pack(fx, [t0, t1], still = false) {
  let frames = fx.frames.filter((f) => f.lm && f.t >= t0 && f.t <= t1);
  if (still) frames = frames.slice(0, 1);
  if (frames.length < 1) return null;
  const W = fx.width || 1, H = fx.height || 1;
  // 가려진 관절도 AI 가 추정한 위치를 그대로 쓰고(대개 그럴듯하다), 얼마나 잘 보였는지는 따로 남겨
  // 그림에서 반대편 팔다리처럼 흐리게 그린다
  const pts = frames.map((f) => J.map((j) => [f.lm[j][0] * W, f.lm[j][1] * H]));
  const vis = J.map((j) => +(frames.reduce((a, f) => a + (f.lm[j][3] ?? 1), 0) / frames.length).toFixed(2));
  // 3프레임 이동 평균(떨림 줄이기)
  const sm = pts.map((p, i) => p.map((q, k) => {
    const a = pts[Math.max(0, i - 1)][k], b = pts[Math.min(pts.length - 1, i + 1)][k];
    return [(a[0] + q[0] + b[0]) / 3, (a[1] + q[1] + b[1]) / 3];
  }));
  // 크기 맞추기: 튄 프레임 하나 때문에 인형이 작아지지 않게 상하위 3%는 빼고 잰다
  const q = (a, r) => { const b = [...a].sort((m, n) => m - n); return b[Math.min(b.length - 1, Math.max(0, Math.round((b.length - 1) * r)))]; };
  const xs = sm.flatMap((p) => p.map((c) => c[0])), ys = sm.flatMap((p) => p.map((c) => c[1]));
  const x0 = q(xs, 0.03), x1 = q(xs, 0.97), y0 = q(ys, 0.03), y1 = q(ys, 0.97);
  const s = Math.max(x1 - x0, y1 - y0) || 1;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
  return {
    fps: 15, vis,
    w: +((x1 - x0) / s).toFixed(3), h: +((y1 - y0) / s).toFixed(3),
    f: sm.map((p) => p.flatMap(([x, y]) => [Math.round(((x - cx) / s) * 1000 + 500), Math.round(((y - cy) / s) * 1000 + 500)])),
  };
}

const out = { joints: J, bones: [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]], demos: {} };
for (const e of EXERCISES) {
  let got = null, src = null;
  const pick = PICK[e.id];
  const still = STILL[e.id];
  const tries = pick ? [[pick[0], pick[1]], ...(pick[2] ? [[pick[2], null]] : [])] : [];
  for (const [clip, range] of tries) {
    if (!fs.existsSync(path.join(ROOT, 'test/fixtures', `${clip}.full.json`))) continue;
    const fx = load(clip);
    const w = window(fx, e.id, range);
    if (!w) { console.log(`  (${clip}: 이 운동으로 센 반복이 없음)`); continue; }
    got = pack(fx, w);
    if (got) { src = `${clip} ${w[0].toFixed(1)}~${w[1].toFixed(1)}초`; break; }
  }
  if (!got && still) {
    const fx = load(still[0]);
    // 팔을 편 위쪽 자세(어깨-손목 거리 최대)인 프레임 하나
    let best = null;
    for (const f of fx.frames) if (f.wl && (!best || f.wl[11][1] - f.wl[15][1] < best.wl[11][1] - best.wl[15][1])) best = f;
    got = pack(fx, [best.t, best.t + 0.1], true);
    src = `${still[0]} 정지 화면(${best.t.toFixed(1)}초, ${e.name} 자세)`;
  }
  if (got) { out.demos[e.id] = got; console.log(`${e.name.padEnd(14)} ${String(got.f.length).padStart(3)}프레임  ${src}`); }
  else console.log(`${e.name.padEnd(14)}   -  (시범 영상 없음)`);
}
const file = path.join(ROOT, 'app/data/demos.json');
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(out));
console.log(`\n${Object.keys(out.demos).length}/${EXERCISES.length}종 → ${path.relative(ROOT, file)} (${(fs.statSync(file).size / 1024).toFixed(0)}KB)`);
