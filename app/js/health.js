// 헬스 커넥트(안드로이드 공용 건강 저장소 — 삼성 헬스·구글 피트니스가 읽는다)에 보낼 운동 기록 만들기.
// 순수 계산만 여기(Node 단위 테스트: test/unit/health.test.mjs). 실제 쓰기는 앱 안의 플러그인
// (android/.../HealthConnectPlugin.kt)이 하고, 부르는 쪽은 main.js.

import { EXERCISE_BY_ID } from './engine/exercises.js';
import { PLAN_META } from './routine.js';
import { sessionCalories } from './stats.js';

// 헬스 커넥트 상수(connect-client 1.1.0 클래스 파일에서 확인한 값)
export const HC_TYPE = { OTHER_WORKOUT: 0, HIIT: 36, STRENGTH_TRAINING: 70 };
const OTHER = 38; // EXERCISE_SEGMENT_TYPE_OTHER_WORKOUT: 어떤 운동 종류와도 함께 쓸 수 있다
/** 운동 → 헬스 커넥트 세트(segment) 종류. 맞는 게 없으면(푸시업·플라이 등) '기타 운동' */
export const HC_SEGMENT = {
  squat: 51, lunge: 36, deadlift: 11, legpress: 34, legext: 33, legcurl: 32, sidelunge: 36, bulgarian: 36,
  bench: 5, press: 48, lateral: 30, frontraise: 23,
  pullup: 42, latpulldown: 31, row: 17,
  curl: 1, triext: 12, pushdown: 12,
  situp: 50, bridge: 25, legraise: 35, hanglegraise: 35, russian: 63, bicycle: 10, plank: 41, sideplank: 41,
  jumpingjack: 27, climber: 37, burpee: 9, kbswing: 29,
  gobletsquat: 51, dumbbellrdl: 11, dumbbellbench: 5, hammercurl: 1, concentrationcurl: 1, kickback: 12,
  chairsquat: 51, reverselunge: 36,
  inclinedbpress: 5, barbellcurl: 1, onearmrow: 17, cablelateral: 30, ropepushdown: 12,
  hipthrust: 25, seatedlegcurl: 32,
};

const setText = (set) => (set.kind === 'hold' ? `${set.holdSec || 0}초`
  : `${set.reps || 0}회${set.weight ? `×${set.weight}kg` : ''}`);

/**
 * 운동 1회 → 플러그인 writeWorkout 에 넘길 값.
 * 세트마다 구간(segment) 하나: 운동 시간 안에서 겹치지 않게, 1초 미만(직접 추가한 세트 등)은 구간 없이 메모에만.
 */
export function toHealthRecord(session, bodyKg = 70, now = Date.now()) {
  const sets = [...(session.sets || [])].sort((a, b) => (a.start || 0) - (b.start || 0));
  const start = session.start;
  const lastEnd = Math.max(0, ...sets.map((s) => s.end || 0));
  const end = Math.max(session.end || 0, lastEnd, start + 1000);
  const segments = [];
  let prev = start;
  for (const s of sets) {
    const a = Math.max(s.start || 0, prev, start), b = Math.min(s.end || 0, end);
    if (b - a < 1000) continue;
    segments.push({ start: a, end: b, type: HC_SEGMENT[s.exercise] ?? OTHER, reps: s.kind === 'hold' ? 0 : Math.max(0, s.reps || 0) });
    prev = b;
  }
  const allCardio = sets.length > 0 && sets.every((s) => PLAN_META[s.exercise]?.type === 'cardio');
  // 운동별 세트 요약(운동한 순서)
  const by = new Map();
  for (const s of sets) {
    if (!by.has(s.exercise)) by.set(s.exercise, []);
    by.get(s.exercise).push(s);
  }
  const name = (id) => EXERCISE_BY_ID[id]?.name ?? id;
  const lines = [...by].map(([id, list]) => `${name(id)} ${list.length}세트: ${list.map(setText).join(', ')}`);
  let notes = lines.join('\n');
  if (notes.length > 900) notes = `${notes.slice(0, 897)}…`;
  const ids = [...by.keys()];
  const title = session.plan?.name
    || (ids.length ? `${name(ids[0])}${ids.length > 1 ? ` 외 ${ids.length - 1}종` : ''}` : '운동');
  return {
    id: session.id,
    start, end,
    version: now, // 다시 보낼 때마다 커져야 헬스 커넥트가 같은 기록을 새 내용으로 바꾼다
    exerciseType: allCardio ? HC_TYPE.HIIT : HC_TYPE.STRENGTH_TRAINING,
    title: `핸즈프리 PT · ${title}`,
    notes,
    kcal: sessionCalories(session, bodyKg),
    segments,
  };
}

/** 헬스 커넥트에 보낼 만한 운동인가: 카메라로 한 운동(영상 분석은 실제 운동 시각이 아니라 제외)이고 세트가 있을 때 */
export const healthEligible = (s) => !!s && s.source !== 'video' && (s.sets || []).length > 0;
