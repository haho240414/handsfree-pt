import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../../app/js/engine/exercises.js';
import { PLAN_META, generateRoutine, suggestFocus, routineMinutes, PlanRunner, defaultItem, isHold } from '../../app/js/routine.js';

test('루틴: 모든 운동에 루틴 정보(도구·횟수)가 있다', () => {
  for (const e of EXERCISES) assert.ok(PLAN_META[e.id], `${e.id} 루틴 정보 없음`);
});

test('루틴 짜기: 장소에 맞는 운동만, 목표 시간 근처로, 3가지 이상', () => {
  for (const equipment of ['body', 'dumbbell', 'gym']) {
    for (const focus of ['full', 'lower', 'upper', 'core', 'cardio']) {
      for (const minutes of [15, 30, 45, 60]) {
        const r = generateRoutine({ focus, equipment, minutes, level: 1, seed: '2026-10-01' });
        assert.ok(r.items.length >= 3, `${equipment}/${focus}/${minutes}: ${r.items.length}가지`);
        const rank = { body: 0, dumbbell: 1, gym: 2 };
        for (const it of r.items) assert.ok(rank[PLAN_META[it.exercise].eq] <= rank[equipment], `${it.exercise} 은 ${equipment} 에서 못 함`);
        assert.equal(new Set(r.items.map((it) => it.exercise)).size, r.items.length, '같은 운동 중복');
        const m = routineMinutes(r.items);
        if (r.items.length > 3) assert.ok(m <= minutes * 1.15 + 2, `${equipment}/${focus}/${minutes}분 → ${m}분`);
      }
    }
  }
  const gym45 = generateRoutine({ focus: 'full', equipment: 'gym', minutes: 45, level: 1, seed: 'x' });
  assert.ok(routineMinutes(gym45.items) >= 30, `헬스장 전신 45분이 너무 짧음: ${routineMinutes(gym45.items)}분`);
});

test('루틴 짜기: 같은 날 같은 선택이면 같은 루틴, 다른 구성 요청이면 바뀐다', () => {
  const a = generateRoutine({ focus: 'full', equipment: 'gym', minutes: 45, seed: 'd1' });
  const b = generateRoutine({ focus: 'full', equipment: 'gym', minutes: 45, seed: 'd1' });
  assert.deepEqual(a.items, b.items);
  const other = new Set();
  for (let k = 0; k < 6; k++) other.add(generateRoutine({ focus: 'full', equipment: 'gym', minutes: 45, seed: `d1#${k}` }).items.map((x) => x.exercise).join());
  assert.ok(other.size > 1, '다시 짜도 늘 같음');
});

test('강도: 입문 2세트 → 강하게 4세트, 버티기 운동은 초로', () => {
  assert.equal(defaultItem('squat', 0).sets, 2);
  assert.equal(defaultItem('squat', 2).sets, 4);
  assert.equal(defaultItem('plank', 1).holdSec, 30);
  assert.equal(defaultItem('plank', 1).reps, undefined);
  assert.ok(isHold('wallsit') && !isHold('squat'));
  assert.equal(defaultItem('curl', 1, 8).weight, 8);
  assert.equal(defaultItem('pushup', 1, 8).weight, undefined, '맨몸 운동엔 무게 안 붙임');
});

test('오늘 부위 추천: 어제 하체 → 상체, 기록 없으면 전신', () => {
  const now = Date.parse('2026-10-01T09:00:00');
  const day = 86400000;
  const ses = (daysAgo, ex) => ({ start: now - daysAgo * day, sets: [{ exercise: ex, start: now - daysAgo * day }] });
  assert.equal(suggestFocus([], now).focus, 'full');
  assert.equal(suggestFocus([ses(1, 'squat'), ses(3, 'press')], now).focus, 'upper');
  assert.equal(suggestFocus([ses(1, 'curl'), ses(4, 'lunge')], now).focus, 'lower');
  assert.equal(suggestFocus([ses(2, 'curl')], now).focus, 'lower');
  assert.equal(suggestFocus([ses(0, 'curl'), ses(0, 'squat')], now).focus, 'core');
});

test('루틴 진행: 운동 2가지 × 2세트, 세트 끝 → 다음 세트 → 다음 운동 → 끝', () => {
  const pr = new PlanRunner([
    { exercise: 'squat', sets: 2, reps: 10, rest: 60 },
    { exercise: 'plank', sets: 2, holdSec: 30, rest: 30 },
  ]);
  assert.equal(pr.item.exercise, 'squat');
  assert.equal(pr.target, 10);
  assert.deepEqual(pr.peekNext(), { i: 0, item: pr.items[0], setNo: 2, newExercise: false });
  assert.deepEqual(pr.completeSet(10), { rest: 60, exerciseDone: false, finished: false });
  const r2 = pr.completeSet(8);
  assert.equal(r2.exerciseDone, true);
  assert.equal(pr.item.exercise, 'plank');
  assert.equal(pr.target, 30);
  assert.equal(pr.peekNext().setNo, 2);
  pr.completeSet(30, { manual: true });
  assert.equal(pr.peekNext(), null, '마지막 세트 뒤엔 다음 없음');
  const last = pr.completeSet(25);
  assert.deepEqual(last, { rest: 0, exerciseDone: true, finished: true });
  const p = pr.progress();
  assert.equal(p.setsTotal, 4);
  assert.equal(p.setsDone, 4);
  assert.equal(p.repsTarget, 20);
  assert.equal(p.repsDone, 18);
});

test('루틴 진행: 운동 건너뛰기는 남은 세트를 건너뛴 것으로 남긴다', () => {
  const pr = new PlanRunner([
    { exercise: 'squat', sets: 3, reps: 10, rest: 60 },
    { exercise: 'curl', sets: 3, reps: 12, rest: 60 },
  ]);
  pr.completeSet(10);
  pr.skipExercise();
  assert.equal(pr.item.exercise, 'curl');
  assert.equal(pr.setNo, 1);
  const p = pr.progress();
  assert.equal(p.setsDone, 1);
  assert.equal(p.setsLogged, 3);
  assert.equal(pr.skipExercise().finished, true);
});

test('루틴 진행: 0회로 끝낸 세트는 완료로 세지 않고, 직접 완료는 센다', () => {
  const pr = new PlanRunner([{ exercise: 'squat', sets: 3, reps: 10, rest: 60 }]);
  pr.completeSet(0);
  pr.completeSet(0, { manual: true });
  pr.completeSet(7);
  const p = pr.progress();
  assert.equal(p.setsDone, 2);
  assert.equal(p.setsLogged, 3);
  assert.equal(p.repsDone, 7, '직접 완료 세트는 횟수(0)만큼만');
});
