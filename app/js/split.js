// 부위별(가슴·등·어깨·이두·삼두·하체·코어) 분할 루틴 짜기.
// '내 운동'(즐겨찾기)을 정해 두면 그 안에서 짜고, 내 운동이 없는 부위만 추천 운동으로 채운다.
// 분할(무분할·2·3·4·5분할)을 고르면 기록을 보고 가장 오래 쉰 날을 오늘로 고른다.
// 화면과 무관한 순수 계산이라 Node 단위 테스트로 확인한다(test/unit/split.test.mjs).

import { EXERCISE_BY_ID } from './engine/exercises.js';
import { PLAN_META, EQUIPMENT, LEVELS, defaultItem, progressItem, itemSeconds, timerItem } from './routine.js';

export const MUSCLES = {
  chest: '가슴', back: '등', shoulder: '어깨', biceps: '이두', triceps: '삼두', legs: '하체', core: '코어', cardio: '유산소',
};

/** 운동 → 주로 쓰는 부위 (루틴을 부위별로 나누는 기준) */
export const MUSCLE_OF = {
  // 가슴
  pushup: 'chest', kneepushup: 'chest', inclinepushup: 'chest', bench: 'chest', dumbbellbench: 'chest',
  inclinedbpress: 'chest', chestpress: 'chest', fly: 'chest', pullover: 'chest',
  // 등
  pullup: 'back', latpulldown: 'back', seatedrow: 'back', row: 'back', onearmrow: 'back', shrug: 'back',
  // 어깨 (뒤 어깨: 리버스 플라이·페이스 풀)
  press: 'shoulder', pikepushup: 'shoulder', lateral: 'shoulder', cablelateral: 'shoulder', frontraise: 'shoulder',
  uprightrow: 'shoulder', reversefly: 'shoulder', facepull: 'shoulder',
  // 팔
  curl: 'biceps', hammercurl: 'biceps', concentrationcurl: 'biceps', barbellcurl: 'biceps',
  triext: 'triceps', pushdown: 'triceps', ropepushdown: 'triceps', kickback: 'triceps', dips: 'triceps',
  // 하체 (엉덩이 포함)
  squat: 'legs', gobletsquat: 'legs', chairsquat: 'legs', legpress: 'legs', lunge: 'legs', reverselunge: 'legs',
  sidelunge: 'legs', bulgarian: 'legs', deadlift: 'legs', dumbbellrdl: 'legs', hipthrust: 'legs', bridge: 'legs',
  legext: 'legs', legcurl: 'legs', seatedlegcurl: 'legs', calf: 'legs', donkey: 'legs', wallsit: 'legs', hipabduction: 'legs',
  // 코어
  situp: 'core', legraise: 'core', hanglegraise: 'core', bicycle: 'core', russian: 'core', plank: 'core',
  sideplank: 'core', birddog: 'core', deadbug: 'core', shouldertap: 'core',
  // 유산소
  jumpingjack: 'cardio', highknees: 'cardio', burpee: 'cardio', climber: 'cardio', kbswing: 'cardio',
};

/** 분할: 날마다 할 부위 */
export const SPLITS = {
  full: { name: '무분할', days: [['legs', 'chest', 'back', 'shoulder', 'core']] },
  two: { name: '2분할', days: [['chest', 'back', 'shoulder', 'biceps', 'triceps'], ['legs', 'core']] },
  three: { name: '3분할', days: [['chest', 'triceps'], ['back', 'biceps'], ['legs', 'shoulder']] },
  four: { name: '4분할', days: [['chest', 'triceps'], ['back', 'biceps'], ['legs', 'core'], ['shoulder', 'biceps', 'triceps']] },
  five: { name: '5분할', days: [['chest'], ['back'], ['shoulder'], ['legs'], ['biceps', 'triceps']] },
};
export const dayName = (muscles) => muscles.map((m) => MUSCLES[m]).join('·');
/** 받침이 있으면 a(을·은), 없으면 b(를·는) — '가슴을', '등·이두를' */
const josa = (w, a, b) => { const c = w.charCodeAt(w.length - 1) - 0xac00; return w + (c >= 0 && c < 11172 && c % 28 ? a : b); };

// 한 부위에 넣을 운동 수: 처음엔 모든 부위 1개씩, 시간이 남으면 큰 부위부터 더
const CAP = { chest: 4, back: 4, legs: 5, shoulder: 4, biceps: 3, triceps: 3, core: 3, cardio: 2 };
const SIZE = { chest: 3, back: 3, legs: 3, shoulder: 2, biceps: 2, triceps: 2, core: 1, cardio: 1 };
const DAY = 86400000;
// 쉬운 변형(입문용): 장소가 집(맨몸)이거나 입문 강도일 때만 추천으로 넣는다 — 헬스장 가슴 날에 무릎 푸시업이 나오지 않게
const EASY = new Set(['kneepushup', 'inclinepushup', 'chairsquat']);

function rng(seed) {
  let h = 2166136261;
  for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 100000) / 100000; };
}

/** 부위별로 마지막에 운동한 시각 */
export function lastTrained(sessions) {
  const last = {};
  for (const s of sessions || []) {
    for (const set of s.sets || []) {
      const m = MUSCLE_OF[set.exercise];
      const t = set.start || s.start;
      if (m && !(last[m] >= t)) last[m] = t;
    }
  }
  return last;
}

/**
 * 오늘 할 날: 그 날 부위를 마지막으로 한 시각이 가장 오래된 날(안 한 부위가 있으면 그 날).
 * @returns {{index:number, reason:string}}
 */
export function nextSplitDay(split, sessions, now = Date.now()) {
  const days = (SPLITS[split] || SPLITS.three).days;
  if (days.length === 1) return { index: 0, reason: '' };
  const last = lastTrained(sessions);
  // 그 날 부위 중 가장 최근에 한 시각 = 그 날을 마지막으로 한 때
  const when = days.map((ms) => Math.max(...ms.map((m) => last[m] ?? -Infinity)));
  let index = 0;
  for (let i = 1; i < days.length; i++) if (when[i] < when[index]) index = i;
  // 달력 날짜로 며칠 전인지 (어제 저녁 운동도 '1일 전')
  const ago = (t) => { const a = new Date(now), b = new Date(t); a.setHours(0, 0, 0, 0); b.setHours(0, 0, 0, 0); return Math.round((a - b) / DAY); };
  const when2 = (t) => (ago(t) === 0 ? '오늘' : ago(t) === 1 ? '어제' : `${ago(t)}일 전에`);
  const recent = days.map((ms, i) => [i, when[i]]).filter(([, t]) => Number.isFinite(t)).sort((a, b) => b[1] - a[1])[0];
  const reason = !Number.isFinite(when[index])
    ? (recent ? `${josa(dayName(days[recent[0]]), '을', '를')} ${when2(recent[1])} 했고, ${josa(dayName(days[index]), '은', '는')} 아직 기록이 없어요`
      : `${SPLITS[split].name} 첫날이에요`)
    : `${josa(dayName(days[index]), '을', '를')} ${when2(when[index])} 해서 가장 오래 쉬었어요`;
  return { index, reason };
}

/**
 * 부위별 루틴 짜기.
 * @param {object} o
 * @param {string[]} o.muscles   오늘 할 부위 (MUSCLES 의 키)
 * @param {string[]} [o.mine]    내 운동(자주 하는 운동) — 있으면 그 부위는 내 운동으로만
 * @param {'body'|'dumbbell'|'gym'} [o.equipment] 내 운동이 없는 부위를 채울 때만 쓰는 장소
 */
export function generateSplitRoutine({
  muscles, mine = [], equipment = 'gym', minutes = 45, level = 1, sessions = [], seed = '', weightOf = () => null, warmup = true, title = '',
} = {}) {
  const EQ = { body: 0, dumbbell: 1, gym: 2 };
  const rand = rng(`${seed}|${muscles.join(',')}|${equipment}|${level}`);
  const myIds = mine.filter((id) => PLAN_META[id] && MUSCLE_OF[id]);
  const filled = [];
  // 부위별 후보: 내 운동이 있으면 그것만(큰 운동 먼저), 없으면 장소에 맞는 운동(영상으로 확인한 것·큰 운동 먼저, 날마다 조금씩 다르게)
  const pools = {};
  for (const m of muscles) {
    const minePool = myIds.filter((id) => MUSCLE_OF[id] === m);
    const fromMine = minePool.length > 0;
    if (!fromMine && myIds.length) filled.push(MUSCLES[m]);
    const ids = fromMine ? minePool
      : Object.keys(MUSCLE_OF).filter((id) => MUSCLE_OF[id] === m && PLAN_META[id] && EQ[PLAN_META[id].eq] <= EQ[equipment]
        && (!EASY.has(id) || equipment === 'body' || level === 0));
    pools[m] = ids.map((id) => ({
      id,
      s: (PLAN_META[id].type === 'compound' ? 2 : 0) + (EXERCISE_BY_ID[id]?.verified ? 0.5 : 0)
        + (!fromMine && PLAN_META[id].eq === equipment ? 0.8 : 0) + rand() * (fromMine ? 1.2 : 0.9),
    })).sort((a, b) => b.s - a.s).map((x) => x.id);
  }
  const wuSec = warmup ? (minutes <= 15 ? 120 : 180) : 0;
  const budget = minutes * 60 - 2 * wuSec;
  const items = [];
  let total = 0;
  // 돌아가며 한 개씩: 1바퀴째는 모든 부위, 다음 바퀴부터는 큰 부위가 더 많이(SIZE), 부위당 최대 CAP
  const order = [];
  for (let r = 0; r < 6; r++) for (const m of muscles) if (r < SIZE[m]) order.push(m);
  for (let r = 0; r < 6; r++) for (const m of muscles) if (r >= SIZE[m] && r < CAP[m]) order.push(m);
  // 장소에 맞는 운동이 하나도 없는 부위(맨몸 등·이두 등)는 코어·유산소로 대신 채운다
  const empty = muscles.filter((m) => !pools[m].length);
  if (empty.length) {
    for (const m of ['core', 'cardio']) {
      if (pools[m]) continue;
      pools[m] = Object.keys(MUSCLE_OF).filter((id) => MUSCLE_OF[id] === m && PLAN_META[id] && EQ[PLAN_META[id].eq] <= EQ[equipment])
        .map((id) => [id, rand()]).sort((a, b) => b[1] - a[1]).map((x) => x[0]);
      for (let r = 0; r < 2 * empty.length; r++) order.push(m);
    }
  }
  const per = {};
  for (const m of order) {
    const id = pools[m].shift();
    if (!id) continue;
    const it = defaultItem(id, level, weightOf(id));
    const sec = itemSeconds(it);
    // 그 날 부위마다 첫 운동은 시간이 넘쳐도 넣는다(아래에서 세트를 줄여 맞춤) — 무분할 30분에 코어가 빠지지 않게
    const first = !per[m] && muscles.includes(m);
    if (!first && items.length >= 3 && total + sec > budget * 1.08) { pools[m].unshift(id); continue; }
    it.muscle = m;
    items.push(it);
    per[m] = (per[m] || 0) + 1;
    total += sec;
  }
  // 시간이 넘치면 세트를 줄인다(세트가 많은 것부터, 운동당 최소 2세트)
  for (let guard = 0; guard < 40 && total > budget * 1.08; guard++) {
    const it = items.filter((x) => x.sets > 2).sort((a, b) => b.sets - a.sets)[0];
    if (!it) break;
    const before = itemSeconds(it);
    it.sets--;
    total -= before - itemSeconds(it);
  }
  // 한 부위만 하는 날(5분할)처럼 운동 수가 모자라 시간이 남으면 세트를 늘린다(큰 운동부터, 운동당 최대 5세트)
  for (let guard = 0; guard < 30 && total < budget * 0.85; guard++) {
    const it = items.filter((x) => x.sets < 5).sort((a, b) => a.sets - b.sets
      || (PLAN_META[a.exercise].type === 'compound' ? 0 : 1) - (PLAN_META[b.exercise].type === 'compound' ? 0 : 1))[0];
    if (!it) break;
    const before = itemSeconds(it);
    it.sets++;
    const add = itemSeconds(it) - before;
    if (total + add > budget * 1.05) { it.sets--; break; }
    total += add;
  }
  // 점진적 과부하: 지난 기록을 보고 무게·횟수 조정
  let progressed = 0;
  for (const [k, it] of items.entries()) {
    const p = progressItem(it, sessions);
    if (p) { items[k] = { ...p, muscle: it.muscle }; if (/\+/.test(p.why)) progressed++; }
  }
  // 하는 순서: 부위 순서대로, 그 안에선 큰 운동 → 작은 운동 / 코어·유산소는 끝에
  const RANK = { compound: 0, iso: 1, core: 2, cardio: 3 };
  const mIdx = (m) => (m === 'core' || m === 'cardio' ? 99 : muscles.indexOf(m));
  // 같은 부위 안에선 큰 운동 먼저, 그중에서도 기구·덤벨처럼 무겁게 하는 것 먼저
  items.sort((a, b) => mIdx(a.muscle) - mIdx(b.muscle) || RANK[PLAN_META[a.exercise].type] - RANK[PLAN_META[b.exercise].type]
    || EQ[PLAN_META[b.exercise].eq] - EQ[PLAN_META[a.exercise].eq]);
  const usedMine = items.filter((it) => myIds.includes(it.exercise)).length;
  const reason = [
    usedMine ? `내 운동 ${usedMine}가지로 짰어요` : '',
    filled.length ? `내 운동에 ${filled.join('·')} 운동이 없어서 추천으로 채웠어요` : '',
    empty.length ? `${EQUIPMENT[equipment]}으로 할 ${empty.map((m) => MUSCLES[m]).join('·')} 운동이 없어서 코어·유산소로 채웠어요(장소를 바꾸거나 내 운동에 추가)` : '',
    progressed ? `지난 기록을 보고 ${progressed}가지 운동의 무게·횟수를 올렸어요` : '',
    total < budget * 0.75 ? `${myIds.length ? '내 운동' : EQUIPMENT[equipment]}으로 할 ${dayName(muscles)} 운동이 적어서 약 ${Math.round((total + 2 * wuSec) / 60)}분이에요(운동 추가로 늘릴 수 있어요)` : '',
  ].filter(Boolean).join(' · ');
  if (wuSec) {
    items.unshift(timerItem('warmup', wuSec));
    items.push(timerItem('cooldown', wuSec));
  }
  const counts = muscles.filter((m) => per[m]).map((m) => `${MUSCLES[m]} ${per[m]}`).join(' · ');
  return {
    name: `${title || dayName(muscles)} · ${usedMine ? '내 운동' : EQUIPMENT[equipment]} · ${LEVELS[level]}`,
    focus: 'split', muscles, equipment, level, reason, counts, items,
  };
}
