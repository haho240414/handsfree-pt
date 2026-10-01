// 헬스 커넥트로 보낼 운동 기록 만들기 (app/js/health.js)
import test from 'node:test';
import assert from 'node:assert/strict';
import { toHealthRecord, healthEligible, HC_SEGMENT, HC_TYPE } from '../../app/js/health.js';
import { EXERCISES } from '../../app/js/engine/exercises.js';
import { sessionCalories } from '../../app/js/stats.js';

const T = Date.UTC(2026, 9, 1, 9, 0, 0);
const set = (exercise, o, a, b) => ({ id: `${exercise}${a}`, exercise, kind: o.hold ? 'hold' : 'reps', reps: o.hold ? null : o.reps,
  holdSec: o.hold || null, weight: o.w ?? null, start: T + a * 1000, end: T + b * 1000, issues: {}, good: null });

// connect-client 1.1.0 ExerciseSegment 의 정적 초기화에서 읽은 '근력 운동(70)과 함께 쓸 수 있는 세트 종류'
const STRENGTH_OK = new Set([1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 25, 26, 27, 28, 29, 30, 31, 32,
  33, 34, 35, 36, 37, 41, 42, 43, 48, 49, 50, 51, 63, 65, /* 어디에나 */ 0, 38, 39, 44, 54]);

test('모든 운동의 세트 종류가 근력 운동 세션과 함께 쓸 수 있는 값', () => {
  for (const e of EXERCISES) {
    const t = HC_SEGMENT[e.id] ?? 38;
    assert.ok(STRENGTH_OK.has(t), `${e.id} → ${t}`);
  }
});

test('세트 = 구간: 시간순·겹치지 않게·운동 시간 안, 횟수 그대로 / 길이 없는 세트는 메모에만', () => {
  const s = {
    id: 'abc', start: T, end: T + 600000, source: 'camera',
    sets: [
      set('pushup', { reps: 20 }, 200, 230),
      set('squat', { reps: 8, w: 60 }, 10, 40),
      set('squat', { reps: 6, w: 70 }, 35, 70), // 앞 세트와 5초 겹침 → 40초부터
      set('plank', { hold: 45 }, 300, 345),
      set('curl', { reps: 10, w: 10 }, 600, 600), // 직접 추가(길이 0)
    ],
  };
  const r = toHealthRecord(s, 70, 123);
  assert.equal(r.id, 'abc');
  assert.equal(r.version, 123);
  assert.equal(r.exerciseType, HC_TYPE.STRENGTH_TRAINING);
  assert.deepEqual(r.segments.map((g) => [g.type, g.reps, (g.start - T) / 1000, (g.end - T) / 1000]),
    [[51, 8, 10, 40], [51, 6, 40, 70], [38, 20, 200, 230], [41, 0, 300, 345]]);
  for (const g of r.segments) assert.ok(g.start >= r.start && g.end <= r.end && g.end > g.start);
  assert.match(r.notes, /스쿼트 2세트: 8회×60kg, 6회×70kg/);
  assert.match(r.notes, /플랭크 1세트: 45초/);
  assert.match(r.notes, /덤벨 컬 1세트: 10회×10kg/);
  assert.equal(r.title, '핸즈프리 PT · 스쿼트 외 3종');
  assert.equal(r.kcal, sessionCalories(s, 70));
  assert.ok(r.kcal > 0);
});

test('유산소만 했으면 인터벌 운동(HIIT), 루틴 이름은 제목으로', () => {
  const s = { id: 'c', start: T, end: T + 300000, source: 'camera', plan: { name: '아침 유산소' },
    sets: [set('burpee', { reps: 10 }, 5, 35), set('jumpingjack', { reps: 40 }, 60, 90)] };
  const r = toHealthRecord(s);
  assert.equal(r.exerciseType, HC_TYPE.HIIT);
  assert.equal(r.title, '핸즈프리 PT · 아침 유산소');
  assert.deepEqual(r.segments.map((g) => g.type), [9, 27]);
});

test('끝 시각이 없거나 짧아도 끝 > 시작, 영상 분석·빈 운동은 보내지 않음', () => {
  const s = { id: 'd', start: T, end: null, source: 'camera', sets: [set('squat', { reps: 5 }, 1, 20)] };
  const r = toHealthRecord(s);
  assert.ok(r.end >= T + 20000);
  assert.equal(healthEligible(s), true);
  assert.equal(healthEligible({ ...s, source: 'video' }), false);
  assert.equal(healthEligible({ ...s, sets: [] }), false);
});
