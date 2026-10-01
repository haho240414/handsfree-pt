// 기록 통계: 운동별 최고 기록(PR)·1회 최대 중량 추정(1RM)·주간 부위별 세트·칼로리 추정.
// 화면과 무관한 순수 계산이라 Node 단위 테스트로 확인한다(test/unit/stats.test.mjs).

import { EXERCISE_BY_ID, GROUPS } from './engine/exercises.js';
import { PLAN_META } from './routine.js';

/** 1회 최대 중량 추정(Epley): 무게 × (1 + 횟수/30). 12회 넘게 들면 오차가 커서 계산하지 않는다 */
export function e1rm(weight, reps) {
  if (!(weight > 0) || !(reps > 0) || reps > 12) return null;
  return reps === 1 ? weight : Math.round(weight * (1 + reps / 30) * 10) / 10;
}

const better = (a, b) => (b == null || (a != null && a > b));

/**
 * 운동별 최고 기록.
 * @returns {Record<string, {maxWeight?:{w,reps,date}, best1rm?:{v,w,reps,date}, maxReps?:{reps,date,w}, maxHold?:{sec,date}}>}
 */
export function personalRecords(sessions, { before = Infinity } = {}) {
  const pr = {};
  for (const s of sessions || []) {
    if (s.start >= before) continue;
    for (const set of s.sets || []) {
      const p = (pr[set.exercise] ||= {});
      const date = set.start || s.start;
      if (set.kind === 'hold') {
        if (better(set.holdSec, p.maxHold?.sec)) p.maxHold = { sec: set.holdSec, date };
        continue;
      }
      const reps = set.reps || 0;
      const w = set.weight || 0;
      if (w > 0 && (better(w, p.maxWeight?.w) || (w === p.maxWeight?.w && reps > p.maxWeight.reps))) p.maxWeight = { w, reps, date };
      const est = e1rm(w, reps);
      if (better(est, p.best1rm?.v)) p.best1rm = { v: est, w, reps, date };
      if (better(reps, p.maxReps?.reps)) p.maxReps = { reps, date, w: w || null };
    }
  }
  return pr;
}

/**
 * 이번 운동에서 세운 새 기록 (이전 기록과 비교). 처음 해 본 운동은 '첫 기록'으로 치지 않는다.
 * @returns {Array<{exercise, kind:'weight'|'1rm'|'reps'|'hold', text}>}
 */
export function newRecords(session, sessions) {
  const prev = personalRecords(sessions.filter((s) => s.id !== session.id), { before: session.start });
  const now = personalRecords([session]);
  const out = [];
  for (const [ex, p] of Object.entries(now)) {
    const o = prev[ex];
    if (!o) continue;
    const name = EXERCISE_BY_ID[ex]?.name ?? ex;
    if (p.maxWeight && o.maxWeight && p.maxWeight.w > o.maxWeight.w) {
      out.push({ exercise: ex, kind: 'weight', text: `${name} 최고 무게 ${p.maxWeight.w}kg × ${p.maxWeight.reps}회 (전 ${o.maxWeight.w}kg)` });
    } else if (p.best1rm && o.best1rm && p.best1rm.v > o.best1rm.v) {
      out.push({ exercise: ex, kind: '1rm', text: `${name} 예상 1RM ${p.best1rm.v}kg (전 ${o.best1rm.v}kg)` });
    } else if (!p.maxWeight && p.maxReps && o.maxReps && p.maxReps.reps > o.maxReps.reps) {
      out.push({ exercise: ex, kind: 'reps', text: `${name} 한 세트 최다 ${p.maxReps.reps}회 (전 ${o.maxReps.reps}회)` });
    }
    if (p.maxHold && o.maxHold && p.maxHold.sec > o.maxHold.sec) {
      out.push({ exercise: ex, kind: 'hold', text: `${name} 최장 ${p.maxHold.sec}초 (전 ${o.maxHold.sec}초)` });
    }
  }
  return out;
}

/** 이번 주(월요일부터) 부위별 세트 수·볼륨(kg) */
export function weeklyGroups(sessions, now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const from = d.getTime();
  const out = Object.fromEntries(GROUPS.map((g) => [g, { sets: 0, volume: 0 }]));
  for (const s of sessions || []) {
    if (s.start < from) continue;
    for (const set of s.sets || []) {
      const g = EXERCISE_BY_ID[set.exercise]?.group;
      if (!g || !out[g]) continue;
      out[g].sets++;
      if (set.kind !== 'hold' && set.weight) out[g].volume += set.weight * (set.reps || 0);
    }
  }
  return out;
}

// 운동 강도(MET): 근력 운동 보통 3.5~5, 맨몸 유산소·인터벌 8, 버티기 3.8, 세트 사이(숨 고르기·무게 바꾸기) 2.5
// → 30분 근력 운동(70kg) ≈ 120kcal, 하버드 의대 표의 '웨이트 트레이닝 30분 112kcal'과 비슷하게 맞춤
const MET = { compound: 5, iso: 3.5, core: 3.8, cardio: 8 };
const SEC_PER_REP = { compound: 3.5, iso: 3, core: 2.5, cardio: 1.2 };

/** 세트 하나를 한 시간(초) 어림값 */
export function setSeconds(set) {
  if (set.plan?.timed) return set.plan.target;
  if (set.kind === 'hold') return set.holdSec || 0;
  const type = PLAN_META[set.exercise]?.type || 'iso';
  return (set.reps || 0) * SEC_PER_REP[type];
}

/**
 * 칼로리 어림값(kcal) = Σ(운동한 시간 × MET) + 나머지 시간(휴식) × 2.5, 몸무게(kg) 기준.
 * 실제와 ±30% 정도 차이 날 수 있는 어림값이다.
 */
export function sessionCalories(session, bodyKg = 70) {
  let active = 0, kcal = 0;
  for (const set of session.sets || []) {
    const sec = setSeconds(set);
    const type = PLAN_META[set.exercise]?.type || 'iso';
    active += sec;
    kcal += (MET[type] * bodyKg * sec) / 3600;
  }
  const total = Math.max(active, ((session.end || session.start) - session.start) / 1000);
  kcal += (2.5 * bodyKg * Math.max(0, total - active)) / 3600;
  return Math.round(kcal);
}
