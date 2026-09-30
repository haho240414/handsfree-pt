import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RepCounter } from '../../app/js/engine/counter.js';
import { Tracker } from '../../app/js/engine/tracker.js';
import { standingPose, pushupPose, seeded, wave } from './synth.mjs';

const FPS = 20;

test('카운터: 사인파 10회를 정확히 센다', () => {
  const c = new RepCounter({ prom: 0.1 });
  let n = 0;
  const rnd = seeded(3);
  for (let i = 0; i <= 25 * FPS; i++) {
    const t = i / FPS;
    const active = t >= 2 && t < 22; // 2초 대기 후 2초 주기 10회
    const v = 1 - (active ? 0.4 * wave((t - 2) / 2) : 0) + (rnd() - 0.5) * 0.02;
    if (c.update(t, v)) n++;
  }
  assert.equal(n, 10);
});

test('카운터: 진폭보다 작은 흔들림은 세지 않는다', () => {
  const c = new RepCounter({ prom: 0.1 });
  let n = 0;
  for (let i = 0; i <= 20 * FPS; i++) {
    const t = i / FPS;
    if (c.update(t, 1 + 0.04 * Math.sin(t * 6))) n++;
  }
  assert.equal(n, 0);
});

test('카운터: 세트 중 바닥 반동(작은 진폭)은 추가로 세지 않는다', () => {
  const c = new RepCounter({ prom: 0.08 });
  let n = 0;
  for (let i = 0; i <= 24 * FPS; i++) {
    const t = i / FPS;
    const k = Math.floor(t / 3);
    const ph = (t % 3) / 3;
    // 3초 주기: 내려가서 바닥에서 0.09 짜리 반동 한 번
    let v = 1 - 0.45 * wave(ph);
    if (ph > 0.4 && ph < 0.6) v += 0.09 * Math.sin((ph - 0.4) / 0.2 * Math.PI);
    const r = c.update(t, v);
    if (r) { n++; c.accept(r.amp); }
    if (k > 7) break;
  }
  assert.equal(n, 8);
});

function runTracker(frames, opts) {
  const tr = new Tracker(opts);
  const events = [];
  for (const fr of frames) {
    for (const e of tr.update(fr.t, fr.lm, fr.wl)) events.push(e);
  }
  for (const e of tr.finish()) events.push(e);
  return { tr, events, sets: tr.sets };
}

function squatThenJacks() {
  const rnd = seeded(7);
  const frames = [];
  let t = 0;
  const push = (pose) => { frames.push({ t, ...pose }); t += 1 / FPS; };
  for (let i = 0; i < 3 * FPS; i++) push(standingPose({ jitter: 0.01, rnd }));
  for (let r = 0; r < 10; r++) {
    for (let i = 0; i < 2.5 * FPS; i++) push(standingPose({ squat: wave(i / (2.5 * FPS)), jitter: 0.01, rnd }));
  }
  for (let i = 0; i < 10 * FPS; i++) push(standingPose({ jitter: 0.01, rnd }));
  for (let r = 0; r < 12; r++) {
    for (let i = 0; i < 0.8 * FPS; i++) {
      const p = wave(i / (0.8 * FPS));
      push(standingPose({ arms: p, legs: p, jitter: 0.01, rnd }));
    }
  }
  for (let i = 0; i < 8 * FPS; i++) push(standingPose({ jitter: 0.01, rnd }));
  return frames;
}

test('추적기: 스쿼트 10회 → 휴식 → 점핑잭 12회를 두 세트로 나눈다', () => {
  const { sets, events } = runTracker(squatThenJacks());
  assert.deepEqual(sets.map((s) => [s.exercise, s.reps]), [['squat', 10], ['jumpingjack', 12]]);
  const starts = events.filter((e) => e.type === 'setStart');
  assert.equal(starts[0].count, 2, '자동 인식은 2회째에 확정되며 첫 회도 포함해 센다');
});

test('추적기: 운동을 직접 고르면 1회째부터 센다', () => {
  const { events, sets } = runTracker(squatThenJacks(), { fixed: 'squat' });
  assert.equal(events.find((e) => e.type === 'setStart').count, 1);
  assert.deepEqual(sets.map((s) => [s.exercise, s.reps]), [['squat', 10]]);
});

test('추적기: 푸시업 8회 뒤 버티기 12초는 플랭크 세트가 된다', () => {
  const rnd = seeded(11);
  const frames = [];
  let t = 0;
  const push = (pose) => { frames.push({ t, ...pose }); t += 1 / FPS; };
  for (let i = 0; i < 2 * FPS; i++) push(pushupPose({ jitter: 0.008, rnd }));
  for (let r = 0; r < 8; r++) {
    for (let i = 0; i < 1.6 * FPS; i++) push(pushupPose({ down: wave(i / (1.6 * FPS)), jitter: 0.008, rnd }));
  }
  for (let i = 0; i < 12 * FPS; i++) push(pushupPose({ jitter: 0.008, rnd }));
  for (let i = 0; i < 3 * FPS; i++) frames.push({ t: (t += 1 / FPS), lm: null, wl: null });
  const { sets } = runTracker(frames);
  assert.equal(sets[0].exercise, 'pushup');
  assert.equal(sets[0].reps, 8);
  assert.equal(sets[1]?.exercise, 'plank');
  assert.ok(sets[1].holdSec >= 8 && sets[1].holdSec <= 13, `플랭크 ${sets[1].holdSec}초`);
});

test('추적기: 가만히 서 있거나 사람이 없으면 아무 세트도 만들지 않는다', () => {
  const rnd = seeded(5);
  const frames = [];
  for (let i = 0; i < 30 * FPS; i++) {
    const t = i / FPS;
    frames.push(i % 200 < 150 ? { t, ...standingPose({ jitter: 0.015, rnd }) } : { t, lm: null, wl: null });
  }
  const { sets } = runTracker(frames);
  assert.equal(sets.length, 0);
});

test('자세 교정: 얕은 스쿼트(무릎각 ≈110°)는 "더 깊게"를 지적하고, 깊은 스쿼트는 지적하지 않는다', () => {
  const make = (depth) => {
    const rnd = seeded(21);
    const frames = [];
    let t = 0;
    const push = (pose) => { frames.push({ t, ...pose }); t += 1 / FPS; };
    for (let i = 0; i < 2 * FPS; i++) push(standingPose({ jitter: 0.008, rnd }));
    for (let r = 0; r < 6; r++) {
      for (let i = 0; i < 2.4 * FPS; i++) push(standingPose({ squat: depth * wave(i / (2.4 * FPS)), jitter: 0.008, rnd }));
    }
    for (let i = 0; i < 8 * FPS; i++) push(standingPose({ jitter: 0.008, rnd }));
    return runTracker(frames);
  };
  const shallow = make(0.78);
  assert.equal(shallow.sets[0]?.reps, 6);
  assert.ok(shallow.sets[0].issues.shallow >= 5, JSON.stringify(shallow.sets[0].issues));
  assert.ok(shallow.events.some((e) => e.cue?.code === 'shallow'), '음성 지적이 나와야 함');
  const deep = make(1);
  assert.equal(deep.sets[0]?.reps, 6);
  assert.equal(deep.sets[0].issues.shallow ?? 0, 0);
  assert.ok(!deep.events.some((e) => e.cue), '좋은 자세엔 지적 없음');
});

test('후보 운동을 정하면 그 안에서만 인식한다', () => {
  const { sets } = runTracker(squatThenJacks(), { candidates: ['squat', 'pushup'] });
  assert.deepEqual(sets.map((s) => s.exercise), ['squat']);
});
