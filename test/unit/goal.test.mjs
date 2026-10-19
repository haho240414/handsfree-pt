// 하루 목표 계산 (app/js/goal.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { progress, streak, remainingRoutine, reminderPlan, reminderId, isReminderId, goalText, leftText, hasGoal } from '../../app/js/goal.js';

const D = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const sess = (t, sets, min = 20) => ({ id: `s${t}`, start: t, end: t + min * 60000, sets });
const reps = (exercise, n) => ({ exercise, kind: 'reps', reps: n });
const hold = (exercise, sec) => ({ exercise, kind: 'hold', holdSec: sec });
const goal = {
  on: true, items: [{ exercise: 'squat', amount: 50 }, { exercise: 'plank', amount: 60 }], minutes: 0,
  days: [1, 2, 3, 4, 5], remind: '20:00', lastCall: '22:00', // 평일만
};

test('오늘 진행: 운동별 합계(버티기는 초), 남은 양, 달성 여부', () => {
  const now = D(2026, 10, 19, 15); // 월요일
  const s = [sess(D(2026, 10, 19, 8), [reps('squat', 20), reps('squat', 15), hold('plank', 40)]), sess(D(2026, 10, 18, 9), [reps('squat', 99)])];
  const p = progress(goal, s, now);
  assert.deepEqual(p.items.map((x) => [x.exercise, x.done, x.left]), [['squat', 35, 15], ['plank', 40, 20]]);
  assert.equal(p.met, false);
  assert.equal(leftText(p), '스쿼트 15회 · 플랭크 20초');
  s.push(sess(D(2026, 10, 19, 18), [reps('squat', 15), hold('plank', 25)]));
  assert.equal(progress(goal, s, now).met, true);
  assert.equal(goalText(goal), '스쿼트 50회 · 플랭크 60초');
});

test('운동 시간 목표, 빈 목표는 끈 것과 같음', () => {
  const g = { ...goal, items: [], minutes: 30 };
  const now = D(2026, 10, 19, 15);
  assert.equal(progress(g, [sess(D(2026, 10, 19, 8), [reps('curl', 10)], 20)], now).met, false);
  assert.equal(progress(g, [sess(D(2026, 10, 19, 8), [], 20), sess(D(2026, 10, 19, 9), [], 12)], now).met, true);
  assert.equal(hasGoal({ ...goal, items: [], minutes: 0 }), false);
  assert.equal(hasGoal({ ...goal, on: false }), false);
});

test('연속 달성: 쉬는 요일은 건너뛰고, 오늘 아직이면 어제부터', () => {
  const done = (y, m, d) => sess(D(y, m, d, 9), [reps('squat', 50), hold('plank', 60)]);
  // 10/12(월)~10/16(금) 다 채움, 10/17(토)·18(일) 쉬는 날, 10/19(월) 오늘 아직
  const s = [12, 13, 14, 15, 16].map((d) => done(2026, 10, d));
  assert.equal(new Date(D(2026, 10, 12)).getDay(), 1);
  assert.equal(streak(goal, s, D(2026, 10, 19, 10)), 5);
  // 하루 빼먹으면 거기서 끊김
  assert.equal(streak(goal, s.filter((x) => new Date(x.start).getDate() !== 14), D(2026, 10, 19, 10)), 2);
  // 오늘도 채우면 6, 오늘 못 채운 채 하루가 지나면 0
  assert.equal(streak(goal, [...s, done(2026, 10, 19)], D(2026, 10, 19, 21)), 6);
  assert.equal(streak(goal, s, D(2026, 10, 20, 10)), 0);
});

test('남은 목표 → 루틴: 한 세트 적당량으로 나누고 버티기는 초', () => {
  const p = progress({ ...goal, items: [{ exercise: 'squat', amount: 50 }, { exercise: 'plank', amount: 60 }, { exercise: 'pushup', amount: 20 }] },
    [sess(D(2026, 10, 19, 8), [reps('pushup', 20)])], D(2026, 10, 19, 15));
  const r = remainingRoutine(p);
  assert.equal(r.length, 2); // 푸시업은 다 했음
  const sq = r.find((x) => x.exercise === 'squat');
  assert.ok(sq.reps * sq.sets >= 50 && sq.reps * (sq.sets - 1) < 50, JSON.stringify(sq));
  const pl = r.find((x) => x.exercise === 'plank');
  assert.ok(pl.holdSec > 0 && pl.holdSec * pl.sets >= 60 && !('reps' in pl), JSON.stringify(pl));
});

test('알림 일정: 목표 요일만, 지난 시각·채운 날은 빼고, 오늘은 남은 양', () => {
  const now = D(2026, 10, 19, 20, 30); // 월요일 20:30 → 오늘 20:00 은 지났고 22:00 만 남음
  const s = [sess(D(2026, 10, 19, 8), [reps('squat', 30)])];
  const plan = reminderPlan(goal, s, now, 7);
  assert.equal(plan[0].day, '2026-10-19');
  assert.equal(plan[0].slot, 1);
  assert.match(plan[0].body, /남은 것: 스쿼트 20회 · 플랭크 60초/);
  assert.equal(plan[0].id, 202610191);
  // 7일 중 평일 5일(오늘 포함): 오늘 1개 + 나머지 4일 × 2 = 9
  assert.equal(plan.length, 9);
  assert.ok(plan.every((x) => [1, 2, 3, 4, 5].includes(new Date(x.at).getDay())));
  assert.ok(plan.every((x) => isReminderId(x.id)));
  // 오늘 채웠으면 오늘 알림 없음
  const met = [...s, sess(D(2026, 10, 19, 19), [reps('squat', 20), hold('plank', 60)])];
  assert.ok(reminderPlan(goal, met, now, 7).every((x) => x.day !== '2026-10-19'));
  // 끄면 없음
  assert.deepEqual(reminderPlan({ ...goal, on: false }, s, now), []);
  assert.equal(reminderId(D(2026, 1, 5), 0), 202601050);
});
