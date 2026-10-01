// 요약 화면에서 고친 세트 → 진단 기록의 정답 (app/js/diag.js corrections)
import test from 'node:test';
import assert from 'node:assert/strict';
import { corrections } from '../../app/js/diag.js';

const names = { squat: '스쿼트', lunge: '런지', plank: '플랭크', pushup: '푸시업' };
const nm = (id) => names[id] ?? id;

test('고친 세트·추가한 세트·지운 세트 → 시간순 정답 목록', () => {
  const s = {
    sets: [
      { exercise: 'squat', kind: 'reps', reps: 10, start: 100, end: 130, orig: { exercise: 'squat', kind: 'reps', reps: 8 } },
      { exercise: 'lunge', kind: 'reps', reps: 12, start: 200, end: 240, orig: { exercise: 'squat', kind: 'reps', reps: 12 } },
      { exercise: 'pushup', kind: 'reps', reps: 15, start: 900, end: 900, added: true },
      { exercise: 'plank', kind: 'hold', holdSec: 40, start: 300, end: 340 }, // 안 고침
      { exercise: 'squat', kind: 'reps', reps: 6, start: 400, end: 420, orig: { exercise: 'squat', kind: 'reps', reps: 6 } }, // 고쳤다가 되돌림
    ],
    removedSets: [{ exercise: 'squat', kind: 'reps', reps: 3, start: 500, end: 510 }],
  };
  const c = corrections(s, nm);
  assert.deepEqual(c.map((x) => x.type), ['edit', 'edit', 'remove', 'add']);
  assert.deepEqual(c.map((x) => x.text), [
    '앱 스쿼트 8회 → 실제 스쿼트 10회',
    '앱 스쿼트 12회 → 실제 런지 12회',
    '스쿼트 3회 — 안 한 세트(지움)',
    '푸시업 15회 — 앱이 못 센 세트(직접 추가)',
  ]);
  assert.deepEqual(c[0].app, { exercise: 'squat', kind: 'reps', value: 8 });
  assert.deepEqual(c[0].actual, { exercise: 'squat', kind: 'reps', value: 10 });
  assert.equal(c[2].actual, null);
  assert.equal(c[3].app, null);
});

test('고친 게 없으면 빈 목록, 기록이 없어도 안전', () => {
  assert.deepEqual(corrections({ sets: [{ exercise: 'squat', kind: 'reps', reps: 5, start: 1, end: 2 }] }), []);
  assert.deepEqual(corrections(null), []);
  assert.deepEqual(corrections(undefined), []);
});
