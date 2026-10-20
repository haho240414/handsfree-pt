// 하루 목표: 오늘 얼마나 했는지, 며칠 연속 채웠는지, 남은 만큼으로 루틴 만들기, 못 채운 날 알림 일정.
// 화면·폰과 무관한 순수 계산이라 Node 단위 테스트로 확인한다(test/unit/goal.test.mjs). 알림을 실제로 거는 건 reminders.js.

import { EXERCISE_BY_ID } from './engine/exercises.js';
import { PLAN_META, isHold } from './routine.js';

/** 처음 켤 때 보여줄 목표 (사용자가 바꾼다) */
export const GOAL_DEFAULT = {
  on: false,
  items: [{ exercise: 'squat', amount: 50 }, { exercise: 'pushup', amount: 20 }, { exercise: 'plank', amount: 60 }],
  minutes: 0,                  // 하루 운동 시간(분) 목표, 0 = 안 씀
  days: [0, 1, 2, 3, 4, 5, 6], // 목표가 있는 요일 (0 = 일요일). 빠진 요일은 쉬는 날: 알림 없음·연속 기록도 안 끊김
  remind: '20:00',             // 첫 알림, '' = 끔
  lastCall: '22:00',           // 마지막 알림, '' = 끔
  morning: '',                 // 아침 알림(오늘 할 것), '' = 끔
  weekly: 0,                   // 주간 목표: 일주일(월~일)에 목표를 채운 날 수, 0 = 안 씀
};

const pad = (n) => String(n).padStart(2, '0');
/** 그 시각이 속한 날(폰의 시간대 기준) 'YYYY-MM-DD' */
export const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const startOfDay = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const addDays = (t, n) => { const d = new Date(t); d.setDate(d.getDate() + n); return d.getTime(); };

const unitOf = (id) => (isHold(id) ? '초' : '회');
const nameOf = (id) => EXERCISE_BY_ID[id]?.name ?? id;
/** "스쿼트 50회" */
export const itemText = (id, amount) => `${nameOf(id)} ${amount}${unitOf(id)}`;
/** "스쿼트 50회 · 푸시업 20회 · 운동 20분" */
export function goalText(goal) {
  const parts = (goal?.items || []).filter((x) => x.amount > 0).map((x) => itemText(x.exercise, x.amount));
  if (goal?.minutes > 0) parts.push(`운동 ${goal.minutes}분`);
  return parts.join(' · ');
}

/** 목표에 쓸 수 있는 값인지 (빈 목표는 끈 것과 같다) */
export const hasGoal = (goal) => !!goal?.on && ((goal.items || []).some((x) => x.amount > 0) || goal.minutes > 0);
/** 그날이 목표가 있는 요일인가 */
export const isGoalDay = (goal, t) => (goal?.days ?? GOAL_DEFAULT.days).includes(new Date(t).getDay());

/** 하루치 기록 합계: 운동별 횟수(버티기는 초)와 운동 시간(분) */
export function dayTotals(sessions, t) {
  const key = dayKey(t);
  const by = {};
  let minutes = 0;
  for (const s of sessions || []) {
    if (dayKey(s.start) !== key) continue;
    minutes += Math.max(0, ((s.end || s.start) - s.start) / 60000);
    for (const set of s.sets || []) {
      const v = set.kind === 'hold' ? set.holdSec || 0 : set.reps || 0;
      by[set.exercise] = (by[set.exercise] || 0) + v;
    }
  }
  return { by, minutes: Math.round(minutes) };
}

/**
 * 그날 목표 대비 진행.
 * @returns {{items:Array<{exercise,amount,done,left,unit,pct}>, minutes:{target,done,left}|null, met:boolean, pct:number, goalDay:boolean}}
 */
export function progress(goal, sessions, t = Date.now()) {
  const tot = dayTotals(sessions, t);
  const items = (goal?.items || []).filter((x) => x.amount > 0).map(({ exercise, amount }) => {
    const done = tot.by[exercise] || 0;
    return { exercise, amount, done, left: Math.max(0, amount - done), unit: unitOf(exercise), pct: Math.min(1, done / amount) };
  });
  const minutes = goal?.minutes > 0
    ? { target: goal.minutes, done: tot.minutes, left: Math.max(0, goal.minutes - tot.minutes) }
    : null;
  const parts = [...items.map((x) => x.pct), ...(minutes ? [Math.min(1, minutes.done / minutes.target)] : [])];
  const pct = parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 0;
  return { items, minutes, met: parts.length > 0 && pct >= 1, pct, goalDay: isGoalDay(goal, t) };
}

/** 남은 것 한 줄: "스쿼트 20회 · 플랭크 30초" (다 했으면 '') */
export function leftText(p) {
  const parts = p.items.filter((x) => x.left > 0).map((x) => `${nameOf(x.exercise)} ${x.left}${x.unit}`);
  if (p.minutes?.left > 0) parts.push(`운동 ${p.minutes.left}분`);
  return parts.join(' · ');
}

/**
 * 연속 달성일: 오늘부터 거꾸로, 목표 요일마다 채웠는지. 쉬는 요일은 건너뛰고(안 끊김),
 * 오늘을 아직 못 채웠으면 오늘은 빼고 어제부터 센다(하루가 끝나야 실패).
 */
export function streak(goal, sessions, now = Date.now()) {
  if (!hasGoal(goal)) return 0;
  let n = 0;
  let t = startOfDay(now) + 12 * 3600 * 1000;
  if (!progress(goal, sessions, t).met) t = addDays(t, -1);
  for (let i = 0; i < 400; i++, t = addDays(t, -1)) {
    if (!isGoalDay(goal, t)) continue;
    if (!progress(goal, sessions, t).met) break;
    n++;
  }
  return n;
}

/**
 * 이번 주(월요일부터) 목표를 채운 날 수와 주간 목표까지 남은 날.
 * @returns {{done:number, target:number, left:number, daysLeft:number, days:boolean[]}} days = 월~일 채웠는지
 */
export function weekProgress(goal, sessions, now = Date.now()) {
  const d0 = new Date(startOfDay(now));
  const mon = addDays(d0.getTime(), -((d0.getDay() + 6) % 7));
  const days = [];
  for (let i = 0; i < 7; i++) {
    const t = addDays(mon, i) + 12 * 3600 * 1000;
    days.push(t <= now + 12 * 3600 * 1000 ? progress(goal, sessions, t).met : false);
  }
  const done = days.filter(Boolean).length;
  const target = Math.max(0, Math.min(7, goal?.weekly || 0));
  const todayIdx = (d0.getDay() + 6) % 7;
  return { done, target, left: Math.max(0, target - done), daysLeft: 7 - todayIdx, days };
}

/**
 * 남은 목표를 '오늘의 루틴' 항목으로: 운동마다 남은 양을 한 세트 적당량(보통 강도 기준)으로 나눈다.
 * 예) 스쿼트 50회 남음 → 12회 × 4세트 + 마지막 세트는 남은 만큼(2회짜리 세트는 앞 세트에 얹는다)
 */
export function remainingRoutine(p) {
  const out = [];
  for (const x of p.items) {
    if (x.left <= 0) continue;
    const meta = PLAN_META[x.exercise];
    const per = Math.max(1, meta?.reps?.[1] ?? 12);
    let sets = Math.max(1, Math.round(x.left / per));
    const size = Math.ceil(x.left / sets);
    sets = Math.ceil(x.left / size);
    const rest = meta?.type === 'cardio' ? 30 : isHold(x.exercise) ? 45 : 60;
    out.push(isHold(x.exercise)
      ? { exercise: x.exercise, holdSec: size, sets, rest }
      : { exercise: x.exercise, reps: size, sets, rest });
  }
  return out;
}

const parseHM = (s) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s || '');
  return m ? [Number(m[1]), Number(m[2])] : null;
};
/** 알림 번호: 날짜 + 순서(0 첫 알림, 1 마지막 알림) → 202610180 처럼 날마다 다르고 32비트 정수 안 */
export const reminderId = (t, slot) => Number(dayKey(t).replace(/-/g, '')) * 10 + slot;
export const isReminderId = (id) => id >= 200000000 && id < 300000000;

/**
 * 앞으로 며칠 동안 걸어 둘 알림 (앱을 며칠 안 열어도 오도록 미리 걸어 두고, 열 때마다 다시 계산한다).
 * - 목표가 없는 요일·이미 지난 시각은 건너뜀
 * - 오늘 이미 목표를 채웠으면 오늘 알림은 없음, 덜 했으면 남은 양을 적는다
 * - 다른 날은 그날 목표를 적는다(그날 운동하고 앱이 다시 계산하면 지워진다)
 * @returns {Array<{id:number, at:number, title:string, body:string, day:string, slot:number}>}
 */
export function reminderPlan(goal, sessions, now = Date.now(), days = 14) {
  if (!hasGoal(goal)) return [];
  // 0 = 첫 알림(저녁), 1 = 마지막 알림, 2 = 아침 알림(오늘 할 것)
  const slots = [goal.remind, goal.lastCall, goal.morning].map(parseHM);
  const out = [];
  const today = progress(goal, sessions, now);
  const st = streak(goal, sessions, now);
  const wk = weekProgress(goal, sessions, now);
  for (let d = 0; d < days; d++) {
    const base = addDays(startOfDay(now), d);
    if (!isGoalDay(goal, base)) continue;
    if (d === 0 && today.met) continue;
    slots.forEach((hm, slot) => {
      if (!hm) return;
      const at = new Date(base);
      at.setHours(hm[0], hm[1], 0, 0);
      if (at.getTime() <= now + 30 * 1000) return;
      const partial = d === 0 && today.pct > 0;
      const left = partial ? leftText(today) : goalText(goal);
      // 주간 목표: 이번 주 남은 날이 모자라면 '오늘 꼭'
      const sameWeek = d < wk.daysLeft;
      const mustToday = d === 0 && wk.target > 0 && wk.left > 0 && wk.left >= wk.daysLeft;
      const week = sameWeek && wk.target > 0 ? ` · 이번 주 ${wk.done}/${wk.target}일` : '';
      if (slot === 2) {
        out.push({
          id: reminderId(base, slot), at: at.getTime(), day: dayKey(base), slot,
          title: '오늘 운동, 이렇게 해 볼까요?',
          body: `오늘 목표: ${left}${week}${d === 0 && st > 0 ? ` · ${st}일 연속 달성 중` : ''}`,
        });
        return;
      }
      const last = slot === 1 && slots[0];
      // 연속 기록이 걸려 있으면(오늘만 알 수 있다) 끊기기 직전이라고
      const title = mustToday ? '이번 주 목표, 오늘 꼭 해야 해요'
        : d === 0 && st >= 2 ? (last ? `${st}일 연속 기록이 끊기기 직전이에요` : `오늘 하면 ${st + 1}일 연속!`)
          : last ? '오늘 목표, 아직 늦지 않았어요' : partial ? '조금만 더 하면 오늘 목표!' : '오늘 운동 아직 안 했어요';
      out.push({
        id: reminderId(base, slot), at: at.getTime(), day: dayKey(base), slot, title,
        body: `${partial ? '남은 것' : '목표'}: ${left}${week} — 누르면 남은 만큼 바로 시작해요`,
      });
    });
  }
  return out.sort((a, b) => a.at - b.at);
}
