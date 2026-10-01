// 오늘의 루틴(PT 모드): 루틴 짜기(부위·장소·시간·강도 → 운동 목록) + 루틴 진행(지금 할 운동·세트·목표 횟수).
// 화면·카메라와 무관한 순수 로직이라 Node 단위 테스트로 확인한다(test/unit/routine.test.mjs).

import { EXERCISE_BY_ID } from './engine/exercises.js';

// 운동별 루틴 정보.
// eq: 필요한 도구 — body(맨몸·집에 있는 의자/벽), dumbbell(덤벨·케틀벨), gym(기구·바벨·철봉)
// type: compound(여러 관절, 무거운 운동) / iso(한 관절) / core / cardio — 휴식·속도 기준
// reps: 강도별 [입문, 보통, 강하게] 목표 횟수 (버티기 운동은 초)
// slot: 루틴 안에서 맡는 자리 (아래 FOCUS 의 순서대로 채운다)
export const PLAN_META = {
  squat: { eq: 'body', type: 'compound', reps: [10, 12, 15], slot: ['lower'] },
  lunge: { eq: 'body', type: 'compound', reps: [10, 12, 16], slot: ['lower', 'lunge'], note: '좌우 번갈아 합쳐서' },
  sidelunge: { eq: 'body', type: 'compound', reps: [8, 10, 12], slot: ['lunge'], note: '좌우 번갈아 합쳐서' },
  bulgarian: { eq: 'body', type: 'compound', reps: [6, 8, 10], slot: ['lower', 'lunge'], note: '한쪽 다리씩, 의자나 벤치에 뒷발' },
  legpress: { eq: 'gym', type: 'compound', reps: [10, 12, 12], slot: ['lower'] },
  deadlift: { eq: 'dumbbell', type: 'compound', reps: [8, 10, 10], slot: ['hinge'] },
  kbswing: { eq: 'dumbbell', type: 'cardio', reps: [10, 15, 20], slot: ['hinge', 'cardio'] },
  bridge: { eq: 'body', type: 'iso', reps: [10, 12, 15], slot: ['hinge', 'legiso'] },
  legext: { eq: 'gym', type: 'iso', reps: [10, 12, 15], slot: ['legiso'] },
  legcurl: { eq: 'gym', type: 'iso', reps: [10, 12, 15], slot: ['legiso'] },
  calf: { eq: 'body', type: 'iso', reps: [12, 15, 20], slot: ['legiso'] },
  donkey: { eq: 'body', type: 'iso', reps: [10, 12, 16], slot: ['legiso'], note: '좌우 합쳐서' },
  wallsit: { eq: 'body', type: 'iso', reps: [20, 30, 45], slot: ['legiso'] },
  pushup: { eq: 'body', type: 'compound', reps: [8, 10, 15], slot: ['push'], note: '힘들면 무릎 대고' },
  bench: { eq: 'gym', type: 'compound', reps: [8, 10, 10], slot: ['push'] },
  press: { eq: 'dumbbell', type: 'compound', reps: [8, 10, 12], slot: ['shoulder'] },
  fly: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 12], slot: ['push2'] },
  dips: { eq: 'body', type: 'compound', reps: [6, 8, 12], slot: ['push2', 'triceps'], note: '의자·벤치 딥스' },
  lateral: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 15], slot: ['shoulder'] },
  frontraise: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 12], slot: ['shoulder'] },
  uprightrow: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 12], slot: ['shoulder'] },
  reversefly: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 15], slot: ['pull2', 'shoulder'] },
  pullup: { eq: 'gym', type: 'compound', reps: [3, 5, 8], slot: ['pull'] },
  latpulldown: { eq: 'gym', type: 'compound', reps: [10, 12, 12], slot: ['pull'] },
  seatedrow: { eq: 'gym', type: 'compound', reps: [10, 12, 12], slot: ['pull', 'pull2'] },
  row: { eq: 'dumbbell', type: 'compound', reps: [10, 12, 12], slot: ['pull', 'pull2'] },
  curl: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 12], slot: ['biceps'] },
  triext: { eq: 'dumbbell', type: 'iso', reps: [10, 12, 12], slot: ['triceps'] },
  pushdown: { eq: 'gym', type: 'iso', reps: [10, 12, 15], slot: ['triceps'] },
  situp: { eq: 'body', type: 'core', reps: [10, 15, 20], slot: ['core'] },
  legraise: { eq: 'body', type: 'core', reps: [8, 10, 15], slot: ['core'] },
  hanglegraise: { eq: 'gym', type: 'core', reps: [6, 8, 12], slot: ['core'] },
  bicycle: { eq: 'body', type: 'core', reps: [16, 20, 30], slot: ['core'], note: '좌우 합쳐서' },
  russian: { eq: 'body', type: 'core', reps: [16, 20, 30], slot: ['core'], note: '좌우 합쳐서' },
  plank: { eq: 'body', type: 'core', reps: [20, 30, 45], slot: ['core'] },
  sideplank: { eq: 'body', type: 'core', reps: [15, 20, 30], slot: ['core'], note: '한쪽씩' },
  climber: { eq: 'body', type: 'cardio', reps: [20, 30, 40], slot: ['cardio', 'core'], note: '좌우 합쳐서' },
  jumpingjack: { eq: 'body', type: 'cardio', reps: [20, 30, 40], slot: ['cardio'] },
  highknees: { eq: 'body', type: 'cardio', reps: [20, 30, 40], slot: ['cardio'], note: '좌우 합쳐서' },
  burpee: { eq: 'body', type: 'cardio', reps: [5, 8, 10], slot: ['cardio'] },
};

const EQ_RANK = { body: 0, dumbbell: 1, gym: 2 };

export const FOCUS = {
  full: { name: '전신', slots: ['lower', 'push', 'pull', 'hinge', 'shoulder', 'core', 'lunge', 'biceps', 'triceps', 'cardio', 'core'] },
  lower: { name: '하체', slots: ['lower', 'hinge', 'lunge', 'legiso', 'legiso', 'core', 'legiso', 'cardio'] },
  upper: { name: '상체', slots: ['push', 'pull', 'shoulder', 'pull2', 'push2', 'biceps', 'triceps', 'shoulder'] },
  core: { name: '코어', slots: ['core', 'core', 'core', 'core', 'core', 'cardio'] },
  cardio: { name: '유산소', slots: ['cardio', 'cardio', 'cardio', 'core', 'cardio', 'cardio', 'core'] },
};
export const EQUIPMENT = { body: '맨몸(집)', dumbbell: '덤벨(집)', gym: '헬스장' };
export const LEVELS = ['입문', '보통', '강하게'];

const SETS = [2, 3, 4];
// 휴식(초): 운동 종류 × 강도
const REST = { compound: [60, 90, 120], iso: [45, 60, 75], core: [30, 45, 45], cardio: [30, 30, 30] };
// 1회에 걸리는 시간(초) — 예상 시간 계산용
const SEC_PER_REP = { compound: 3.5, iso: 3, core: 2.5, cardio: 1.2 };
const SETUP_SEC = 40; // 운동을 바꿀 때 자리·카메라 잡는 시간

export const isHold = (id) => EXERCISE_BY_ID[id]?.kind === 'hold';

/** 루틴 한 줄의 예상 시간(초): 세트마다 (동작 + 휴식) + 자리 잡기. 마지막 세트 뒤 휴식은 다음 운동으로 넘어가며 겹친다 */
export function itemSeconds(it) {
  const meta = PLAN_META[it.exercise] || { type: 'iso' };
  const work = isHold(it.exercise) ? it.holdSec || 30 : (it.reps || 10) * SEC_PER_REP[meta.type];
  return SETUP_SEC + it.sets * work + Math.max(0, it.sets - 1) * (it.rest ?? 60) + (it.rest ?? 60) * 0.5;
}
export const routineMinutes = (items) => Math.round(items.reduce((a, it) => a + itemSeconds(it), 0) / 60);

/** 운동 하나의 기본 세트·횟수·휴식 (강도 0~2) */
export function defaultItem(id, level = 1, weight = null) {
  const meta = PLAN_META[id] || { type: 'iso', reps: [10, 12, 12] };
  const target = meta.reps[level];
  const it = { exercise: id, sets: meta.type === 'cardio' ? Math.min(3, SETS[level]) : SETS[level], rest: REST[meta.type][level] };
  if (isHold(id)) it.holdSec = target; else it.reps = target;
  if (meta.eq !== 'body' && weight != null) it.weight = weight;
  return it;
}

// 날짜 + 선택값으로 정해지는 의사난수 (같은 날 같은 선택이면 같은 루틴, '다른 구성으로'를 누르면 바뀜)
function rng(seedStr) {
  let h = 2166136261;
  for (const c of seedStr) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/**
 * 최근 기록을 보고 오늘 할 부위를 고른다 (PT 처럼 쉰 부위부터).
 * @returns {{focus: string, reason: string}}
 */
export function suggestFocus(sessions, now = Date.now()) {
  const DAY = 86400000;
  const recent = (sessions || []).filter((s) => now - s.start < 7 * DAY);
  if (!recent.length) return { focus: 'full', reason: '최근 7일 기록이 없어서 전신으로 시작해요' };
  const last = { lower: -Infinity, upper: -Infinity };
  for (const s of recent) {
    for (const set of s.sets || []) {
      const g = EXERCISE_BY_ID[set.exercise]?.group;
      const k = g === '하체' ? 'lower' : ['가슴·어깨', '등', '팔'].includes(g) ? 'upper' : null;
      if (k) last[k] = Math.max(last[k], set.start || s.start);
    }
  }
  const daysAgo = (t) => (Number.isFinite(t) ? Math.floor((now - t) / DAY) : null);
  const lo = daysAgo(last.lower), up = daysAgo(last.upper);
  if (lo === 0 && up === 0) return { focus: 'core', reason: '오늘 이미 상체·하체를 했어요. 코어로 마무리해요' };
  if (lo == null && up == null) return { focus: 'full', reason: '최근엔 코어·유산소만 했어요. 전신으로 가요' };
  if (lo == null || (up != null && last.lower < last.upper)) {
    return { focus: 'lower', reason: lo == null ? '최근 7일 하체를 안 했어요' : `하체를 ${lo === 0 ? '오늘' : `${lo}일 전`}에 해서 이번엔 하체예요` };
  }
  return { focus: 'upper', reason: up == null ? '최근 7일 상체를 안 했어요' : `상체를 ${up === 0 ? '오늘' : `${up}일 전`}에 해서 이번엔 상체예요` };
}

/**
 * 루틴 짜기.
 * @param {object} o
 * @param {'auto'|'full'|'lower'|'upper'|'core'|'cardio'} o.focus
 * @param {'body'|'dumbbell'|'gym'} o.equipment
 * @param {number} o.minutes  목표 시간(분)
 * @param {0|1|2} o.level     입문·보통·강하게
 * @param {Array} [o.sessions] 기록 (focus 가 auto 일 때)
 * @param {string} [o.seed]   같은 값이면 같은 루틴
 * @param {(id:string)=>number|null} [o.weightOf] 운동별 지난 무게
 */
export function generateRoutine({ focus = 'auto', equipment = 'body', minutes = 30, level = 1, sessions = [], seed = '', weightOf = () => null } = {}) {
  let reason = '';
  if (focus === 'auto') ({ focus, reason } = suggestFocus(sessions));
  const spec = FOCUS[focus] || FOCUS.full;
  const rand = rng(`${seed}|${focus}|${equipment}|${level}`);
  const allowed = (id) => EQ_RANK[PLAN_META[id].eq] <= EQ_RANK[equipment];
  const used = new Set();
  const items = [];
  const budget = minutes * 60;
  let total = 0;
  // 맨몸 상체처럼 도구가 없어 채울 운동이 모자라면 코어·유산소로 목표 시간의 70%까지 채운다
  const extra = ['core', 'cardio', 'core', 'core', 'cardio', 'core'];
  const slots = [...spec.slots, ...extra];
  for (const [n, slot] of slots.entries()) {
    if (n >= spec.slots.length) {
      if (items.length >= 3 && total >= budget * 0.7) break;
      if (n === spec.slots.length) reason = [reason, `${EQUIPMENT[equipment]}으로 할 ${spec.name} 운동이 적어서 코어·유산소로 채웠어요`].filter(Boolean).join(' · ');
    }
    const pool = Object.keys(PLAN_META).filter((id) => PLAN_META[id].slot.includes(slot) && allowed(id) && !used.has(id));
    if (!pool.length) continue;
    // 영상으로 확인한 운동을 먼저, 그 안에서는 날마다 다르게
    const scored = pool.map((id) => ({ id, s: (EXERCISE_BY_ID[id].verified ? 1 : 0) + rand() * 0.9 + (PLAN_META[id].eq === equipment ? 0.3 : 0) }));
    scored.sort((a, b) => b.s - a.s);
    const it = defaultItem(scored[0].id, level, weightOf(scored[0].id));
    const sec = itemSeconds(it);
    if (items.length >= 3 && total + sec > budget * 1.08) break;
    items.push(it);
    used.add(it.exercise);
    total += sec;
  }
  // 하는 순서: 큰 운동 → 작은 운동 → 코어 → 유산소 마무리 (유산소 루틴은 섞어서 순환하도록 그대로)
  const RANK = { compound: 0, iso: 1, core: 2, cardio: 3 };
  if (focus !== 'cardio') items.sort((a, b) => RANK[PLAN_META[a.exercise].type] - RANK[PLAN_META[b.exercise].type]);
  return { name: `${spec.name} · ${EQUIPMENT[equipment]} · ${LEVELS[level]}`, focus, equipment, level, reason, items };
}

/**
 * 루틴 진행: 지금 할 운동·세트·목표를 알려주고, 세트가 끝날 때마다 다음 단계로 넘어간다.
 * 휴식·음성·카메라는 화면 쪽(workout.js)이 맡고, 여기선 '어디까지 했는지'만 관리한다.
 */
export class PlanRunner {
  constructor(items) {
    this.items = items.map((it) => ({ ...it }));
    this.i = 0;     // 지금 운동 번호
    this.setNo = 1; // 지금 세트 (1부터)
    this.log = [];  // 끝낸 세트 { i, exercise, setNo, target, done, manual, skipped }
  }

  get finished() { return this.i >= this.items.length; }
  get item() { return this.items[this.i] || null; }
  /** 지금 세트의 목표 (횟수, 버티기 운동은 초) */
  get target() { const it = this.item; return it ? (isHold(it.exercise) ? it.holdSec : it.reps) : null; }

  /** 지금 다음 단계 (휴식 중에 '다음: ○○' 표시) */
  peekNext() {
    const it = this.item;
    if (!it) return null;
    if (this.setNo < it.sets) return { i: this.i, item: it, setNo: this.setNo + 1, newExercise: false };
    const nx = this.items[this.i + 1];
    return nx ? { i: this.i + 1, item: nx, setNo: 1, newExercise: true } : null;
  }

  /**
   * 지금 세트를 끝냈다. done = 실제로 한 횟수(초). 다음 단계로 넘어간다.
   * @returns {{rest:number, exerciseDone:boolean, finished:boolean}}
   */
  completeSet(done, { manual = false } = {}) {
    const it = this.item;
    if (!it) return { rest: 0, exerciseDone: true, finished: true };
    this.log.push({ i: this.i, exercise: it.exercise, setNo: this.setNo, target: this.target, done, manual, skipped: false });
    const rest = it.rest ?? 60;
    let exerciseDone = false;
    if (this.setNo < it.sets) this.setNo++;
    else { this.i++; this.setNo = 1; exerciseDone = true; }
    return { rest: this.finished ? 0 : rest, exerciseDone, finished: this.finished };
  }

  /** 지금 운동의 남은 세트를 건너뛰고 다음 운동으로 */
  skipExercise() {
    const it = this.item;
    if (!it) return { finished: true };
    for (let s = this.setNo; s <= it.sets; s++) {
      this.log.push({ i: this.i, exercise: it.exercise, setNo: s, target: this.target, done: 0, manual: false, skipped: true });
    }
    this.i++;
    this.setNo = 1;
    return { finished: this.finished };
  }

  /** 전체 진행: 세트·횟수(버티기는 초 제외) */
  progress() {
    const setsTotal = this.items.reduce((a, it) => a + it.sets, 0);
    const done = this.log.filter((l) => !l.skipped && (l.done > 0 || l.manual)); // 0회로 끝낸 세트는 한 걸로 안 친다
    const repsTarget = this.items.filter((it) => !isHold(it.exercise)).reduce((a, it) => a + it.sets * it.reps, 0);
    const repsDone = done.filter((l) => !isHold(l.exercise)).reduce((a, l) => a + Math.min(l.done, l.target), 0);
    return { setsTotal, setsDone: done.length, setsLogged: this.log.length, repsTarget, repsDone, exercises: this.items.length };
  }
}
