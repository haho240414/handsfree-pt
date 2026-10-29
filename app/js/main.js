// 화면 전환·홈·운동 고르기·요약·기록·설정

import { EXERCISES, EXERCISE_BY_ID, GROUPS, formInfo, exerciseFamily, uniqueExerciseFamilies } from './engine/exercises.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { editRecordedSet, postureFeedback, assessment } from './session-edit.js';
import { Workout, GPU_GUARD } from './workout.js';
import { renderHistory } from './history.js';
import { esc, exName, DAYS, fmtDate, fmtTime, minutes, setValue, sessionTotals, sessionLine } from './format.js';
import { isNative, NativeApp, NativeTTS, NativeHealth, NativeCameraInfo, canShareFile, shareTextFile, shareBinaryFile } from './native.js';
import { toHealthRecord, healthEligible } from './health.js';
import { corrections } from './diag.js';
import { GOAL_DEFAULT, hasGoal, progress, streak, remainingRoutine, goalText, leftText, weekProgress } from './goal.js';
import { canRemind, notifyPermission, syncReminders, testReminder, onReminderTap, batteryState, openBatterySettings } from './reminders.js';
import { summarize as tempoSummary, speeds as tempoSpeeds } from './engine/tempo.js';
import { cameraOptions } from './camera.js';
import { voiceLabel } from './voice.js';
import { MUSCLES, MUSCLE_OF, SPLITS, dayName, nextSplitDay, generateSplitRoutine } from './split.js';
import { showPlacementHelp } from './placement.js';
import { loadDemos, playDemo, hasDemo } from './demo.js';
import { generateRoutine, routineMinutes, defaultItem, isHold, isTimer, isTimed, timerItem, TIMER_NAME, PLAN_META, FOCUS, EQUIPMENT, LEVELS } from './routine.js';

const $ = (id) => document.getElementById(id);

/* ---------- 화면 전환 ---------- */
const stack = [];
function show(id) {
  for (const s of document.querySelectorAll('.screen.page')) s.hidden = s.id !== id;
  const tab = $(id).dataset.tab;
  for (const b of document.querySelectorAll('#tabbar button')) b.classList.toggle('active', b.dataset.go === tab);
  document.body.classList.toggle('has-sticky', !!$(id).querySelector('.sticky-bottom'));
  window.scrollTo(0, 0);
}
function go(tab) {
  stack.length = 0;
  const id = `screen-${tab}`;
  render[tab]?.();
  show(id);
}
function push(id, renderFn) {
  const cur = [...document.querySelectorAll('.screen.page')].find((s) => !s.hidden)?.id;
  if (cur) stack.push(cur);
  renderFn?.();
  show(id);
}
function back() {
  const prev = stack.pop() || 'screen-home';
  const tab = $(prev).dataset.tab;
  if (tab) render[tab]?.();
  show(prev);
}
document.addEventListener('click', (e) => {
  const g = e.target.closest('[data-go]');
  if (g) go(g.dataset.go);
  if (e.target.closest('[data-back]')) back();
});

export function toast(msg, ms = 2400) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}

/* ---------- 홈 ---------- */
let homeMode = 'auto';
function renderHome() {
  const draft = store.routineDraft();
  $('routine-sub').textContent = draft?.items?.length
    ? `${draft.items.filter((it) => !isTimer(it)).length}가지 운동 · 약 ${routineMinutes(draft.items)}분`
    : '목표에 맞춰 순서대로 운동하기';
  $('goal-card').innerHTML = goalCardHtml();
  const recent = store.sessions().slice(0, 1);
  $('recent-list').innerHTML = recent.length ? recent.map((sess) => {
    const tot = sessionTotals(sess);
    return `<button class="home-session-row" data-session="${esc(sess.id)}"><span><b>${esc(sessionLine(sess)) || '기록 없음'}</b><small>${tot.min}분 · ${tot.reps}회</small></span>${icon('caret-right')}</button>`;
  }).join('')
    : '<div class="empty">아직 운동 기록이 없어요.</div>';
}

document.addEventListener('click', (e) => {
  const it = e.target.closest('[data-session]');
  if (it) openSummary(it.dataset.session, false);
});

/* ---------- 하루 목표 ---------- */
const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];
const goalStep = (id) => (isHold(id) ? 10 : 5);
const DEF_TIME = { remind: '20:00', lastCall: '22:00', morning: '08:00' };

function goalCardHtml() {
  const g = store.goal();
  if (!hasGoal(g)) {
    return `<div class="card goal-card goal-empty"><div><b>하루 목표</b>
      <div class="muted small">정해 두면 못 채운 날 정한 시각에 알려드려요</div></div>
      <button class="btn btn-secondary" id="btn-goal-edit" type="button">목표 정하기</button></div>`;
  }
  const now = Date.now();
  const p = progress(g, store.sessions(), now);
  const st = streak(g, store.sessions(), now);
  const bar = (pct) => `<span class="grp-bar"><i style="width:${Math.round(pct * 100)}%"></i></span>`;
  const rows = p.items.map((x) => `<div class="goal-row${x.left ? '' : ' done'}"><span class="goal-name">${esc(exName(x.exercise))}</span>
    ${bar(x.pct)}<span class="goal-val">${x.done}/${x.amount}${x.unit}${x.left ? '' : ' ✓'}</span></div>`);
  if (p.minutes) {
    rows.push(`<div class="goal-row${p.minutes.left ? '' : ' done'}"><span class="goal-name">운동 시간</span>
      ${bar(Math.min(1, p.minutes.done / p.minutes.target))}<span class="goal-val">${p.minutes.done}/${p.minutes.target}분${p.minutes.left ? '' : ' ✓'}</span></div>`);
  }
  const items = remainingRoutine(p);
  const min = routineMinutes(items);
  const head = p.met ? '✓ 오늘 목표 달성!' : p.goalDay ? '오늘 목표' : '오늘은 쉬는 날';
  const go = p.met || !items.length ? ''
    : `<button class="btn btn-primary" id="btn-goal-go" type="button">남은 목표 하기${min ? ` · 약 ${min}분` : ''}</button>`;
  const times = [g.remind, g.lastCall].filter(Boolean);
  const note = !canRemind ? '알림은 안드로이드 앱에서만 와요. 웹에선 여기서 남은 양을 확인하세요'
    : !p.goalDay ? '쉬는 날이라 알림이 없어요'
      : p.met ? '오늘은 알림이 없어요. 내일도 화이팅!'
        : times.length ? `${times.join(' · ')}까지 못 채우면 알려드려요` : '알림은 꺼 뒀어요';
  // 7일 연속으로 채웠으면 목표를 조금 올려 보자고 (한 번 물으면 7일 동안 다시 안 물음)
  const bump = p.met && st >= 7 && !(g.bumpAskedAt && now - g.bumpAskedAt < 7 * 86400000)
    ? `<div class="goal-bump">🔥 ${st}일 연속 달성! 목표를 10% 올려 볼까요?
        <span class="btn-row"><button class="btn btn-secondary" id="btn-goal-bump" type="button">올리기</button>
        <button class="btn btn-ghost" id="btn-goal-nobump" type="button">지금이 좋아요</button></span></div>` : '';
  // 주간 목표: 월~일 채운 날을 점으로
  const wk = g.weekly > 0 ? weekProgress(g, store.sessions(), now) : null;
  const week = wk ? `<div class="goal-week"><span class="muted small">이번 주</span>
    <span class="goal-dots">${wk.days.map((ok, i) => `<i class="${ok ? 'on' : ''}" title="${'월화수목금토일'[i]}"></i>`).join('')}</span>
    <span class="goal-val">${wk.done}/${wk.target}일${wk.done >= wk.target ? ' ✓' : ''}</span></div>` : '';
  return `<div class="card goal-card${p.met ? ' met' : ''}">
    <div class="goal-head"><b>${head}</b>${st ? `<span class="goal-streak">🔥 ${st}일 연속</span>` : ''}</div>
    ${rows.join('')}${week}${bump}
    <div class="goal-actions">${go}<button class="btn btn-ghost" id="btn-goal-edit" type="button">바꾸기</button></div>
    <div class="muted small">${note}</div></div>`;
}

let goalDraft = null;
function openGoal() {
  goalDraft = JSON.parse(JSON.stringify(store.goal() || GOAL_DEFAULT));
  goalDraft.on = true;
  push('screen-goal', renderGoal);
}

function renderGoal() {
  const g = goalDraft;
  const row = (l, d, ctl, stacked) => `<div class="setting${stacked ? ' stacked' : ''}"><div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ''}</div>${ctl}</div>`;
  const exOpts = (sel) => GROUPS.map((gr) => `<optgroup label="${gr}">${EXERCISES.filter((e) => e.group === gr)
    .map((e) => `<option value="${e.id}" ${e.id === sel ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</optgroup>`).join('');
  const items = g.items.map((x, i) => `<div class="goal-edit-row">
      <select data-gi-ex="${i}" aria-label="운동">${exOpts(x.exercise)}</select>
      <div class="stepper"><button type="button" class="mini-btn" data-gi-step="${i}" data-d="-1" aria-label="줄이기">−</button>
        <input type="number" inputmode="numeric" min="1" max="2000" data-gi-amt="${i}" value="${x.amount}" aria-label="목표">
        <span class="unit">${isHold(x.exercise) ? '초' : '회'}</span>
        <button type="button" class="mini-btn" data-gi-step="${i}" data-d="1" aria-label="늘리기">+</button></div>
      <button type="button" class="icon-btn gi-del" data-gi-del="${i}" aria-label="빼기">×</button></div>`).join('');
  const minSeg = `<div class="seg" data-goal-seg="minutes">${[[0, '안 씀'], [10, '10분'], [20, '20분'], [30, '30분'], [45, '45분'], [60, '1시간']]
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${g.minutes === v}">${l}</button>`).join('')}</div>`;
  const days = DAY_NAMES.map((d, i) => `<button type="button" class="chip" data-goal-day="${i}" aria-pressed="${g.days.includes(i)}">${d}</button>`).join('');
  const weeklySeg = `<div class="seg" data-goal-seg="weekly">${[[0, '안 씀'], [2, '주 2일'], [3, '3일'], [4, '4일'], [5, '5일'], [6, '6일'], [7, '매일']]
    .map(([v, l]) => `<button type="button" data-v="${v}" aria-pressed="${(g.weekly || 0) === v}">${l}</button>`).join('')}</div>`;
  const time = (k, label, desc) => row(label, desc, `<span class="time-ctl">
      <input type="time" data-goal-time="${k}" value="${esc(g[k] || DEF_TIME[k])}" ${g[k] ? '' : 'disabled'}>
      <label class="switch"><input type="checkbox" data-goal-time-on="${k}" ${g[k] ? 'checked' : ''}><span></span></label></span>`);
  $('goal-body').innerHTML = `
    <div class="card">${row('하루 목표 쓰기', '끄면 홈 카드와 알림이 사라져요', `<label class="switch"><input type="checkbox" id="goal-on" ${g.on ? 'checked' : ''}><span></span></label>`)}</div>
    <h2 class="section-title">운동별 목표 (하루 합계)</h2>
    <div class="card goal-edit">${items || '<p class="muted" style="margin:4px 0">운동을 추가해 주세요</p>'}
      <button class="btn btn-ghost" id="btn-gi-add" type="button">+ 운동 추가</button>
      <p class="muted small" style="margin:6px 0 0">여러 번 나눠서 해도 하루 합계로 세요. 버티기(플랭크 등)는 초</p></div>
    <h2 class="section-title">운동 시간 (선택)</h2>
    <div class="card">${minSeg}<p class="muted small" style="margin:8px 0 0">운동 화면을 켜 둔 시간(쉬는 시간 포함)으로 세요</p></div>
    <h2 class="section-title">목표가 있는 요일</h2>
    <div class="card"><div class="chips">${days}</div>
      <p class="muted small" style="margin:8px 0 0">빠진 요일은 쉬는 날: 알림이 없고 연속 기록도 안 끊겨요</p></div>
    <h2 class="section-title">주간 목표 (선택)</h2>
    <div class="card">${weeklySeg}<p class="muted small" style="margin:8px 0 0">매일 다 채우기 어려우면 일주일(월~일)에 며칠 채울지로. 남은 날이 모자라면 '오늘 꼭'이라고 알려 드려요</p></div>
    <h2 class="section-title">못 채웠을 때 알림</h2>
    <div class="card">
      ${time('remind', '첫 알림', '이 시각까지 목표를 못 채웠으면')}
      ${time('lastCall', '마지막 알림', '그래도 아직이면 한 번 더 (연속 기록이 걸려 있으면 알려 드려요)')}
      ${time('morning', '아침 알림', '오늘 할 것을 미리 (이미 채웠으면 안 와요)')}
      <p class="muted small" id="goal-perm" style="margin:6px 0">${canRemind ? '알림 권한 확인 중…' : '알림은 안드로이드 앱에서만 와요. 웹에선 앱을 열면 홈에서 남은 양을 보여 드려요'}</p>
      <div id="goal-battery"></div>
      ${canRemind ? '<button class="btn btn-secondary" id="btn-goal-test" type="button">알림 시험 (5초 뒤 한 번)</button>' : ''}
    </div>`;
  if (canRemind) {
    notifyPermission().then((st) => {
      const el = $('goal-perm');
      if (!el) return;
      el.textContent = st === 'granted' ? '알림이 허용돼 있어요. 몇 분 늦게 올 수 있어요(배터리 절약)'
        : st === 'denied' ? '알림이 꺼져 있어요 → 폰 설정 → 애플리케이션 → 핸즈프리PT → 알림을 켜 주세요'
          : '저장하면 알림을 보내도 될지 물어봐요';
    });
    // 절전 대상이면 알림이 늦거나(삼성 '잠자는 앱'이면) 아예 안 온다
    batteryState().then((b) => {
      const el = $('goal-battery');
      if (!el || !b) return;
      el.innerHTML = b.state === 'ok'
        ? '<p class="muted small" style="margin:0 0 6px">배터리 사용: 제한 없음 ✓ (알림이 제때 와요)</p>'
        : `<div class="goal-battery-warn"><div><b>배터리 절약 때문에 알림이 늦거나 안 올 수 있어요</b>
          <div class="muted small">'제한 없음'으로 바꿔 주세요.${b.samsung ? ' 삼성은 설정 → 배터리 → 백그라운드 사용 제한에서 \'잠자는 앱\'에 핸즈프리PT가 없어야 해요' : ''}</div></div>
          <button class="mini-btn" id="btn-goal-battery" type="button">제한 없음으로</button></div>`;
    });
  }
}

$('goal-body').addEventListener('click', async (e) => {
  const g = goalDraft;
  const step = e.target.closest('[data-gi-step]');
  if (step) {
    const it = g.items[Number(step.dataset.giStep)];
    const d = goalStep(it.exercise) * Number(step.dataset.d);
    it.amount = Math.max(1, Math.min(2000, (it.amount || 0) + d));
    renderGoal();
    return;
  }
  const del = e.target.closest('[data-gi-del]');
  if (del) { g.items.splice(Number(del.dataset.giDel), 1); renderGoal(); return; }
  if (e.target.closest('#btn-gi-add')) {
    const used = new Set(g.items.map((x) => x.exercise));
    const next = ['squat', 'pushup', 'plank', 'lunge', 'situp', 'jumpingjack', 'curl'].find((id) => !used.has(id)) || 'squat';
    g.items.push({ exercise: next, amount: isHold(next) ? 60 : 20 });
    renderGoal();
    return;
  }
  const seg = e.target.closest('[data-goal-seg] button');
  if (seg) { g[seg.parentElement.dataset.goalSeg] = Number(seg.dataset.v); renderGoal(); return; }
  const day = e.target.closest('[data-goal-day]');
  if (day) {
    const n = Number(day.dataset.goalDay);
    g.days = g.days.includes(n) ? g.days.filter((x) => x !== n) : [...g.days, n].sort();
    renderGoal();
    return;
  }
  if (e.target.closest('#btn-goal-battery')) {
    if (!(await openBatterySettings())) toast('설정 → 애플리케이션 → 핸즈프리PT → 배터리에서 \'제한 없음\'으로 바꿔 주세요', 4000);
    return;
  }
  if (e.target.closest('#btn-goal-test')) {
    const ok = await testReminder(5);
    toast(ok ? '5초 뒤에 알림이 와요. 화면을 꺼 두고 기다려 보세요' : '알림을 허용해야 받을 수 있어요');
  }
});
$('goal-body').addEventListener('change', (e) => {
  const g = goalDraft;
  const ex = e.target.closest('[data-gi-ex]');
  if (ex) {
    const it = g.items[Number(ex.dataset.giEx)];
    const wasHold = isHold(it.exercise);
    it.exercise = ex.value;
    if (wasHold !== isHold(it.exercise)) it.amount = isHold(it.exercise) ? 60 : 20;
    renderGoal();
    return;
  }
  const amt = e.target.closest('[data-gi-amt]');
  if (amt) { g.items[Number(amt.dataset.giAmt)].amount = Math.max(1, Math.min(2000, Math.round(Number(amt.value) || 1))); return; }
  if (e.target.id === 'goal-on') { g.on = e.target.checked; return; }
  const t = e.target.closest('[data-goal-time]');
  if (t && t.value) { g[t.dataset.goalTime] = t.value; return; }
  const on = e.target.closest('[data-goal-time-on]');
  if (on) {
    const k = on.dataset.goalTimeOn;
    g[k] = on.checked ? (document.querySelector(`[data-goal-time="${k}"]`)?.value || DEF_TIME[k]) : '';
    renderGoal();
  }
});
$('btn-goal-save').addEventListener('click', async () => {
  const g = goalDraft;
  g.items = g.items.filter((x) => x.amount > 0 && EXERCISE_BY_ID[x.exercise]);
  // 같은 운동을 두 줄로 넣었으면 합친다
  const merged = new Map();
  for (const x of g.items) merged.set(x.exercise, (merged.get(x.exercise) || 0) + x.amount);
  g.items = [...merged].map(([exercise, amount]) => ({ exercise, amount }));
  if (g.on && !g.days.length) { toast('목표가 있는 요일을 하루 이상 골라 주세요'); return; }
  store.setGoal(g);
  let msg = hasGoal(g) ? `하루 목표: ${goalText(g)}` : '하루 목표를 껐어요';
  if (hasGoal(g) && canRemind && (g.remind || g.lastCall)) {
    const perm = await notifyPermission({ ask: true });
    if (perm !== 'granted') msg = '목표를 저장했어요. 알림을 받으려면 알림을 허용해 주세요';
  }
  await syncReminders();
  toast(msg, 3200);
  back();
});

// 홈 카드 버튼들
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-goal-edit')) { openGoal(); return; }
  if (e.target.closest('#btn-goal-go')) {
    const p = progress(store.goal(), store.sessions());
    const items = remainingRoutine(p);
    if (items.length) workout.start({ plan: { name: '오늘 목표', items } });
    return;
  }
  if (e.target.closest('#btn-goal-bump') || e.target.closest('#btn-goal-nobump')) {
    const g = { ...store.goal(), bumpAskedAt: Date.now() };
    if (e.target.closest('#btn-goal-bump')) {
      g.items = g.items.map((x) => ({ ...x, amount: Math.ceil((x.amount * 1.1) / 5) * 5 }));
      if (g.minutes) g.minutes = Math.ceil((g.minutes * 1.1) / 5) * 5;
      toast(`새 목표: ${goalText(g)}`);
    }
    store.setGoal(g);
    syncReminders();
    renderHome();
  }
});

/* ---------- 폰은 어디에 둘까요 (카메라 거리 안내: placement.js) ---------- */
document.addEventListener('click', (e) => {
  if (e.target.closest('#btn-place-help')) showPlacementHelp();
});

/* ---------- 운동 고르기 ---------- */
let picked = new Set();
let pickFilter = 'all';
function renderPick() {
  picked = new Set(uniqueExerciseFamilies(store.lastPick()));
  pickFilter = 'all';
  $('pick-search').value = '';
  $('pick-groups').innerHTML = '<div id="pick-selected"></div><div class="card" id="pick-weights"></div><div id="pick-catalog"></div>';
  renderPickCatalog();
  updatePickUI();
}
function renderPickCatalog() {
  const query = $('pick-search').value.trim().replace(/\s/g,'').toLowerCase();
  const recent = new Set([...store.lastPick(), ...store.sessions().slice(0,5).flatMap(s=>s.sets.map(x=>x.exercise))]);
  const favorites = store.favoriteExercises();
  const matches = EXERCISES.filter(e => (pickFilter==='all' || (pickFilter==='recent'?recent.has(e.id):favorites.includes(e.id))) && (!query || (e.name+e.id+(e.aliases||[]).join('')).replace(/\s/g,'').toLowerCase().includes(query)));
  $('pick-catalog').innerHTML = matches.length ? GROUPS.map(g=>{
    const items=matches.filter(e=>e.group===g);if(!items.length)return '';
    return `<div class="pick-group">${g}</div><div class="pick-grid">${items.map(e=>`<button class="pick-item" data-pick="${e.id}" aria-pressed="${picked.has(e.id)}"><div class="n">${esc(e.name)}${e.verified?'':' <span class="beta">베타</span>'}${e.auto===false?' <span class="beta">골라서만</span>':''}</div><div class="h">${esc(e.tip)}</div></button>`).join('')}</div>`;
  }).join('') : '<p class="empty">'+(query?'찾는 운동이 없어요.':pickFilter==='favorites'?'운동을 고른 뒤 즐겨찾기에 추가해 보세요.':'아직 최근 운동이 없어요.')+'</p>';
  document.querySelectorAll('[data-pick-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pickFilter===pickFilter)));
}
$('pick-search').addEventListener('input',renderPickCatalog);
document.querySelectorAll('[data-pick-filter]').forEach(b=>b.addEventListener('click',()=>{pickFilter=b.dataset.pickFilter;renderPickCatalog();}));
function updatePickUI() {
  const btn = $('btn-start-picked');
  btn.disabled = picked.size === 0;
  btn.textContent = picked.size === 0 ? '운동을 골라 주세요'
    : picked.size === 1 ? `${exName([...picked][0])} 시작` : `${picked.size}가지 운동으로 시작`;
  $('pick-selected').innerHTML = picked.size ? '<p class="small muted">선택한 운동</p>'+[...picked].map(id=>`<div class="picked-row"><b>${esc(exName(id))}</b><button class="text-btn" data-favorite="${id}" aria-pressed="${store.favoriteExercises().includes(id)}">${store.favoriteExercises().includes(id)?'즐겨찾기 해제':'즐겨찾기 추가'}</button><button class="icon-btn" data-pick="${id}" aria-label="${esc(exName(id))} 선택 해제">${icon('minus')}</button></div>`).join('') + ([...picked].some(id=>EXERCISE_BY_ID[id].family) ? '<p class="small muted">같은 동작의 변형은 하나씩 골라요. 일반 컬과 해머 컬처럼 그립만 다른 운동은 카메라로 구별하기 어려워요.</p>' : '') : '';
  const weights = [...picked].filter((id) => EXERCISE_BY_ID[id].kind === 'reps');
  const box = $('pick-weights');
  box.hidden = weights.length === 0;
  box.innerHTML = '<div style="font-weight:700">무게 (선택)</div><div class="muted small">덤벨·바벨·기구의 무게를 적어두면 세트마다 함께 기록돼요. 나중에 요약 화면에서도 고칠 수 있어요.</div>'
    + weights.map((id) => `<div class="weight-row"><span style="flex:1">${esc(exName(id))}</span>
      <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="kg" data-weight="${id}" value="${store.lastWeight(id) ?? ''}"> kg</div>`).join('');
}
$('pick-groups').addEventListener('click', (e) => {
  const favorite = e.target.closest('[data-favorite]');
  if(favorite){store.toggleFavoriteExercise(favorite.dataset.favorite);updatePickUI();renderPickCatalog();return;}
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  const id = b.dataset.pick;
  if (picked.has(id)) picked.delete(id); else {
    for (const prior of picked) if (exerciseFamily(prior) === exerciseFamily(id)) picked.delete(prior);
    picked.add(id);
  }
  renderPickCatalog();
  updatePickUI();
});
$('pick-groups').addEventListener('change', (e) => {
  const inp = e.target.closest('[data-weight]');
  if (inp) store.rememberWeight(inp.dataset.weight, inp.value === '' ? null : Number(inp.value));
});

/* ---------- 운동 시작/종료 ---------- */
const workout = new Workout({
  onDone: (sess) => {
    if (sess) openSummary(sess.id, true);
    else { toast('기록된 세트가 없어요'); go('home'); }
    syncReminders();
  },
});
document.querySelectorAll('[data-mode]').forEach((button) => button.addEventListener('click', () => {
  homeMode = button.dataset.mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  $('btn-home-start').innerHTML = `${homeMode === 'routine' ? '루틴 확인' : homeMode === 'pick' ? '운동 고르기' : '운동 시작'} ${icon('arrow-right')}`;
}));
$('btn-home-start').addEventListener('click', () => {
  if (homeMode === 'auto') workout.start({ candidates: null });
  else if (homeMode === 'pick') push('screen-pick', renderPick);
  else openRoutine();
});
$('btn-start-pick').addEventListener('click', () => push('screen-pick', renderPick));
function openRoutine() {
  loadDemos().then(() => { if (!$('screen-routine').hidden) renderRoutine(); });
  push('screen-routine', renderRoutine);
}

/* ---------- 오늘의 루틴 (PT 모드) ---------- */
const todayKey = () => new Date().toISOString().slice(0, 10);
const FOCUS_OPTS = [['auto', '추천'], ...Object.entries(FOCUS).map(([k, v]) => [k, v.name])];
const MIN_OPTS = [15, 30, 45, 60];
const fmtSec = (sec) => (sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ''}`);
const itemLine = (it) => {
  if (isTimer(it)) return `${fmtSec(it.sec)} · 30초쯤마다 동작을 바꿔 가며 음성으로 안내`;
  const meta = PLAN_META[it.exercise];
  const what = isTimed(it) ? `${it.workSec}초 동안(인터벌)` : isHold(it.exercise) ? `${it.holdSec}초` : `${it.reps}회`;
  return `${it.sets}세트 × ${what} · 휴식 ${fmtSec(it.rest)}${it.weight ? ` · ${it.weight}kg` : ''}${meta?.note ? ` <span class="muted">(${esc(meta.note)})</span>` : ''}`;
};

function makeRoutine(seedN = 0) {
  const p = store.routinePrefs();
  const common = { equipment: p.equipment, minutes: p.minutes, level: p.level, warmup: p.warmup, sessions: store.sessions(),
    seed: `${todayKey()}#${seedN}`, weightOf: (id) => store.lastWeight(id) };
  let r;
  if (p.plan === 'split' || p.plan === 'pick') {
    // 부위별: 분할이면 오늘 할 날(자동 = 가장 오래 쉰 날), 직접이면 고른 부위. 내 운동(즐겨찾기) 안에서 짠다
    let muscles, title = '', why = '';
    if (p.plan === 'split') {
      const sp = SPLITS[p.split] || SPLITS.three;
      const auto = nextSplitDay(p.split, store.sessions());
      const i = p.splitDay === 'auto' ? auto.index : Math.min(Number(p.splitDay) || 0, sp.days.length - 1);
      muscles = sp.days[i];
      title = sp.days.length > 1 ? `${sp.name} ${i + 1}일차 ${dayName(muscles)}` : `${sp.name} ${dayName(muscles)}`;
      if (p.splitDay === 'auto') why = auto.reason;
    } else {
      muscles = Object.keys(MUSCLES).filter((m) => (p.muscles || []).includes(m));
      if (!muscles.length) muscles = ['chest', 'triceps'];
    }
    r = generateSplitRoutine({ ...common, muscles, mine: store.favoriteExercises(), title });
    r.reason = [why, r.reason].filter(Boolean).join(' · ');
  } else {
    r = generateRoutine({ ...p, ...common });
  }
  store.setRoutineDraft({ ...r, seedN, madeAt: Date.now() });
}

/** 내 운동(자주 하는 운동) 고르기: 부위별로 눌러서 켜고 끈다. 즐겨찾기와 같은 목록 */
function editMyExercises() {
  const d = $('dialog');
  const draw = () => {
    const fav = store.favoriteExercises();
    d.innerHTML = `<form method="dialog" class="my-ex"><h3>내 운동</h3>
      <p class="muted small" style="margin-top:0">자주 하는 운동을 골라 두면 부위별 루틴을 이 안에서 짜요. 고른 운동이 없는 부위만 추천으로 채워요.</p>
      ${Object.entries(MUSCLES).map(([m, label]) => {
        const ids = EXERCISES.filter((e) => MUSCLE_OF[e.id] === m).map((e) => e.id);
        const on = ids.filter((id) => fav.includes(id)).length;
        return `<div class="my-ex-group"><b>${label}${on ? ` <span class="muted small">${on}</span>` : ''}</b><div class="chips">${ids.map((id) =>
          `<button type="button" class="chip" data-my-ex="${id}" aria-pressed="${fav.includes(id)}">${esc(exName(id))}</button>`).join('')}</div></div>`;
      }).join('')}
      <div class="btn-row"><button value="ok" class="btn btn-primary">완료 (${fav.length}가지)</button></div></form>`;
  };
  draw();
  d.onclick = (e) => {
    const b = e.target.closest('[data-my-ex]');
    if (!b) return;
    const y = d.querySelector('form').scrollTop;
    store.toggleFavoriteExercise(b.dataset.myEx);
    draw();
    d.querySelector('form').scrollTop = y;
  };
  d.onclose = () => { d.onclick = null; makeRoutine(0); renderRoutine(); };
  d.showModal();
}

/** 짜는 방식별 줄: 기본 = 부위 묶음, 분할 = 분할 종류·오늘 할 날, 부위 고르기 = 부위 여러 개. 부위별이면 '내 운동' 버튼 */
function planRows(p, segR) {
  const my = `<div class="rm-row"><span>내 운동</span><button class="mini-btn" id="btn-my-ex" type="button">${store.favoriteExercises().length ? `${store.favoriteExercises().length}가지 · 고치기` : '고르기'}</button></div>`;
  if (p.plan === 'split') {
    const sp = SPLITS[p.split] || SPLITS.three;
    const auto = nextSplitDay(p.split, store.sessions());
    const days = sp.days.length > 1 ? `<div class="rm-row"><span>오늘</span>${segR('splitDay', [['auto', `자동 · ${dayName(sp.days[auto.index])}`], ...sp.days.map((ms, i) => [i, `${i + 1}일차 ${dayName(ms)}`])], p.splitDay)}</div>` : '';
    return `<div class="rm-row"><span>분할</span>${segR('split', Object.entries(SPLITS).map(([k, v]) => [k, v.name]), p.split)}</div>${days}${my}`;
  }
  if (p.plan === 'pick') {
    const on = p.muscles || [];
    return `<div class="rm-row"><span>부위</span><div class="chips">${Object.entries(MUSCLES).map(([m, l]) =>
      `<button type="button" class="chip" data-r-muscle="${m}" aria-pressed="${on.includes(m)}">${l}</button>`).join('')}</div></div>${my}`;
  }
  return `<div class="rm-row"><span>부위</span>${segR('focus', FOCUS_OPTS, p.focus)}</div>`;
}

let routineCustomizeOpen = false;
let routineExpanded = false;
function renderRoutine() {
  const old = store.routineDraft();
  if (!old || (old.madeAt && !old.edited && new Date(old.madeAt).toDateString() !== new Date().toDateString())) makeRoutine(0);
  const p = store.routinePrefs(), d = store.routineDraft();
  const segR = (key, opts, cur) => `<div class="seg" data-rseg="${key}">${opts.map(([v,l]) => `<button type="button" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  const items = d?.items || [];
  const exerciseCount = items.filter((it) => !isTimer(it)).length;
  const sets = items.filter((it) => !isTimer(it)).reduce((n,it) => n + it.sets,0);
  const prescription = (it) => isTimer(it) ? fmtSec(it.sec) : `${isTimed(it) ? it.workSec + '초' : isHold(it.exercise) ? it.holdSec + '초' : it.reps + '회'} × ${it.sets}세트`;
  const byMuscle = p.plan === 'split' || p.plan === 'pick';
  const favN = store.favoriteExercises().length;
  $('routine-body').innerHTML = `<div class="routine-intro"><p class="muted">${fmtDate(Date.now())}</p><h1>오늘의 루틴</h1><p class="muted">${esc(d?.name || '내 루틴')}</p><p class="routine-facts">${routineMinutes(items)}분 <span>·</span> ${exerciseCount}가지 운동 <span>·</span> ${sets}세트</p>${d?.counts ? `<p class="muted small routine-counts">${esc(d.counts)}</p>` : ''}</div>
    <div class="routine-list ${routineExpanded?'expanded':''}">${items.map((it,i) => `<button class="r-item" type="button" data-r-edit="${i}" aria-label="${esc(isTimer(it)?it.name:exName(it.exercise))} 수정"><span class="r-no">${String(i+1).padStart(2,'0')}</span><span class="r-name">${esc(isTimer(it)?it.name:exName(it.exercise))}</span><span class="r-prescription">${prescription(it)}</span></button>`).join('')}</div>
    ${items.length>3?`<button class="text-btn routine-expand" id="btn-routine-expand" aria-expanded="${routineExpanded}">${routineExpanded?'접기':`이어서 ${items.length-3}가지 운동`} ${icon('caret-right')}</button>`:''}
    <details id="routine-customize" ${routineCustomizeOpen ? 'open' : ''}><summary>루틴 수정 ${icon('caret-right')}</summary><div class="routine-make">${d?.reason?`<p class="muted small">${esc(d.reason)}</p>`:''}
      <div class="rm-row"><span>짜는 방식</span>${segR('plan',[['basic','기본'],['split','분할'],['pick','부위 고르기']],p.plan||'basic')}</div>
      ${planRows(p, segR)}
      <div class="rm-row"><span>${byMuscle && favN ? '장소 (내 운동이 없는 부위만)' : '장소'}</span>${segR('equipment',Object.entries(EQUIPMENT),p.equipment)}</div>
      <div class="rm-row"><span>시간</span>${segR('minutes',MIN_OPTS.map(m=>[m,`${m}분`]),p.minutes)}</div>
      <div class="rm-row"><span>강도</span>${segR('level',LEVELS.map((l,i)=>[i,l]),p.level)}</div>
      <div class="rm-row"><span>준비운동·마무리</span>${segR('warmup',[['1','넣기'],['0','빼기']],p.warmup === false ? '0':'1')}</div>
      <div class="btn-row"><button class="btn btn-secondary" id="btn-make-routine">처음 구성으로</button><button class="btn btn-secondary" id="btn-shuffle-routine">다른 운동으로</button></div>
      <div class="routine-order">${items.map((it,i)=>`<div class="r-saved"><span>${esc(isTimer(it)?it.name:exName(it.exercise))}${it.why?`<small class="muted">${esc(it.why)}</small>`:''}</span><div>${isTimer(it)?'':`<button class="mini-btn" data-r-demo="${it.exercise}" aria-label="${esc(exName(it.exercise))} 동작 보기">동작</button>`}<button class="mini-btn" data-r-up="${i}" ${i?'':'disabled'} aria-label="위로">${icon('arrow-left')}</button><button class="mini-btn" data-r-down="${i}" ${i<items.length-1?'':'disabled'} aria-label="아래로">${icon('arrow-right')}</button></div></div>`).join('')}</div>
      <div class="btn-row"><button class="btn btn-ghost" id="btn-r-add">운동 추가</button><button class="btn btn-ghost" id="btn-save-routine">루틴 저장</button></div>
    </div></details>
    ${store.routines().length?`<details class="saved-routines"><summary>저장한 루틴</summary>${store.routines().map(r=>`<div class="r-saved"><span>${esc(r.name)}</span><button class="mini-btn" data-r-load="${esc(r.id)}">불러오기</button><button class="icon-btn" data-r-del="${esc(r.id)}" aria-label="루틴 삭제">${icon('trash')}</button></div>`).join('')}</details>`:''}
    <p class="muted routine-helper">횟수와 휴식 시간을 음성으로 안내해요.</p>`;
  $('btn-routine-expand')?.addEventListener('click',()=>{routineExpanded=!routineExpanded;renderRoutine();});
  $('routine-customize').addEventListener('toggle',e=>{routineCustomizeOpen=e.target.open;});
  $('btn-start-routine').disabled = !items.length;
  $('btn-start-routine').textContent = '이 루틴으로 시작';
}

$('routine-body').addEventListener('click', async (e) => {
  const seg = e.target.closest('[data-rseg] button');
  if (seg) {
    const key = seg.parentElement.dataset.rseg;
    const raw = seg.dataset.v;
    // 분할을 바꾸면 오늘 할 날은 다시 자동으로
    store.setRoutinePrefs({ [key]: key === 'warmup' ? raw === '1' : /^\d+$/.test(raw) ? Number(raw) : raw, ...(key === 'split' ? { splitDay: 'auto' } : {}) });
    makeRoutine(0); // 조건을 바꾸면 바로 다시 짠다
    renderRoutine();
    return;
  }
  const mu = e.target.closest('[data-r-muscle]');
  if (mu) {
    const cur = store.routinePrefs().muscles || [];
    const m = mu.dataset.rMuscle;
    const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
    if (!next.length) { toast('부위를 하나 이상 골라 주세요'); return; }
    store.setRoutinePrefs({ muscles: next });
    makeRoutine(0);
    renderRoutine();
    return;
  }
  if (e.target.closest('#btn-my-ex')) { editMyExercises(); return; }
  const d = store.routineDraft();
  if (e.target.closest('#btn-make-routine')) { makeRoutine(0); renderRoutine(); return; }
  if (e.target.closest('#btn-shuffle-routine')) { makeRoutine((d?.seedN || 0) + 1); renderRoutine(); return; }
  const mv = e.target.closest('[data-r-up],[data-r-down]');
  if (mv && d) {
    const i = Number(mv.dataset.rUp ?? mv.dataset.rDown);
    const j = mv.dataset.rUp != null ? i - 1 : i + 1;
    [d.items[i], d.items[j]] = [d.items[j], d.items[i]];
    store.setRoutineDraft({ ...d, edited: true });
    renderRoutine();
    return;
  }
  const ed = e.target.closest('[data-r-edit]');
  if (ed) {
    const i = Number(ed.dataset.rEdit);
    if (isTimer(store.routineDraft()?.items?.[i])) editTimerItem(i); else editRoutineItem(i);
    return;
  }
  const dm = e.target.closest('[data-r-demo]');
  if (dm) { showExerciseInfo(dm.dataset.rDemo); return; }
  if (e.target.closest('#btn-r-add')) { editRoutineItem(null); return; }
  if (e.target.closest('#btn-save-routine') && d) {
    const name = await promptDialog('루틴 저장', '이름', d.name || '내 루틴');
    if (name == null) return;
    store.saveRoutine({ id: d.id || store.uid(), name: name || '내 루틴', items: d.items, savedAt: Date.now() });
    store.setRoutineDraft({ ...d, name: name || d.name });
    toast('내 루틴에 저장했어요');
    renderRoutine();
    return;
  }
  const ld = e.target.closest('[data-r-load]');
  if (ld) {
    const r = store.routines().find((x) => x.id === ld.dataset.rLoad);
    if (r) { store.setRoutineDraft({ name: r.name, id: r.id, items: r.items.map((it) => ({ ...it })), reason: '', edited: true }); renderRoutine(); window.scrollTo(0, 0); }
    return;
  }
  const del = e.target.closest('[data-r-del]');
  if (del && await confirmDialog('이 루틴을 지울까요?', '저장한 루틴만 지워지고 운동 기록은 남아요.', '지우기')) {
    store.deleteRoutine(del.dataset.rDel);
    renderRoutine();
  }
});

// 루틴 한 줄 수정/추가: 운동·세트·목표 횟수(버티기는 초)·휴식·무게
function editRoutineItem(idx) {
  const d = store.routineDraft() || { name: '내 루틴', items: [], reason: '' };
  const it = idx == null ? null : d.items[idx];
  const dlg = $('dialog');
  const cur = it || defaultItem('squat', store.routinePrefs().level);
  const opts = GROUPS.map((g) => `<optgroup label="${g}">${EXERCISES.filter((x) => x.group === g).map((x) =>
    `<option value="${x.id}" ${cur.exercise === x.id ? 'selected' : ''}>${esc(x.name)}${x.verified ? '' : ' (베타)'}</option>`).join('')}</optgroup>`).join('');
  const step = (id, val, label, deltas) => `<div class="field"><label id="${id}-l" for="${id}">${label}</label><div class="stepper">
    ${[...deltas].reverse().map((dl) => `<button type="button" class="mini-btn" data-st="${id}" data-d="${-dl}">−${dl}</button>`).join('')}
    <input type="number" id="${id}" inputmode="numeric" min="0" value="${val}">
    ${deltas.map((dl) => `<button type="button" class="mini-btn" data-st="${id}" data-d="${dl}">+${dl}</button>`).join('')}</div></div>`;
  dlg.innerHTML = `<form method="dialog">
    <h3>${it ? '운동 수정' : '운동 추가'}</h3>
    <div class="field"><label for="ri-ex">운동</label><select id="ri-ex">${opts}</select></div>
    ${step('ri-sets', cur.sets, '세트', [1])}
    <div class="field" id="ri-mode-field"><label>목표 방식</label><div class="seg" id="ri-mode">
      <button type="button" data-mode="reps" aria-pressed="${!isTimed(cur)}">횟수</button>
      <button type="button" data-mode="time" aria-pressed="${isTimed(cur)}">시간(인터벌)</button></div></div>
    ${step('ri-target', isTimed(cur) ? cur.workSec : isHold(cur.exercise) ? cur.holdSec : cur.reps, '목표 횟수', [1, 5])}
    ${step('ri-rest', cur.rest, '휴식(초)', [15])}
    <div class="field" id="ri-w-field"><label>무게 (kg, 선택)</label><input type="number" id="ri-w" inputmode="decimal" min="0" step="0.5" value="${cur.weight ?? ''}"></div>
    <div class="btn-row" style="margin-top:14px">
      ${it ? '<button type="button" class="btn btn-danger" id="ri-del">빼기</button>' : ''}
      <button value="cancel" class="btn btn-ghost">취소</button>
      <button value="ok" class="btn btn-primary">${it ? '저장' : '추가'}</button>
    </div></form>`;
  let mode = isTimed(cur) ? 'time' : 'reps';
  const sync = (changed) => {
    const ex = $('ri-ex').value;
    $('ri-mode-field').hidden = isHold(ex);
    $('ri-mode').querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    $('ri-target-l').textContent = isHold(ex) ? '목표 시간(초)' : mode === 'time' ? '운동 시간(초) — 그동안 한 횟수를 기록' : '목표 횟수';
    $('ri-w-field').hidden = isHold(ex); // 맨몸 운동도 덤벨·바벨을 들 수 있어서 무게 칸은 보여준다
    if (changed) { // 운동을 바꾸면 그 운동의 기본값으로
      const def = defaultItem(ex, store.routinePrefs().level, store.lastWeight(ex));
      $('ri-target').value = isHold(ex) ? def.holdSec : def.reps;
      $('ri-rest').value = def.rest;
      $('ri-w').value = def.weight ?? '';
    }
  };
  sync(false);
  $('ri-ex').onchange = () => { mode = 'reps'; sync(true); };
  $('ri-mode').onclick = (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    mode = b.dataset.mode;
    $('ri-target').value = mode === 'time' ? 30 : (defaultItem($('ri-ex').value, store.routinePrefs().level).reps ?? 10);
    sync(false);
  };
  dlg.querySelectorAll('[data-st]').forEach((b) => {
    b.onclick = () => { const inp = $(b.dataset.st); inp.value = Math.max(0, Number(inp.value || 0) + Number(b.dataset.d)); };
  });
  if (it) {
    $('ri-del').onclick = () => {
      d.items.splice(idx, 1);
      store.setRoutineDraft({ ...d, edited: true });
      dlg.close('deleted');
      renderRoutine();
    };
  }
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const ex = $('ri-ex').value;
    const target = Math.max(1, Math.round(Number($('ri-target').value || 0)));
    const next = {
      exercise: ex,
      sets: Math.min(20, Math.max(1, Math.round(Number($('ri-sets').value || 1)))),
      rest: Math.min(600, Math.max(0, Math.round(Number($('ri-rest').value || 0)))),
    };
    if (isHold(ex)) next.holdSec = target;
    else if (mode === 'time') next.workSec = target;
    else next.reps = target;
    const w = $('ri-w').value;
    if (w !== '' && !isHold(ex) && Number(w) > 0) { next.weight = Number(w); store.rememberWeight(ex, Number(w)); }
    if (it) d.items[idx] = next; else d.items.push(next);
    store.setRoutineDraft({ ...d, edited: true });
    renderRoutine();
  };
  dlg.showModal();
}

// 운동 설명: 막대 인형 동작 + 카메라 두는 곳 + 자세 포인트
function showExerciseInfo(id) {
  const ex = EXERCISE_BY_ID[id];
  if (!ex) return;
  const d = $('dialog');
  const cues = ex.form ? ex.form([], []).map((r) => r[3]).filter(Boolean) : [];
  const note = PLAN_META[id]?.note;
  d.innerHTML = `<form method="dialog"><h3>${esc(ex.name)}</h3>
    ${hasDemo(id) ? '<canvas class="demo-big" id="demo-canvas" aria-label="동작 시범"></canvas>' : '<p class="muted small">이 운동은 아직 동작 시범이 없어요.</p>'}
    <p class="small" style="margin:8px 0 4px">${esc(ex.tip)}${note ? ` · ${esc(note)}` : ''}</p>
    ${cues.length ? `<ul class="feedback small">${cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <div class="btn-row"><button value="ok" class="btn btn-primary">닫기</button></div></form>`;
  const stop = hasDemo(id) ? playDemo($('demo-canvas'), id, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim() || '#4a7a00', dim: 'rgba(120,130,140,.45)' }) : null;
  d.onclose = () => stop?.();
  d.showModal();
}

// 준비운동·마무리 시간 고치기
function editTimerItem(idx) {
  const d = store.routineDraft();
  const it = d?.items?.[idx];
  if (!it) return;
  const dlg = $('dialog');
  dlg.innerHTML = `<form method="dialog"><h3>${esc(it.name)}</h3>
    <div class="field"><label>시간(초)</label><div class="stepper">
      <button type="button" class="mini-btn" data-st="rt-sec" data-d="-30">−30</button>
      <input type="number" id="rt-sec" inputmode="numeric" min="30" value="${it.sec}">
      <button type="button" class="mini-btn" data-st="rt-sec" data-d="30">+30</button></div></div>
    <div class="btn-row" style="margin-top:14px"><button type="button" class="btn btn-danger" id="rt-del">빼기</button>
      <button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">저장</button></div></form>`;
  dlg.querySelectorAll('[data-st]').forEach((b) => {
    b.onclick = () => { const inp = $(b.dataset.st); inp.value = Math.max(30, Number(inp.value || 0) + Number(b.dataset.d)); };
  });
  $('rt-del').onclick = () => { d.items.splice(idx, 1); store.setRoutineDraft({ ...d, edited: true }); dlg.close('deleted'); renderRoutine(); };
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    d.items[idx] = { ...it, sec: Math.max(30, Math.round(Number($('rt-sec').value || 0))) };
    store.setRoutineDraft({ ...d, edited: true });
    renderRoutine();
  };
  dlg.showModal();
}

export function promptDialog(title, label, value = '') {
  return new Promise((resolve) => {
    const d = $('dialog');
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3>
      <div class="field"><label for="pd-v">${esc(label)}</label><input type="text" id="pd-v" value="${esc(value)}" maxlength="30"></div>
      <div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">확인</button></div></form>`;
    d.onclose = () => resolve(d.returnValue === 'ok' ? $('pd-v').value.trim() : null);
    d.showModal();
  });
}

$('btn-start-routine').addEventListener('click', () => {
  const d = store.routineDraft();
  if (!d?.items?.length) return;
  workout.start({ plan: { name: d.name || '오늘 루틴', items: d.items } });
});
$('btn-start-picked').addEventListener('click', () => {
  const ids = [...picked];
  store.setLastPick(ids);
  workout.start({ candidates: ids });
});

/* ---------- 요약 / 상세 ---------- */
let curSession = null;
let curFresh = false;
function openSummary(id, fresh) {
  curSession = store.getSession(id);
  if (!curSession) return;
  curFresh = !!fresh;
  if (fresh) { stack.length = 0; stack.push('screen-home'); push('screen-summary', renderSummary); stack.length = 1; }
  else push('screen-summary', renderSummary);
  $('summary-title').textContent = fresh ? '운동 완료' : fmtDate(curSession.start);
  $('btn-summary-done').textContent = fresh ? '완료' : '닫기';
  if (fresh && store.settings().healthSync) healthSave(curSession);
}
function renderSummary() {
  const s = curSession, tot = sessionTotals(s), by = new Map();
  for (const set of s.sets) { if (!by.has(set.exercise)) by.set(set.exercise,[]); by.get(set.exercise).push(set); }
  const mode = s.mode === 'routine' ? '루틴' : s.mode === 'pick' ? '선택 운동' : '자유 운동';
  let html = `<div class="summary-intro"><h1>${curFresh ? '운동 완료' : '운동 기록'}</h1><p class="muted">${fmtDate(s.start)} · ${mode}</p><p class="summary-facts">${tot.min}분 <span>·</span> ${tot.sets}세트 <span>·</span> ${tot.reps}회</p></div>`;
  const tips = [];
  for (const [ex,sets] of by) {
    const total = sets.reduce((n,x)=>n+(x.kind==='hold'?x.holdSec:x.reps||0),0);
    html += `<div class="ex-block"><div class="ex-head"><span class="n">${esc(exName(ex))}</span><span class="s">${total}${sets[0].kind==='hold'?'초':'회'}</span></div>`;
    sets.forEach((set,i)=>{
      const feedback = postureFeedback(set);
      const edited = set.edited || set.added;
      const quality = !edited && feedback?.bad ? `<span class="q warn">자세 지적 ${feedback.bad}회</span>` : '';
      html += `<div class="set-row"><div class="set-no">${i+1}세트</div><div class="set-main"><div class="v">${setValue(set)}${set.weight?` <span class="muted small">× ${set.weight}kg</span>`:''}</div>${edited?`<span class="q">${set.added?'직접 추가':'직접 수정'}</span>`:quality}</div><button class="icon-btn" data-edit-set="${esc(set.id)}" aria-label="${esc(exName(ex))} ${i+1}세트 수정">${icon('pencil-simple')}</button></div>`;
      const a = assessment(set);
      if (a.exercise===set.exercise && a.kind===set.kind) for (const [code,n] of Object.entries(a.issues||{})) { const info=formInfo(ex,code); if(info) tips.push({ex,code,n,info}); }
    });
    html += '</div>';
  }
  html += `<button class="note-action text-btn" id="btn-session-note">${icon('pencil-simple')} ${s.note||s.effort?'메모 수정':'메모 추가'} ${icon('caret-right')}</button>${s.note||s.effort?`<p class="session-note">${s.effort?['','쉬웠어요','적당했어요','힘들었어요'][s.effort]+(s.note?' · ':''):''}${esc(s.note||'')}</p>`:''}`;
  html += `<details class="summary-details"><summary>자세 피드백 · 상세 기록 ${icon('caret-right')}</summary>`;
  if(tips.length) {
    const merged=new Map();
    for(const t of tips){const key=t.ex+t.code;merged.set(key,{...t,n:t.n+(merged.get(key)?.n||0)});}
    html += `<ul class="feedback">${[...merged.values()].map(t=>`<li>${esc(exName(t.ex))} · ${esc(t.info.tip)} (${t.n}${EXERCISE_BY_ID[t.ex]?.kind==='hold'?'초':'회'})</li>`).join('')}</ul>`;
  } else {
    const feedback=s.sets.map(postureFeedback).filter(Boolean),bad=feedback.reduce((n,f)=>n+f.bad,0);
    html += `<p class="muted">${bad?`분석한 동작에서 자세 지적 ${bad}회. 상세 항목은 기록되지 않았어요.`:feedback.length?'분석한 동작에서 자세 지적이 없어요.':'이 기록에는 자세 분석이 없어요.'}</p>`;
  }
  for(const set of s.sets) if(tempoRow(set)) html += `<div class="summary-tempo">${esc(exName(set.exercise))} · ${setValue(set)}${tempoRow(set)}</div>`;
  html += '<button class="btn btn-ghost" id="btn-add-set">세트 직접 추가</button>';
  if(NativeHealth && healthEligible(s)) html += s.health ? '<p class="muted">헬스 커넥트에 저장됨</p><button class="mini-btn" id="btn-hc-view">보기</button>' : '<button class="btn btn-secondary" id="btn-hc-save">헬스 커넥트에 저장</button>';
  if(curFresh && s.source==='camera' && workout.canExportDiag) html += '<button class="btn btn-secondary" id="btn-diag">인식 진단 기록 저장</button>';
  html += '</details>';
  $('summary-body').innerHTML = html;
}

// 세트의 템포: 반복별 힘주기 속도 막대 + 평균 시간
function tempoRow(set) {
  const def = EXERCISE_BY_ID[set.exercise]?.tempo;
  const list = set.tempo;
  if (!def || !list?.some(Boolean) || set.edited) return '';
  const sum = set.tempoSum || tempoSummary(list);
  const sp = tempoSpeeds(list);
  const vals = list.map((x) => (x ? (sp.metric ? x.conSpeed : x.conRate) : null));
  const ok = vals.filter((v) => v != null);
  const top = Math.max(...ok, 1e-9);
  const best = Math.max(...ok.slice(0, 3));
  const bars = vals.map((v, i) => {
    const h = v == null ? 2 : Math.max(2, (v / top) * 28);
    const cls = v == null ? 'none' : i && v < 0.8 * best ? 'slow' : 'con';
    return `<rect class="${cls}" x="${i * 10 + 1}" y="${30 - h}" width="8" height="${h}" rx="2"/>`;
  }).join('');
  const sec = (v) => (v == null ? '-' : `${v.toFixed(1)}초`);
  const parts = [`${def.con} ${sec(sum.con)}`, `${def.ecc} ${sec(sum.ecc)}`];
  if (sum.speed != null) parts.push(`${sum.speed.toFixed(2)}m/s`);
  if (sum.loss != null && sum.loss >= 10) parts.push(`막판 속도 −${sum.loss}%`);
  return `<div class="tempo-row"><svg class="tempo-bars" viewBox="0 0 ${vals.length * 10} 30" style="width:${Math.min(160, vals.length * 11)}px" aria-hidden="true">${bars}</svg>
    <span class="tempo-txt">${esc(parts.join(' · '))}</span></div>`;
}

// 진단 기록 내보내기: 실제로 한 운동·횟수를 같이 적어 받으면 어디서 틀렸는지 바로 찾을 수 있다
function exportDiag() {
  const d = $('dialog');
  // 진단 기록은 마지막 운동의 것: 요약 화면에서 고친 세트가 그대로 정답이 된다
  const sess = store.getSession(workout.lastSession?.id) || workout.lastSession;
  const fixes = corrections(sess, exName);
  d.innerHTML = `<form method="dialog"><h3>진단 기록 저장·공유</h3>
    <p class="muted small" style="margin-top:0">AI 가 본 관절 좌표만 담겨요(영상·사진 없음, 최근 20분). 실제로 한 운동과 횟수를 적어 주면 어디서 틀렸는지 바로 찾을 수 있어요.</p>
    ${fixes.length ? `<p class="small" style="margin:0 0 8px">✓ 요약 화면에서 고친 세트 ${fixes.length}개가 정답으로 함께 담겨요.</p>` : ''}
    <div class="field"><label for="diag-note">실제로 한 운동·횟수 (선택)</label>
      <textarea id="diag-note" rows="${Math.min(6, Math.max(3, fixes.length + 1))}" placeholder="예: 스쿼트 12, 10, 10 / 랫풀다운 12 (2세트는 안 셌음)">${esc(fixes.map((f) => f.text).join('\n'))}</textarea></div>
    <div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">파일 만들기</button></div></form>`;
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const note = $('diag-note').value.trim();
    toast('진단 기록 만드는 중…', 15000);
    try {
      const f = await workout.exportDiag(note, sess);
      const mb = `${(f.bytes.length / 1048576).toFixed(1)}MB`;
      if (isNative) {
        await shareBinaryFile(f.name, f.bytes);
      } else {
        const file = new File([f.bytes], f.name, { type: f.mime });
        let shared = false;
        if (navigator.canShare?.({ files: [file] })) {
          try { await navigator.share({ files: [file], title: '핸즈프리 PT 진단 기록' }); shared = true; } catch (err) { if (err?.name === 'AbortError') shared = true; }
        }
        if (!shared) {
          const a = document.createElement('a');
          a.href = URL.createObjectURL(file);
          a.download = f.name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        }
      }
      toast(`진단 기록 ${mb} 준비 완료`);
    } catch (err) {
      if (!/cancel/i.test(err?.message || '')) toast('내보내지 못했어요');
    }
  };
  d.showModal();
}
$('summary-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-set]');
  if (b) editSet(b.dataset.editSet);
  if (e.target.closest('#btn-add-set')) editSet(null);
  if (e.target.closest('#btn-session-note')) editSessionNote();
  if (e.target.closest('#btn-diag')) exportDiag();
  if (e.target.closest('#btn-hc-save')) healthSave(curSession, { ask: true });
  if (e.target.closest('#btn-hc-view')) NativeHealth?.openSettings().catch((err) => toast(err.message || '열지 못했어요'));
});
$('btn-summary-done').addEventListener('click', () => { go('home'); });
$('btn-delete-session').addEventListener('click', async () => {
  if (!curSession) return;
  if (!(await confirmDialog('이 운동 기록을 지울까요?', '지운 기록은 되돌릴 수 없어요.', '지우기'))) return;
  store.deleteSession(curSession.id);
  syncReminders();
  if (curSession.health && NativeHealth) NativeHealth.deleteWorkout({ id: curSession.id }).catch(() => {});
  toast(curSession.health && NativeHealth ? '기록을 지웠어요 (헬스 커넥트에서도)' : '기록을 지웠어요');
  go('home');
});

function editSessionNote() {
  const d=$('dialog'), s=curSession;
  d.innerHTML=`<form method="dialog"><h3>운동 메모</h3><label for="session-effort">체감 강도</label><select id="session-effort">${[['','선택하지 않음'],[1,'쉬웠어요'],[2,'적당했어요'],[3,'힘들었어요']].map(([v,l])=>`<option value="${v}" ${String(s.effort||'')===String(v)?'selected':''}>${l}</option>`).join('')}</select><label for="session-note">오늘 운동은 어땠나요?</label><textarea id="session-note" maxlength="500" placeholder="느낀 점을 짧게 남겨 보세요.">${esc(s.note||'')}</textarea><div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">저장</button></div></form>`;
  d.onclose=()=>{if(d.returnValue!=='ok')return;s.note=$('session-note').value.trim();s.effort=Number($('session-effort').value)||null;store.upsertSession(s);renderSummary();};d.showModal();
}

function editSet(setId) {
  const s = curSession;
  const set = setId ? s.sets.find((x) => x.id === setId) : null;
  const d = $('dialog');
  const exOpts = EXERCISES.map((e) => `<option value="${e.id}" ${set?.exercise === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  d.innerHTML = `<form method="dialog">
    <h3>${set ? '세트 수정' : '세트 추가'}</h3>
    <div class="field"><label for="ed-ex">운동</label><select id="ed-ex">${exOpts}</select></div>
    <div class="field"><label id="ed-unit-l" for="ed-val">횟수</label><div class="stepper">
      <button type="button" class="mini-btn" data-step="-1">−</button>
      <input type="number" id="ed-val" inputmode="numeric" min="0" value="${set ? (set.kind === 'hold' ? set.holdSec : set.reps) : 10}">
      <button type="button" class="mini-btn" data-step="1">+</button></div></div>
    <div class="field" id="ed-w-field"><label for="ed-w">무게 (kg, 선택)</label><input type="number" id="ed-w" inputmode="decimal" min="0" step="0.5" value="${set?.weight ?? ''}"></div>
    <div class="btn-row" style="margin-top:14px">
      ${set ? '<button type="button" class="btn btn-danger" id="ed-del">삭제</button>' : ''}
      <button value="cancel" class="btn btn-ghost">취소</button>
      <button value="ok" class="btn btn-primary" id="ed-ok">저장</button>
    </div></form>`;
  const sync = () => {
    const hold = EXERCISE_BY_ID[$('ed-ex').value].kind === 'hold';
    $('ed-unit-l').textContent = hold ? '버틴 시간(초)' : '횟수';
    $('ed-w-field').hidden = hold;
  };
  sync();
  $('ed-ex').onchange = sync;
  d.querySelectorAll('[data-step]').forEach((b) => {
    b.onclick = () => { $('ed-val').value = Math.max(0, Number($('ed-val').value || 0) + Number(b.dataset.step)); };
  });
  if (set) {
    $('ed-del').onclick = () => {
      s.sets = s.sets.filter((x) => x.id !== set.id);
      if (!set.added) {
        const o = set.orig || set;
        (s.removedSets ||= []).push({ exercise: o.exercise, kind: o.kind, reps: o.reps, holdSec: o.holdSec, start: set.start, end: set.end });
      }
      store.upsertSession(s);
      d.close('deleted');
      renderSummary();
      syncReminders();
      if (s.health) healthSave(s, { update: true });
    };
  }
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    const ex = $('ed-ex').value;
    const hold = EXERCISE_BY_ID[ex].kind === 'hold';
    const val = Math.max(0, Math.round(Number($('ed-val').value || 0)));
    const w = $('ed-w').value === '' ? null : Number($('ed-w').value);
    const target = set || { id: store.uid(), start: s.end || s.start, end: s.end || s.start, issues: {}, good: null, added: true };
    editRecordedSet(target, { exercise: ex, kind: hold ? 'hold' : 'reps', value: val, weight: hold ? null : w });
    if (!set) s.sets.push(target);
    if (!hold && w != null) store.rememberWeight(ex, w);
    store.upsertSession(s);
    renderSummary();
    syncReminders();
    if (s.health) healthSave(s, { update: true });
  };
  d.showModal();
}

export function confirmDialog(title, body, okText = '확인', { danger = true } = {}) {
  return new Promise((resolve) => {
    const d = $('dialog');
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn ${danger ? 'btn-danger' : 'btn-primary'}">${esc(okText)}</button></div></form>`;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.showModal();
  });
}

/* ---------- 헬스 커넥트(삼성 헬스·구글 피트니스 연동, 안드로이드 앱만) ---------- */
let healthIssue = ''; // 마지막 확인에서 안 된 이유: unavailable | denied | error
/** 쓸 수 있고 권한이 있는가. ask 면 설치 안내·권한 창까지 */
async function healthReady({ ask = true } = {}) {
  if (!NativeHealth) return false;
  healthIssue = '';
  try {
    let st = await NativeHealth.status();
    if (!st.available) {
      healthIssue = 'unavailable';
      if (!ask) return false;
      if (st.needsUpdate) {
        const go = await confirmDialog('헬스 커넥트가 필요해요',
          '안드로이드 13 이하에선 플레이 스토어에서 "헬스 커넥트" 앱을 설치(또는 업데이트)해야 해요. 설치한 뒤 다시 켜 주세요.', '스토어 열기', { danger: false });
        if (go) await NativeHealth.install();
      } else toast('이 폰은 헬스 커넥트를 지원하지 않아요 (안드로이드 9 이상)');
      return false;
    }
    if (!st.granted && ask) st = await NativeHealth.requestPermission();
    if (!st.granted) healthIssue = 'denied';
    return !!st.granted;
  } catch (err) {
    healthIssue = 'error';
    if (ask) toast(`헬스 커넥트 오류: ${err.message || err}`);
    return false;
  }
}
/** 운동 1회를 헬스 커넥트에 저장(같은 운동은 덮어써서 고침). auto = 운동 끝나고 자동, update = 세트 수정 뒤 */
async function healthSave(s, { ask = false, update = false } = {}) {
  if (!NativeHealth || !healthEligible(s)) return false;
  if (!(await healthReady({ ask }))) {
    if (!ask) toast(healthIssue === 'denied' ? '헬스 커넥트 권한이 꺼져 있어 저장하지 못했어요 (설정 → 건강 앱 연동)' : '헬스 커넥트를 쓸 수 없어 저장하지 못했어요');
    else if (healthIssue === 'denied') toast('권한을 허용해야 헬스 커넥트에 저장할 수 있어요');
    return false;
  }
  try {
    await NativeHealth.writeWorkout(toHealthRecord(s, store.settings().bodyKg || 70));
    s.health = { at: Date.now() };
    store.upsertSession(s);
    toast(update ? '헬스 커넥트 기록도 고쳤어요' : '헬스 커넥트에 저장했어요');
    if (curSession?.id === s.id && !$('screen-summary').hidden) renderSummary();
    return true;
  } catch (err) {
    toast(`헬스 커넥트에 저장하지 못했어요: ${err.message || err}`);
    return false;
  }
}

/* ---------- 설정 ---------- */
function seg(key, options) {
  const cur = store.settings()[key];
  return `<div class="seg" data-seg="${key}">${options.map(([v, l]) =>
    `<button type="button" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
}
function sw(key) {
  return `<label class="switch"><input type="checkbox" data-sw="${key}" ${store.settings()[key] ? 'checked' : ''}><span></span></label>`;
}
const fmtRest = (sec) => (sec <= 0 ? '끔' : sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ''}`);
let camList = null; // '카메라 찾기'로 찾은 목록 (이번 실행 동안만)

/** 목소리·빠르기를 바꾸면 바로 한 번 들려준다 */
async function voiceSample() {
  const v = workout.voice;
  v.enabled = true;
  v.unlock();
  await v.configure(store.settings());
  v.count(12, '좋아요. 이렇게 셀게요');
}
/** 목소리 목록은 폰에 물어봐야 해서 화면을 그린 뒤 채운다 */
async function fillVoices() {
  const vs = await workout.voice.voices();
  const sel = $('voice-name');
  if (!sel) return;
  const cur = store.settings().voiceName;
  sel.innerHTML = `<option value="">폰 기본</option>${vs.map((v, i) =>
    `<option value="${esc(v.name)}"${v.name === cur ? ' selected' : ''}>${esc(voiceLabel(v, i))}</option>`).join('')}`;
  sel.closest('.setting').hidden = !vs.length;
}

function renderSettings() {
  const st = store.settings();
  const row = (l, d, ctl, stacked) => `<div class="setting${stacked ? ' stacked' : ''}"><div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ''}</div>${ctl.replace('type="checkbox"',`type="checkbox" aria-label="${esc(l)}"`)}</div>`;
  const alerts = st.restAlerts || [];
  const chip = (v, l) => `<button type="button" class="chip" data-alert="${v}" aria-pressed="${alerts.includes(v)}">${l}</button>`;
  const camName = st.cameraId ? (st.cameraLabel || '고른 카메라') : '전면 기본';
  // 넓게 보이는 순: 시야각(안드로이드 앱만 앎)·전신이 들어오는 가장 가까운 거리, 후면은 화면이 반대쪽이라 소리로 센다
  const camOpts = camList
    ? [{ deviceId: '', name: '전면 기본(자동)' }, ...camList].map((c) => {
      const label = c.fovLong ? `${c.name} · 시야 ${c.fovLong}°` : c.name;
      const sub = [c.distance ? `${c.distance}m부터` : '', c.facing === 'environment' ? '화면 반대쪽 · 소리로 셈' : ''].filter(Boolean).join(' · ');
      return `<button type="button" class="chip cam-chip" data-cam-id="${esc(c.deviceId)}" data-cam-name="${esc(label)}" aria-pressed="${st.cameraId === c.deviceId}">
        <b>${esc(label)}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</button>`;
    }).join('')
    : '';
  $('settings-body').innerHTML = `
    <div class="card">
      ${row('음성 안내', '횟수·세트·휴식을 소리로 알려줘요', sw('voice'))}
      ${row('소리 확인', '운동 전에 한 번 들어보세요', '<button class="mini-btn" id="btn-voice-test" type="button">들어보기</button>')}
      ${row('숫자 읽기', '', seg('countStyle', [['native', '하나 둘 셋'], ['number', '일 이 삼']]))}
      ${row('말 빠르기', '', seg('voiceRate', [['slow', '느리게'], ['normal', '보통'], ['fast', '빠르게']]))}
      ${row('목소리', '폰에 깔린 한국어 목소리 중에서', '<select id="voice-name" class="voice-select" aria-label="목소리"><option value="">폰 기본</option></select>')}
      ${isNative ? row('음악 소리 줄이기', '말할 때만 잠깐 — 음악을 틀어 두고 운동할 때', sw('voiceDuck')) : ''}
      ${row('자세 교정 음성', '같은 문제가 반복될 때만 짧게 말해요', sw('cues'))}
    </div>
    <h2 class="section-title">하루 목표·알림</h2>
    <div class="card">
      ${row('하루 목표', hasGoal(store.goal()) ? `${esc(goalText(store.goal()))}${[store.goal().remind, store.goal().lastCall].filter(Boolean).length ? ` · 알림 ${[store.goal().remind, store.goal().lastCall].filter(Boolean).join('·')}` : ''}` : '정해 두면 홈에 진행이 보이고, 못 채운 날 알려드려요',
        '<button class="mini-btn" id="btn-goal-settings" type="button">바꾸기</button>', true)}
    </div>
    <h2 class="section-title">세트·휴식</h2>
    <div class="card">
      ${row('세트 끝 판정', '반복을 멈추고 이만큼 지나면 그 세트를 기록하고 휴식으로 넘어가요. 자동은 평소 반복 간격의 2배쯤(3.5~12초)',
        seg('setEndSec', [[0, '자동'], [3, '3초'], [5, '5초'], [8, '8초'], [10, '10초'], [15, '15초']]), true)}
      ${row('휴식 시간', '세트가 끝나면 자동으로 시작. 운동 중엔 +30초·휴식 끝내기 버튼', `<div class="rest-ctl">
        <div class="stepper"><button type="button" class="mini-btn" data-rest-step="-15">−15초</button>
        <b class="rest-val">${fmtRest(st.rest)}</b>
        <button type="button" class="mini-btn" data-rest-step="15">+15초</button></div>
        ${seg('rest', [[0, '끔'], [30, '30초'], [60, '1분'], [90, '1분30'], [120, '2분'], [180, '3분']])}</div>`, true)}
      ${row('손 들어 휴식 끝내기', '쉬는 동안 두 손을 머리 위로 쭉 뻗고 2초 — 폰을 만지지 않고 다음 세트로 (팔을 머리 위로 드는 운동 앞에선 꺼져요)', sw('handGesture'))}
      ${row('다시 시작 알림', '휴식이 끝나기 전에 소리로 알려줘요 (여러 개 고를 수 있어요). 끝나면 삐 소리와 함께 안내',
        `<div class="chips">${chip(30, '30초 전')}${chip(10, '10초 전')}${chip(5, '5초 전')}${chip(3, '셋·둘·하나')}</div>`, true)}
    </div>
    <h2 class="section-title">카메라</h2>
    <div class="card">
      ${row('폰은 어디에?', '바닥에 똑바로 세우면 머리까지 담으려고 멀리(2.7m) 가야 해요. 탁자 위나 바닥에서 뒤로 기울이면 1.5m 안팎',
        '<button class="mini-btn" id="btn-place-help-settings" type="button">거리 보기</button>')}
      ${row('사용할 카메라', `지금: ${esc(camName)}. 자동 모드에서 넓게 보기를 켜면 전면 광각을 우선 써요. 시야가 넓은 카메라일수록 가까이 둬도 돼요${NativeCameraInfo ? '' : ' (시야각은 안드로이드 앱에서 보여요)'}`,
        `<div class="cam-ctl"><button class="mini-btn" id="btn-cam-scan" type="button">${camList ? '다시 찾기' : '카메라 찾기'}</button>
        ${camList ? `<div class="chips">${camOpts}</div>` : ''}</div>`, true)}
      ${row('넓게 보기', '4:3 화면(센서 전체)으로 찍어 좌우가 더 보여요. 줌은 1배 아래로 못 내려가서, 더 넓게 보려면 광각 카메라를 골라야 해요. 운동 화면에 실제 카메라·화면 비율·줌을 표시해요', sw('cameraWide'))}
      ${row('화면 좌우 반전', '거울처럼 보이기 (전면 카메라일 때만)', sw('mirror'))}
    </div>
    <h2 class="section-title">인식</h2>
    <div class="card">
      ${row('인식 모델', '빠름은 오래된 폰용 (정확도는 떨어져요)', seg('model', [['full', '정확'], ['lite', '빠름']]))}
      ${row('GPU 가속', '뼈대가 안 그려지거나 앱이 멈추면 꺼 보세요(호환 모드)', sw('gpu'))}
      ${row('분석 속도', '절전은 배터리·발열이 절반 가까이 줄어요(기본). 아주 빠른 동작이 덜 세지면 빠름으로', seg('analysisFps', [[15, '절전'], [30, '빠름']]))}
      ${row('자동 인식 확정', '몇 번 반복하면 운동 종류를 확정할지', seg('lockReps', [[2, '2회'], [3, '3회']]))}
      ${row('인식 과정 보기', '왜 안 세졌는지 화면에 표시 (조정용)', sw('debug'))}
    </div>
    <h2 class="section-title">화면</h2>
    <div class="card">${row('테마', '', seg('theme', [['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']]))}</div>
    ${NativeHealth ? `<h2 class="section-title">건강 앱 연동</h2>
    <div class="card">
      ${row('헬스 커넥트에 저장', '운동이 끝나면 운동 종류·시간·세트별 횟수·칼로리 어림값을 헬스 커넥트에 저장해요(읽지는 않아요). 삼성 헬스에도 보이려면 헬스 커넥트의 앱 권한에서 삼성 헬스가 운동을 읽도록 허용돼 있어야 해요', sw('healthSync'), true)}
      ${row('헬스 커넥트 열기', '저장된 기록 보기·지우기, 권한 끄기', '<button class="mini-btn" id="btn-hc-settings" type="button">열기</button>')}
    </div>` : ''}
    <h2 class="section-title">내 정보</h2>
    <div class="card">${row('몸무게', '운동 칼로리 어림값 계산에만 써요', `<span class="num-input"><input type="number" inputmode="decimal" min="30" max="250" step="0.5" data-num="bodyKg" value="${st.bodyKg ?? 70}"> kg</span>`)}</div>
    <h2 class="section-title">녹화한 영상으로 분석</h2>
    <div class="card">
      <p class="muted small" style="margin-top:0">운동하는 모습을 찍어둔 영상을 넣으면 똑같이 세고 기록해요. 영상은 이 기기 안에서만 처리돼요.</p>
      <label class="btn btn-secondary btn-lg" style="cursor:pointer">영상 파일 고르기<input type="file" accept="video/*" id="video-file" hidden></label>
    </div>
    <h2 class="section-title">데이터</h2>
    <div class="card stack">
      <p class="muted small" style="margin:0">기록은 이 폰의 브라우저 안에만 저장돼요. 폰을 바꾸거나 브라우저 데이터를 지우기 전에 백업해 두세요.</p>
      <div class="btn-row"><button class="btn btn-secondary" id="btn-export">백업 파일 저장</button>
      <label class="btn btn-secondary" style="cursor:pointer">백업 불러오기<input type="file" accept="application/json,.json" id="import-file" hidden></label></div>
      ${workout.canExportDiag ? '<button class="btn btn-secondary" id="btn-diag-settings">마지막 운동 진단 기록 저장·공유</button>' : ''}
      <button class="btn btn-danger" id="btn-wipe">모든 기록 지우기</button>
      ${store.storageOk() ? '' : '<p class="small" style="color:var(--danger);margin:0">⚠ 이 브라우저에선 저장이 막혀 있어요(사생활 보호 모드?). 앱을 닫으면 기록이 사라져요.</p>'}
    </div>
    <p class="muted small" style="text-align:center;margin-top:20px">핸즈프리 PT · 포즈 인식 MediaPipe · 영상은 폰 밖으로 나가지 않아요</p>`;
  fillVoices();
}
$('settings-body').addEventListener('click', async (e) => {
  if (e.target.closest('#btn-goal-settings')) { openGoal(); return; }
  if (e.target.closest('#btn-place-help-settings')) { showPlacementHelp(); return; }
  if (e.target.closest('#btn-hc-settings')) {
    NativeHealth?.openSettings().catch((err) => toast(err.message || '헬스 커넥트를 열지 못했어요'));
    return;
  }
  const b = e.target.closest('[data-seg] button');
  if (b) {
    const key = b.parentElement.dataset.seg;
    const raw = b.dataset.v;
    const v = /^\d+$/.test(raw) ? Number(raw) : raw;
    store.setSetting(key, v);
    if (key === 'theme') applyTheme();
    renderSettings();
    if (key === 'voiceRate' || key === 'countStyle') voiceSample();
    return;
  }
  if (e.target.closest('#btn-export')) {
    const name = `handsfree-pt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    if (canShareFile) {
      // 앱(WebView)에선 다운로드가 안 되므로 공유 창으로 저장 위치를 고르게 한다
      shareTextFile(name, store.exportJSON()).catch((err) => { if (!/cancel/i.test(err?.message)) toast('내보내지 못했어요'); });
    } else {
      const blob = new Blob([store.exportJSON()], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }
  }
  if (e.target.closest('#btn-voice-test')) {
    const v = workout.voice;
    v.enabled = true;
    v.unlock();
    await v.configure(store.settings());
    v.say('하나, 둘, 셋. 소리가 잘 들리나요?', { interrupt: true });
    if (isNative && !(await v.koreanAvailable())) {
      toast('폰에 한국어 음성이 없어요. 음성 데이터 설치 화면을 엽니다', 4000);
      NativeTTS?.openInstall?.().catch(() => {});
    }
  }
  if (e.target.closest('#btn-diag-settings')) exportDiag();
  const rs = e.target.closest('[data-rest-step]');
  if (rs) {
    const v = Math.max(0, Math.min(600, (store.settings().rest || 0) + Number(rs.dataset.restStep)));
    store.setSetting('rest', v);
    renderSettings();
    return;
  }
  const al = e.target.closest('[data-alert]');
  if (al) {
    const v = Number(al.dataset.alert);
    const cur = new Set(store.settings().restAlerts || []);
    if (cur.has(v)) cur.delete(v); else cur.add(v);
    store.setSetting('restAlerts', [...cur].sort((a, b) => b - a));
    renderSettings();
    return;
  }
  const cam = e.target.closest('[data-cam-id]');
  if (cam) {
    store.setSetting('cameraId', cam.dataset.camId);
    store.setSetting('cameraLabel', cam.dataset.camId ? cam.dataset.camName : '');
    renderSettings();
    toast(`${cam.dataset.camId ? cam.dataset.camName : '전면 기본'} 카메라로 운동해요`);
    return;
  }
  if (e.target.closest('#btn-cam-scan')) {
    const b = e.target.closest('#btn-cam-scan');
    b.disabled = true;
    b.textContent = '찾는 중…';
    try {
      camList = await cameraOptions();
      if (!camList.length) toast('카메라를 찾지 못했어요');
    } catch {
      toast('카메라 권한이 필요해요');
    }
    renderSettings();
    return;
  }
  if (e.target.closest('#btn-wipe')) {
    if (await confirmDialog('모든 기록을 지울까요?', '설정은 남고 운동 기록만 지워져요. 되돌릴 수 없어요.', '모두 지우기')) {
      store.wipe();
      toast('기록을 모두 지웠어요');
      renderSettings();
    }
  }
});
$('settings-body').addEventListener('change', async (e) => {
  const s = e.target.closest('[data-sw]');
  if (s?.dataset.sw === 'healthSync' && s.checked) {
    // 켤 때는 헬스 커넥트 권한부터: 허용돼야 켜진다
    s.checked = false;
    const ok = await healthReady({ ask: true });
    s.checked = ok;
    store.setSetting('healthSync', ok);
    if (ok) toast('이제 운동이 끝나면 헬스 커넥트에 저장해요');
    else if (healthIssue === 'denied') toast('권한을 허용해야 켤 수 있어요');
    return;
  }
  if (s) store.setSetting(s.dataset.sw, s.checked);
  if (s?.dataset.sw === 'voiceDuck') workout.voice.configure(store.settings());
  if (e.target.id === 'voice-name') { store.setSetting('voiceName', e.target.value); voiceSample(); }
  const num = e.target.closest('[data-num]');
  if (num) {
    const v = Number(num.value);
    if (v >= Number(num.min) && v <= Number(num.max)) store.setSetting(num.dataset.num, v);
    else { num.value = store.settings()[num.dataset.num]; toast('30~250kg 사이로 넣어 주세요'); }
  }
  if (e.target.id === 'import-file' && e.target.files[0]) {
    try {
      const n = store.importJSON(await e.target.files[0].text());
      toast(`기록 ${n}개를 불러왔어요`);
    } catch (err) {
      toast(err.message || '불러오지 못했어요');
    }
    e.target.value = '';
  }
  if (e.target.id === 'video-file' && e.target.files[0]) {
    const f = e.target.files[0];
    e.target.value = '';
    workout.start({ candidates: null, source: f });
  }
});

function applyTheme() {
  const t = store.settings().theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

/* ---------- 시작 ---------- */
const render = {
  home: renderHome,
  routine: renderRoutine,
  history: () => renderHistory($('history-body')),
  settings: renderSettings,
};
applyTheme();
go('home');

// 지난 실행이 GPU 로 AI 를 켜다 멈췄다면 호환 모드로 전환
try {
  if (localStorage.getItem(GPU_GUARD) === 'starting') {
    localStorage.removeItem(GPU_GUARD);
    store.setSetting('gpu', false);
    setTimeout(() => toast('지난번에 AI 가속 중 앱이 멈춰서 호환 모드로 바꿨어요 (설정 → GPU 가속)', 5000), 600);
  }
} catch { /* 저장소를 못 쓰면 건너뜀 */ }

// 하루 목표 알림: 시작할 때·앱으로 돌아올 때 다시 계산(날짜가 바뀌었거나 다른 곳에서 운동했을 수 있다)
syncReminders();
// 음성: 고른 목소리·빠르기 반영, 안드로이드 앱은 숫자 소리를 미리 만들어 둔다(처음 한 번 몇 초, 다음부턴 저장한 걸 불러옴)
workout.voice.configure(store.settings(), { delay: 8000 });
NativeApp?.addListener('appStateChange', ({ isActive }) => {
  if (!isActive) return;
  if (!$('screen-home').hidden) renderHome();
  if (!$('screen-goal').hidden) renderGoal(); // 배터리 설정에서 돌아오면 상태를 새로
  syncReminders();
});
onReminderTap((extra) => {
  if (extra?.kind === 'test') { toast('알림이 잘 와요!'); return; }
  if (!$('screen-workout').hidden) return;
  go('home');
  const p = progress(store.goal(), store.sessions());
  const items = remainingRoutine(p);
  if (!p.met && items.length) {
    // 알림에 적은 대로 '누르면 남은 만큼 바로': 카메라 준비 화면까지 열어 둔다(시작 버튼은 자리 잡고 직접)
    toast(`남은 것: ${leftText(p)}`, 3000);
    workout.start({ plan: { name: '오늘 목표', items } });
    return;
  }
  if (p.met) toast('오늘 목표는 이미 채웠어요 👍');
  setTimeout(() => $('goal-card')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80);
});

// 검증용 접근점 (앱 자동 점검·개발 도구가 사용)
window.__hfpt = { workout, store, isNative, NativeHealth, NativeCameraInfo, toHealthRecord, syncReminders, renderHome, cameraOptions };

// 안드로이드 뒤로가기: 대화상자 닫기 → 운동 중엔 무시(실수로 꺼지지 않게) → 이전 화면 → 홈 → 앱 내리기
NativeApp?.addListener('backButton', () => {
  const d = $('dialog');
  if (d.open) { d.close('cancel'); return; }
  if (!$('screen-workout').hidden) { toast('운동을 끝내려면 화면 위 ‘종료’를 눌러 주세요'); return; }
  if (stack.length) { back(); return; }
  const cur = [...document.querySelectorAll('.screen.page')].find((sc) => !sc.hidden)?.id;
  if (cur && cur !== 'screen-home') { go('home'); return; }
  NativeApp.minimizeApp();
});

// 개발·검증용: ?video=/test/videos/x.mp4 → 그 영상으로 분석 (카메라 대신)
const params = new URLSearchParams(location.search);
if (params.get('video')) {
  const btn = document.createElement('button');
  btn.className = 'btn btn-primary btn-lg';
  btn.style.marginTop = '10px';
  btn.id = 'btn-dev-video';
  btn.textContent = `영상으로 분석: ${params.get('video').split('/').pop()}`;
  btn.onclick = () => workout.start({ candidates: params.get('pick')?.split(',') || null, source: params.get('video') });
  $('btn-start-pick').after(btn);
}

if (!isNative && 'serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
