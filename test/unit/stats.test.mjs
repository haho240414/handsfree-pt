import { test } from 'node:test';
import assert from 'node:assert/strict';
import { e1rm, personalRecords, newRecords, weeklyGroups, sessionCalories, setSeconds } from '../../app/js/stats.js';

const day = 86400000;
const T = Date.parse('2026-10-01T10:00:00'); // 목요일
const S = (id, daysAgo, sets, min = 30) => ({ id, start: T - daysAgo * day, end: T - daysAgo * day + min * 60000, sets });
const R = (exercise, reps, weight) => ({ exercise, kind: 'reps', reps, weight });

test('1RM 추정(Epley): 100kg × 5 ≈ 116.7, 1회는 그대로, 무게 없거나 12회 넘으면 없음', () => {
  assert.equal(e1rm(100, 5), 116.7);
  assert.equal(e1rm(80, 1), 80);
  assert.equal(e1rm(0, 5), null);
  assert.equal(e1rm(20, 15), null);
});

test('최고 기록: 무게·1RM·최다 횟수·최장 버티기', () => {
  const pr = personalRecords([
    S('a', 7, [R('squat', 10, 60), R('squat', 5, 70), R('pushup', 20)]),
    S('b', 3, [R('squat', 3, 75), { exercise: 'plank', kind: 'hold', holdSec: 45 }]),
  ]);
  assert.equal(pr.squat.maxWeight.w, 75);
  assert.equal(pr.squat.best1rm.v, 82.5); // 75 × (1 + 3/30)
  assert.equal(pr.pushup.maxReps.reps, 20);
  assert.equal(pr.plank.maxHold.sec, 45);
});

test('새 기록: 이전보다 무겁거나 많이 했을 때만, 처음 한 운동은 안 침', () => {
  const old = S('a', 7, [R('squat', 5, 70), R('pushup', 15), { exercise: 'plank', kind: 'hold', holdSec: 40 }]);
  const cur = S('b', 0, [R('squat', 5, 72.5), R('pushup', 18), { exercise: 'plank', kind: 'hold', holdSec: 30 }, R('curl', 10, 10)]);
  const rec = newRecords(cur, [cur, old]);
  assert.deepEqual(rec.map((r) => `${r.exercise}:${r.kind}`).sort(), ['pushup:reps', 'squat:weight']);
});

test('이번 주 부위별 세트·볼륨: 월요일부터만', () => {
  const w = weeklyGroups([
    S('a', 1, [R('squat', 10, 60), R('squat', 10, 60), R('press', 10, 20)]),
    S('b', 5, [R('squat', 10, 100)]), // 지난 주 토요일
  ], T);
  assert.equal(w['하체'].sets, 2);
  assert.equal(w['하체'].volume, 1200);
  assert.equal(w['가슴·어깨'].sets, 1);
});

test('칼로리 어림값: 30분 근력 운동(70kg) ≈ 120kcal(하버드 표 112kcal), 몸무게에 비례', () => {
  const s = S('a', 0, Array.from({ length: 15 }, () => R('squat', 12, 40)), 30);
  const k70 = sessionCalories(s, 70);
  assert.ok(k70 > 95 && k70 < 150, `${k70}kcal`);
  assert.ok(Math.abs(sessionCalories(s, 140) - 2 * k70) <= 1);
  assert.equal(setSeconds({ exercise: 'jumpingjack', kind: 'reps', reps: 25, plan: { timed: true, target: 30 } }), 30);
});
