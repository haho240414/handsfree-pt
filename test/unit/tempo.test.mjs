import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureRep, toPhases, summarize } from '../../app/js/engine/tempo.js';
import { Tracker } from '../../app/js/engine/tracker.js';
import { standingPose, seeded } from './synth.mjs';

const FPS = 15;

// 구간별 직선 신호 [[길이(초), 끝 값], ...] 를 FPS 로 샘플링
function piecewise(start, segs, { noise = 0, seed = 1 } = {}) {
  const rnd = seeded(seed);
  const pts = [];
  let t = 0, v = start;
  for (const [dur, to] of segs) {
    const n = Math.round(dur * FPS);
    for (let i = 0; i < n; i++) {
      pts.push({ t, s: v + (to - v) * (i / n) + (rnd() - 0.5) * noise, d: NaN });
      t += 1 / FPS;
    }
    v = to;
  }
  pts.push({ t, s: v, d: NaN });
  return pts;
}
const near = (x, want, tol, msg) => assert.ok(Math.abs(x - want) <= tol, `${msg}: ${x?.toFixed?.(2)} (기대 ${want}±${tol})`);

test('템포: 2초 내리고 0.5초 버티고 1초 올리면 그대로 잰다', () => {
  // 스쿼트 엉덩이각처럼: 170 → 80 → 170
  const pts = piecewise(170, [[1, 170], [2, 80], [0.5, 80], [1, 170], [1, 170]], { noise: 1 });
  const m = measureRep(pts, { tStart: 1, tBottom: 3.2, top: 170, bottom: 80 }, { minRange: 18 });
  near(m.down, 2, 0.12, '내리기');
  near(m.up, 1, 0.1, '올리기');
  near(m.hold, 0.65, 0.2, '바닥 버티기(띠 포함)');
  const ph = toPhases(m, 'ecc');
  assert.equal(ph.ecc, Math.round(m.down * 100) / 100);
  assert.equal(ph.con, Math.round(m.up * 100) / 100);
});

test('템포: 덤벨을 어깨에 올려 쉬었다 밀면 미는 동작만 잰다', () => {
  // 숄더 프레스 신호(-손목높이): 팔 내림 0.5 → 어깨 -0.06(0.8초) → 1.5초 쉼 → 머리 위 -0.43(0.6초) → 0.5초 → 어깨로 1.2초
  const pts = piecewise(0.5, [[0.5, 0.5], [0.8, -0.06], [1.5, -0.06], [0.6, -0.43], [0.5, -0.43], [1.2, -0.06], [1, -0.06]], { noise: 0.01 });
  const m = measureRep(pts, { tStart: 0.5, tBottom: 3.5, top: 0.5, bottom: -0.43 }, { minRange: 0.11 });
  near(m.down, 0.6, 0.1, '밀기(앞 구간)');
  near(m.up, 1.2, 0.12, '내리기(뒤 구간)');
});

test('템포: 올라오다 잠깐 주춤해도(0.3초) 한 구간으로 잰다', () => {
  const pts = piecewise(140, [[0.6, 140], [0.8, 72], [0.3, 72], [0.5, 100], [0.15, 93], [0.15, 93], [0.6, 142], [1, 142]], { noise: 0.8 });
  const m = measureRep(pts, { tStart: 0.6, tBottom: 1.5, top: 140, bottom: 72 }, { minRange: 21 });
  near(m.down, 0.8, 0.1, '앞 구간');
  near(m.up, 1.4, 0.2, '뒤 구간(주춤 포함)');
});

test('템포: 아직 올라오는 중이면 기다리고(null), 위에서 멈추면 잰다', () => {
  const all = piecewise(170, [[1, 170], [1.5, 90], [1, 170], [1, 170]]);
  const rep = { tStart: 1, tBottom: 2.5, top: 170, bottom: 90 };
  const mid = all.filter((p) => p.t <= 3.2); // 올라오는 도중
  assert.equal(measureRep(mid, rep, { minRange: 18 }), null);
  const m = measureRep(all, rep, { minRange: 18 });
  near(m.up, 1, 0.1, '올리기');
  // 세트가 끝나 더는 기다릴 수 없으면 있는 만큼이라도 잰다
  assert.ok(measureRep(all.filter((p) => p.t <= 3.4), rep, { final: true, minRange: 18 }));
});

test('템포 요약: 마지막 2회가 처음 빠른 반복보다 30% 느려지면 속도 저하 30%', () => {
  const reps = [0.8, 0.82, 0.78, 0.7, 0.6, 0.57, 0.57].map((v) => ({ con: 0.6, ecc: 1.2, conSpeed: v, conRate: v * 100 }));
  const s = summarize(reps);
  assert.equal(s.loss, 30);
  assert.equal(s.speed, 0.69);
  // m/s 가 없는 반복이 섞이면 m/s 는 안 보여주고 상대 속도(신호단위)로만 비교한다
  const mixed = summarize([...reps.slice(0, 3), { con: 0.6, ecc: 1, conSpeed: null, conRate: 40 }, ...reps.slice(4)]);
  assert.equal(mixed.speed, null);
  assert.equal(mixed.loss, 30);
});

test('추적기: 스쿼트를 1.6초 앉고 0.8초 일어서면 반복마다 템포를 기록한다', () => {
  const rnd = seeded(11);
  const tr = new Tracker({});
  const tempoEv = [];
  let t = 0;
  const feed = (squat) => {
    const p = standingPose({ squat, jitter: 0.008, rnd });
    for (const e of tr.update(t, p.lm, p.wl)) if (e.type === 'tempo') tempoEv.push(e);
    t += 1 / FPS;
  };
  for (let i = 0; i < 2 * FPS; i++) feed(0);
  for (let r = 0; r < 6; r++) {
    for (let i = 0; i < 0.6 * FPS; i++) feed(0);
    for (let i = 0; i < 1.6 * FPS; i++) feed(i / (1.6 * FPS));
    for (let i = 0; i < 0.3 * FPS; i++) feed(1);
    for (let i = 0; i < 0.8 * FPS; i++) feed(1 - i / (0.8 * FPS));
  }
  for (let i = 0; i < 8 * FPS; i++) feed(0);
  tr.finish();
  const set = tr.sets[0];
  assert.equal(set.exercise, 'squat');
  assert.equal(set.reps, 6);
  assert.equal(set.tempo.length, 6);
  assert.ok(set.tempo.every(Boolean), '모든 반복의 템포를 쟀다');
  assert.ok(tempoEv.length >= 5, `세트 중 템포 이벤트 ${tempoEv.length}개`);
  near(set.tempoSum.ecc, 1.6, 0.35, '앉기 평균');
  near(set.tempoSum.con, 0.8, 0.25, '일어서기 평균');
  assert.ok(set.tempoSum.speed > 0.2 && set.tempoSum.speed < 1.5, `일어서는 속도 ${set.tempoSum.speed} m/s`);
});

test('추적기: 자동 인식 1회째에 "스쿼트 같아요"(확정 전 후보)를 알려주고, 2회째에 세기 시작한다', () => {
  const rnd = seeded(5);
  const tr = new Tracker({});
  let t = 0;
  const seen = [];
  const feed = (squat) => {
    const p = standingPose({ squat, jitter: 0.008, rnd });
    tr.update(t, p.lm, p.wl);
    const s = tr.snapshot();
    seen.push(s.state === 'reps' ? `reps:${s.count}` : s.pending ? `pending:${s.pending.exercise}:${s.pending.count}` : s.state);
    t += 1 / FPS;
  };
  for (let i = 0; i < 2 * FPS; i++) feed(0);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 2.4 * FPS; i++) feed(Math.sin((Math.PI * i) / (2.4 * FPS)) ** 2);
  for (let i = 0; i < FPS; i++) feed(0);
  const order = [...new Set(seen)];
  assert.deepEqual(order, ['search', 'pending:squat:1', 'reps:2']);
});
