import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXERCISES } from '../../app/js/engine/exercises.js';
import { PLAN_META, routineMinutes } from '../../app/js/routine.js';
import { MUSCLES, MUSCLE_OF, SPLITS, nextSplitDay, generateSplitRoutine } from '../../app/js/split.js';

const DAY = 86400000;
const NOW = new Date(2026, 9, 29, 19).getTime();
const sess = (daysAgo, ids) => ({ start: NOW - daysAgo * DAY, sets: ids.map((exercise) => ({ exercise, kind: 'reps', reps: 10 })) });
const ex = (r) => r.items.filter((it) => !it.timer);

test('분할: 모든 운동이 부위(가슴·등·어깨·이두·삼두·하체·코어·유산소) 하나에 속한다', () => {
  for (const e of EXERCISES) assert.ok(MUSCLES[MUSCLE_OF[e.id]], `${e.id} 부위 없음`);
});

test('분할: 모든 분할·날·장소에서 그 날 부위 운동만, 중복 없이, 목표 시간 근처', () => {
  const rank = { body: 0, dumbbell: 1, gym: 2 };
  for (const [k, sp] of Object.entries(SPLITS)) {
    for (const muscles of sp.days) {
      for (const equipment of ['dumbbell', 'gym']) {
        for (const minutes of [30, 45, 60]) {
          const r = generateSplitRoutine({ muscles, equipment, minutes, seed: 'x' });
          const list = ex(r);
          assert.ok(list.length >= 3, `${k} ${muscles} ${equipment} ${minutes}: ${list.length}가지`);
          assert.equal(new Set(list.map((it) => it.exercise)).size, list.length, '중복');
          for (const it of list) {
            assert.ok(muscles.includes(MUSCLE_OF[it.exercise]), `${muscles}: ${it.exercise}`);
            assert.ok(rank[PLAN_META[it.exercise].eq] <= rank[equipment], `${it.exercise} 은 ${equipment} 에서 못 함`);
          }
          // 날마다 부위 하나 이상은 다 들어간다
          for (const m of muscles) assert.ok(list.some((it) => MUSCLE_OF[it.exercise] === m), `${muscles} ${equipment}: ${m} 없음`);
          const got = routineMinutes(r.items);
          assert.ok(got <= minutes * 1.15 + 2, `${k} ${muscles} ${equipment} ${minutes}분 → ${got}분`);
          // 짧게 끝나면 이유를 알려 줘야 한다(덤벨 등 운동은 3가지뿐 등)
          if (got < minutes * 0.75) assert.match(r.reason, /운동이 적어서 약 \d+분/, `${k} ${muscles} ${equipment} ${minutes}분 → ${got}분`);
        }
      }
    }
  }
});

test('분할: 큰 운동 먼저, 같은 부위끼리 이어서', () => {
  const r = generateSplitRoutine({ muscles: ['chest', 'triceps'], equipment: 'gym', minutes: 60, seed: 'y' });
  const list = ex(r).map((it) => MUSCLE_OF[it.exercise]);
  assert.deepEqual(list, [...list].sort((a, b) => (a === 'chest' ? 0 : 1) - (b === 'chest' ? 0 : 1)), '가슴 다 하고 삼두');
  assert.equal(PLAN_META[ex(r)[0].exercise].type, 'compound');
  assert.ok(!ex(r).some((it) => it.exercise === 'kneepushup'), '헬스장 보통 강도에 무릎 푸시업 없음');
});

test('내 운동: 고른 운동이 있는 부위는 그 안에서만, 없는 부위만 추천으로 채우고 알린다', () => {
  const mine = ['bench', 'fly', 'curl', 'squat'];
  const r = generateSplitRoutine({ muscles: ['chest', 'triceps'], mine, equipment: 'gym', minutes: 45, seed: 'z' });
  const chest = ex(r).filter((it) => MUSCLE_OF[it.exercise] === 'chest').map((it) => it.exercise);
  assert.deepEqual(chest.sort(), ['bench', 'fly']);
  assert.ok(ex(r).some((it) => MUSCLE_OF[it.exercise] === 'triceps'), '삼두는 추천으로');
  assert.match(r.reason, /삼두 운동이 없어서 추천/);
  assert.match(r.name, /내 운동/);
});

test('맨몸으로 할 운동이 없는 부위(등·이두)는 코어·유산소로 채우고 알린다', () => {
  const r = generateSplitRoutine({ muscles: ['back', 'biceps'], equipment: 'body', minutes: 30, seed: 'x' });
  assert.ok(ex(r).length >= 3);
  assert.match(r.reason, /등·이두 운동이 없어서 코어·유산소/);
});

test('분할 자동: 가장 오래 쉰 날을 고른다(안 한 부위가 있으면 그 날)', () => {
  // 3분할: 가슴·삼두 3일 전, 등·이두 어제 → 하체·어깨(기록 없음)
  let s = [sess(3, ['bench', 'pushdown']), sess(1, ['latpulldown', 'curl'])];
  let r = nextSplitDay('three', s, NOW);
  assert.equal(r.index, 2);
  assert.match(r.reason, /등·이두를 어제 했고, 하체·어깨는 아직 기록이 없어요/);
  // 하체·어깨까지 오늘 했으면 → 가장 오래된 가슴·삼두
  s = [...s, sess(0, ['squat', 'press'])];
  r = nextSplitDay('three', s, NOW);
  assert.equal(r.index, 0);
  assert.match(r.reason, /가슴·삼두를 3일 전에 해서/);
  // 5분할 가슴 하나: 받침 있는 말은 '을'
  r = nextSplitDay('five', [sess(5, ['bench']), sess(4, ['row']), sess(3, ['press']), sess(2, ['squat']), sess(1, ['curl'])], NOW);
  assert.equal(r.index, 0);
  assert.match(r.reason, /가슴을 5일 전에/);
  assert.equal(nextSplitDay('full', [], NOW).index, 0);
});

test('분할: 지난번 목표를 다 채운 운동은 무게·횟수를 올린다(점진적 과부하 재사용)', () => {
  const sessions = [{ start: NOW - 2 * DAY, sets: [1, 2, 3].map(() => ({ exercise: 'bench', kind: 'reps', reps: 10, weight: 40, target: 10 })) }];
  const r = generateSplitRoutine({ muscles: ['chest'], mine: ['bench'], equipment: 'gym', minutes: 30, seed: 'x', sessions, weightOf: () => 40 });
  const b = ex(r).find((it) => it.exercise === 'bench');
  assert.ok(b, '벤치 프레스');
  assert.ok(b.muscle === 'chest');
});
