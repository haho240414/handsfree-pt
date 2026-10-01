// 화면 전환·홈·운동 고르기·요약·기록·설정

import { EXERCISES, EXERCISE_BY_ID, GROUPS, formInfo } from './engine/exercises.js';
import * as store from './store.js';
import { Workout, GPU_GUARD } from './workout.js';
import { renderHistory } from './history.js';
import { esc, exName, DAYS, fmtDate, fmtTime, minutes, setValue, sessionTotals, sessionLine, sessionItem } from './format.js';
import { isNative, NativeApp, NativeTTS, canShareFile, shareTextFile, shareBinaryFile } from './native.js';
import { summarize as tempoSummary, speeds as tempoSpeeds } from './engine/tempo.js';
import { listCameras, cameraNames } from './camera.js';
import { loadDemos, playDemo, hasDemo } from './demo.js';
import { generateRoutine, routineMinutes, defaultItem, isHold, PLAN_META, FOCUS, EQUIPMENT, LEVELS } from './routine.js';

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
function renderHome() {
  $('today-label').textContent = `오늘 · ${fmtDate(Date.now())}`;
  const today = new Date().toDateString();
  const todays = store.sessions().filter((s) => new Date(s.start).toDateString() === today);
  const reps = todays.reduce((a, s) => a + sessionTotals(s).reps, 0);
  const sets = todays.reduce((a, s) => a + s.sets.length, 0);
  const min = todays.reduce((a, s) => a + minutes(s), 0);
  $('today-card').innerHTML = [
    ['회', reps, '오늘 반복'], ['세트', sets, '세트'], ['분', min, '운동 시간'],
  ].map(([u, v, l]) => `<div class="stat"><div class="num">${v}<small style="font-size:14px"> ${u}</small></div><div class="lbl">${l}</div></div>`).join('');
  const draft = store.routineDraft();
  $('routine-sub').textContent = draft?.items?.length
    ? `${exName(draft.items[0].exercise)} 외 ${draft.items.length - 1}가지 · 약 ${routineMinutes(draft.items)}분`
    : '루틴을 짜 주고, 지금 할 운동·횟수를 안내해요';
  const recent = store.sessions().slice(0, 5);
  $('recent-list').innerHTML = recent.length
    ? recent.map(sessionItem).join('')
    : '<div class="empty">아직 기록이 없어요.<br>첫 운동을 시작해 보세요!</div>';
}

document.addEventListener('click', (e) => {
  const it = e.target.closest('[data-session]');
  if (it) openSummary(it.dataset.session, false);
});

/* ---------- 운동 고르기 ---------- */
let picked = new Set();
function renderPick() {
  picked = new Set(store.lastPick().filter((id) => EXERCISE_BY_ID[id]));
  const html = GROUPS.map((g) => {
    const items = EXERCISES.filter((e) => e.group === g).map((e) => `
      <button class="pick-item" data-pick="${e.id}" aria-pressed="${picked.has(e.id)}">
        <div class="n">${esc(e.name)}${e.verified ? '' : ' <span class="beta">베타</span>'}${e.auto === false ? ' <span class="beta">골라서만</span>' : ''}</div><div class="h">📱 ${esc(e.tip)}</div>
      </button>`).join('');
    return `<div class="pick-group">${g}</div><div class="pick-grid">${items}</div>`;
  }).join('');
  $('pick-groups').innerHTML = html
    + '<p class="muted small" style="margin-top:12px">베타: 실제 영상으로 아직 충분히 확인하지 못한 운동이에요. 틀리게 세면 요약 화면에서 고쳐 주세요.<br>골라서만: 쉬는 자세와 구별이 안 돼서 자동 인식에선 빼고, 여기서 골랐을 때만 재요.</p>'
    + `<div class="card" style="margin-top:16px" id="pick-weights"></div>`;
  updatePickUI();
}
function updatePickUI() {
  const btn = $('btn-start-picked');
  btn.disabled = picked.size === 0;
  btn.textContent = picked.size === 0 ? '운동을 골라 주세요'
    : picked.size === 1 ? `${exName([...picked][0])} 시작` : `${picked.size}가지 운동으로 시작`;
  const weights = [...picked].filter((id) => EXERCISE_BY_ID[id].kind === 'reps');
  const box = $('pick-weights');
  box.hidden = weights.length === 0;
  box.innerHTML = '<div style="font-weight:700">무게 (선택)</div><div class="muted small">덤벨·바벨 무게를 적어두면 세트마다 함께 기록돼요. 나중에 요약 화면에서도 고칠 수 있어요.</div>'
    + weights.map((id) => `<div class="weight-row"><span style="flex:1">${esc(exName(id))}</span>
      <input type="number" inputmode="decimal" min="0" step="0.5" placeholder="kg" data-weight="${id}" value="${store.lastWeight(id) ?? ''}"> kg</div>`).join('');
}
$('pick-groups').addEventListener('click', (e) => {
  const b = e.target.closest('[data-pick]');
  if (!b) return;
  const id = b.dataset.pick;
  if (picked.has(id)) picked.delete(id); else picked.add(id);
  b.setAttribute('aria-pressed', picked.has(id));
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
  },
});
$('btn-start-auto').addEventListener('click', () => workout.start({ candidates: null }));
$('btn-start-pick').addEventListener('click', () => push('screen-pick', renderPick));
$('btn-open-routine').addEventListener('click', () => { loadDemos().then(() => { if (!$('screen-routine').hidden) renderRoutine(); }); push('screen-routine', renderRoutine); });

/* ---------- 오늘의 루틴 (PT 모드) ---------- */
const todayKey = () => new Date().toISOString().slice(0, 10);
const FOCUS_OPTS = [['auto', '추천'], ...Object.entries(FOCUS).map(([k, v]) => [k, v.name])];
const MIN_OPTS = [15, 30, 45, 60];
const fmtSec = (sec) => (sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분${sec % 60 ? ` ${sec % 60}초` : ''}`);
const itemLine = (it) => {
  const meta = PLAN_META[it.exercise];
  const what = isHold(it.exercise) ? `${it.holdSec}초` : `${it.reps}회`;
  return `${it.sets}세트 × ${what} · 휴식 ${fmtSec(it.rest)}${it.weight ? ` · ${it.weight}kg` : ''}${meta?.note ? ` <span class="muted">(${esc(meta.note)})</span>` : ''}`;
};

function makeRoutine(seedN = 0) {
  const p = store.routinePrefs();
  const r = generateRoutine({
    ...p, sessions: store.sessions(), seed: `${todayKey()}#${seedN}`, weightOf: (id) => store.lastWeight(id),
  });
  store.setRoutineDraft({ ...r, seedN, madeAt: Date.now() });
}

function renderRoutine() {
  // 처음 열거나, 어제 자동으로 짠 루틴을 손대지 않았으면 오늘 것으로 새로 짠다
  const old = store.routineDraft();
  if (!old || (old.madeAt && !old.edited && new Date(old.madeAt).toDateString() !== new Date().toDateString())) makeRoutine(0);
  const p = store.routinePrefs();
  const d = store.routineDraft();
  const segR = (key, opts, cur) => `<div class="seg" data-rseg="${key}">${opts.map(([v, l]) =>
    `<button type="button" data-v="${v}" aria-pressed="${String(cur) === String(v)}">${l}</button>`).join('')}</div>`;
  let html = `<div class="card routine-make">
    <div class="rm-title">PT가 짜 주는 오늘 운동</div>
    <div class="rm-row"><span>부위</span>${segR('focus', FOCUS_OPTS, p.focus)}</div>
    <div class="rm-row"><span>장소</span>${segR('equipment', Object.entries(EQUIPMENT), p.equipment)}</div>
    <div class="rm-row"><span>시간</span>${segR('minutes', MIN_OPTS.map((m) => [m, `${m}분`]), p.minutes)}</div>
    <div class="rm-row"><span>강도</span>${segR('level', LEVELS.map((l, i) => [i, l]), p.level)}</div>
    <div class="btn-row"><button class="btn btn-secondary" id="btn-make-routine" type="button">${d ? '처음 구성으로' : '루틴 짜기'}</button>
    ${d ? '<button class="btn btn-secondary" id="btn-shuffle-routine" type="button">🔄 다른 운동으로</button>' : ''}</div>
  </div>`;
  if (d?.items) {
    const sets = d.items.reduce((a, it) => a + it.sets, 0);
    html += `<div class="routine-head"><div><b>${esc(d.name || '내 루틴')}</b><div class="muted small">${d.items.length}가지 · ${sets}세트 · 약 ${routineMinutes(d.items)}분</div></div>
      <button class="mini-btn" id="btn-save-routine" type="button">저장</button></div>
      ${d.reason ? `<p class="muted small routine-reason">💡 ${esc(d.reason)}</p>` : ''}
      <div class="card routine-list">${d.items.map((it, i) => `<div class="r-item">
        <div class="r-no">${i + 1}</div>
        <div class="r-main"><button type="button" class="r-name" data-r-demo="${esc(it.exercise)}">${esc(exName(it.exercise))}${EXERCISE_BY_ID[it.exercise]?.verified ? '' : ' <span class="beta">베타</span>'}${hasDemo(it.exercise) ? ' <span class="demo-ico" aria-label="동작 보기">▶</span>' : ''}</button>
          <div class="r-sub">${itemLine(it)}</div>${it.why ? `<div class="r-why">${/\+/.test(it.why) ? '⬆ ' : ''}${esc(it.why)}</div>` : ''}</div>
        <div class="r-ctl">
          <button class="mini-btn" data-r-edit="${i}" type="button">수정</button>
          <button class="mini-btn" data-r-up="${i}" type="button" aria-label="위로" ${i ? '' : 'disabled'}>↑</button>
          <button class="mini-btn" data-r-down="${i}" type="button" aria-label="아래로" ${i < d.items.length - 1 ? '' : 'disabled'}>↓</button>
        </div></div>`).join('')}
        <button class="btn btn-ghost" id="btn-r-add" type="button">+ 운동 추가</button>
      </div>
      <p class="muted small">진행 중엔 지금 할 운동·세트·목표 횟수가 화면에 나오고, 목표를 채우면 알아서 휴식 → 다음 세트로 넘어가요.
      운동을 정해 두고 세서 자동 인식보다 정확해요. 자리 잡을 때 화면 안내를 따라 주세요.</p>`;
  }
  const saved = store.routines();
  if (saved.length) {
    html += `<h2 class="section-title">내 루틴</h2><div class="card">${saved.map((r) => `<div class="r-saved">
      <div><b>${esc(r.name)}</b><div class="muted small">${r.items.length}가지 · 약 ${routineMinutes(r.items)}분</div></div>
      <div class="r-ctl"><button class="mini-btn" data-r-load="${esc(r.id)}" type="button">불러오기</button>
      <button class="mini-btn" data-r-del="${esc(r.id)}" type="button" aria-label="삭제">✕</button></div></div>`).join('')}</div>`;
  }
  $('routine-body').innerHTML = html;
  const btn = $('btn-start-routine');
  btn.disabled = !d?.items?.length;
  btn.textContent = d?.items?.length ? `이 루틴으로 시작 (약 ${routineMinutes(d.items)}분)` : '루틴을 짜 주세요';
}

$('routine-body').addEventListener('click', async (e) => {
  const seg = e.target.closest('[data-rseg] button');
  if (seg) {
    const key = seg.parentElement.dataset.rseg;
    const raw = seg.dataset.v;
    store.setRoutinePrefs({ [key]: /^\d+$/.test(raw) ? Number(raw) : raw });
    makeRoutine(0); // 조건을 바꾸면 바로 다시 짠다
    renderRoutine();
    return;
  }
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
  if (ed) { editRoutineItem(Number(ed.dataset.rEdit)); return; }
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
  const step = (id, val, label, deltas) => `<div class="field"><label id="${id}-l">${label}</label><div class="stepper">
    ${[...deltas].reverse().map((dl) => `<button type="button" class="mini-btn" data-st="${id}" data-d="${-dl}">−${dl}</button>`).join('')}
    <input type="number" id="${id}" inputmode="numeric" min="0" value="${val}">
    ${deltas.map((dl) => `<button type="button" class="mini-btn" data-st="${id}" data-d="${dl}">+${dl}</button>`).join('')}</div></div>`;
  dlg.innerHTML = `<form method="dialog">
    <h3>${it ? '운동 수정' : '운동 추가'}</h3>
    <div class="field"><label>운동</label><select id="ri-ex">${opts}</select></div>
    ${step('ri-sets', cur.sets, '세트', [1])}
    ${step('ri-target', isHold(cur.exercise) ? cur.holdSec : cur.reps, '목표 횟수', [1, 5])}
    ${step('ri-rest', cur.rest, '휴식(초)', [15])}
    <div class="field" id="ri-w-field"><label>무게 (kg, 선택)</label><input type="number" id="ri-w" inputmode="decimal" min="0" step="0.5" value="${cur.weight ?? ''}"></div>
    <div class="btn-row" style="margin-top:14px">
      ${it ? '<button type="button" class="btn btn-danger" id="ri-del">빼기</button>' : ''}
      <button value="cancel" class="btn btn-ghost">취소</button>
      <button value="ok" class="btn btn-primary">${it ? '저장' : '추가'}</button>
    </div></form>`;
  const sync = (changed) => {
    const ex = $('ri-ex').value;
    $('ri-target-l').textContent = isHold(ex) ? '목표 시간(초)' : '목표 횟수';
    $('ri-w-field').hidden = isHold(ex); // 맨몸 운동도 덤벨·바벨을 들 수 있어서 무게 칸은 보여준다
    if (changed) { // 운동을 바꾸면 그 운동의 기본값으로
      const def = defaultItem(ex, store.routinePrefs().level, store.lastWeight(ex));
      $('ri-target').value = isHold(ex) ? def.holdSec : def.reps;
      $('ri-rest').value = def.rest;
      $('ri-w').value = def.weight ?? '';
    }
  };
  sync(false);
  $('ri-ex').onchange = () => sync(true);
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
    if (isHold(ex)) next.holdSec = target; else next.reps = target;
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
    <p class="small" style="margin:8px 0 4px">📱 ${esc(ex.tip)}${note ? ` · ${esc(note)}` : ''}</p>
    ${cues.length ? `<ul class="feedback small">${cues.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
    <div class="btn-row"><button value="ok" class="btn btn-primary">닫기</button></div></form>`;
  const stop = hasDemo(id) ? playDemo($('demo-canvas'), id, { color: getComputedStyle(document.documentElement).getPropertyValue('--accent-text').trim() || '#4a7a00', dim: 'rgba(120,130,140,.45)' }) : null;
  d.onclose = () => stop?.();
  d.showModal();
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
  $('btn-summary-done').textContent = fresh ? '저장하고 닫기' : '닫기';
}
function renderSummary() {
  const s = curSession;
  const tot = sessionTotals(s);
  const by = new Map();
  for (const set of s.sets) {
    if (!by.has(set.exercise)) by.set(set.exercise, []);
    by.get(set.exercise).push(set);
  }
  let html = `<div class="hero"><div class="muted">${fmtDate(s.start)} ${fmtTime(s.start)}${s.source === 'video' ? ' · 영상 분석' : ''}</div>
    <div class="big">${tot.reps}회</div></div>
    <div class="hero-stats">
      <div class="card stat"><div class="num">${tot.min}</div><div class="lbl">분</div></div>
      <div class="card stat"><div class="num">${tot.sets}</div><div class="lbl">세트</div></div>
      <div class="card stat"><div class="num">${by.size}</div><div class="lbl">종목</div></div>
    </div>`;
  if (s.planProgress) {
    const pp = s.planProgress;
    const pct = Math.round((100 * pp.setsDone) / Math.max(1, pp.setsTotal));
    html += `<div class="card plan-card"><div class="plan-card-top"><b>📋 ${esc(s.plan?.name || '오늘 루틴')}</b><span>${pct}%</span></div>
      <div class="wo-plan-bar plan-bar"><i style="width:${pct}%"></i></div>
      <div class="muted small">세트 ${pp.setsDone}/${pp.setsTotal}${pp.repsTarget ? ` · 반복 ${pp.repsDone}/${pp.repsTarget}회` : ''}</div></div>`;
  }
  const tips = [];
  for (const [ex, sets] of by) {
    const reps = sets.filter((x) => x.kind === 'reps');
    const vol = reps.reduce((a, x) => a + (x.weight ? x.weight * x.reps : 0), 0);
    const head = reps.length
      ? `${reps.reduce((a, x) => a + x.reps, 0)}회${vol ? ` · 볼륨 ${Math.round(vol).toLocaleString()}kg` : ''}`
      : `${sets.reduce((a, x) => a + (x.holdSec || 0), 0)}초`;
    html += `<div class="card ex-block"><div class="ex-head"><span class="n">${esc(exName(ex))}</span><span class="s">${head}</span></div>`;
    sets.forEach((set, i) => {
      const bad = set.kind === 'reps' && set.good != null ? set.reps - set.good : 0;
      const q = set.kind === 'reps' && set.good != null
        ? (bad ? `<span class="q warn">자세 지적 ${bad}회</span>` : '<span class="q">좋은 자세 ✓</span>')
        : '<span class="q"></span>';
      html += `<div class="set-row"><div class="set-no">${i + 1}</div>
        <div class="set-main"><div class="v">${setValue(set)}${set.plan ? ` <span class="muted plan-tgt">/ 목표 ${set.plan.target}${set.kind === 'hold' ? '초' : '회'}${(set.kind === 'hold' ? set.holdSec : set.reps) >= set.plan.target ? ' ✓' : ''}${set.plan.manual ? ' · 직접 완료' : ''}</span>` : ''}${set.weight ? ` <span class="muted" style="font-size:14px">× ${set.weight}kg</span>` : ''}</div>${q}${tempoRow(set)}</div>
        <div class="set-edit"><button class="mini-btn" data-edit-set="${esc(set.id)}">수정</button></div></div>`;
      for (const [code, n] of Object.entries(set.issues || {})) {
        const info = formInfo(ex, code);
        if (info) tips.push({ ex, code, n, info });
      }
    });
    html += '</div>';
  }
  if (tips.length) {
    const merged = new Map();
    for (const t of tips) {
      const k = t.ex + t.code;
      merged.set(k, { ...t, n: (merged.get(k)?.n || 0) + t.n });
    }
    html += `<div class="card" style="margin-top:4px"><div style="font-weight:800">자세 피드백</div><ul class="feedback">${[...merged.values()].map((t) =>
      `<li><b>${esc(exName(t.ex))}</b> · ${esc(t.info.tip)} <span class="muted">(${t.n}${EXERCISE_BY_ID[t.ex].kind === 'hold' ? '초' : '회'})</span></li>`).join('')}</ul></div>`;
  } else if (s.sets.some((x) => x.good != null)) {
    html += '<div class="card" style="margin-top:4px">👍 자세 지적 없이 끝냈어요.</div>';
  }
  if (s.sets.some((x) => tempoRow(x))) {
    html += `<p class="muted small tempo-legend"><span class="sw con"></span>막대 = 반복마다 힘주는 속도 · <span class="sw slow"></span>처음보다 20% 넘게 느려진 반복(한계가 가깝다는 신호)</p>`;
  }
  html += '<button class="btn btn-ghost btn-lg" style="margin-top:12px" id="btn-add-set">+ 세트 직접 추가</button>';
  if (curFresh && s.source === 'camera' && workout.canExportDiag) {
    html += `<div class="card diag-card"><div><b>인식이 이상했나요?</b>
      <p class="muted small" style="margin:4px 0 10px">이번 운동에서 AI 가 본 관절 좌표(영상·사진 아님)를 파일로 저장해 전달해 주시면 그대로 재현해서 고칠 수 있어요.</p></div>
      <button class="btn btn-secondary" id="btn-diag">진단 기록 저장·공유</button></div>`;
  }
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
  d.innerHTML = `<form method="dialog"><h3>진단 기록 저장·공유</h3>
    <p class="muted small" style="margin-top:0">AI 가 본 관절 좌표만 담겨요(영상·사진 없음, 최근 20분). 실제로 한 운동과 횟수를 적어 주면 어디서 틀렸는지 바로 찾을 수 있어요.</p>
    <div class="field"><label for="diag-note">실제로 한 운동·횟수 (선택)</label>
      <textarea id="diag-note" rows="3" placeholder="예: 스쿼트 12, 10, 10 / 랫풀다운 12 (2세트는 안 셌음)"></textarea></div>
    <div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-primary">파일 만들기</button></div></form>`;
  d.onclose = async () => {
    if (d.returnValue !== 'ok') return;
    const note = $('diag-note').value.trim();
    toast('진단 기록 만드는 중…', 15000);
    try {
      const f = await workout.exportDiag(note);
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
  if (e.target.closest('#btn-diag')) exportDiag();
});
$('btn-summary-done').addEventListener('click', () => { go('home'); });
$('btn-delete-session').addEventListener('click', async () => {
  if (!curSession) return;
  if (!(await confirmDialog('이 운동 기록을 지울까요?', '지운 기록은 되돌릴 수 없어요.', '지우기'))) return;
  store.deleteSession(curSession.id);
  toast('기록을 지웠어요');
  go('home');
});

function editSet(setId) {
  const s = curSession;
  const set = setId ? s.sets.find((x) => x.id === setId) : null;
  const d = $('dialog');
  const exOpts = EXERCISES.map((e) => `<option value="${e.id}" ${set?.exercise === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('');
  d.innerHTML = `<form method="dialog">
    <h3>${set ? '세트 수정' : '세트 추가'}</h3>
    <div class="field"><label>운동</label><select id="ed-ex">${exOpts}</select></div>
    <div class="field"><label id="ed-unit-l">횟수</label><div class="stepper">
      <button type="button" class="mini-btn" data-step="-1">−</button>
      <input type="number" id="ed-val" inputmode="numeric" min="0" value="${set ? (set.kind === 'hold' ? set.holdSec : set.reps) : 10}">
      <button type="button" class="mini-btn" data-step="1">+</button></div></div>
    <div class="field" id="ed-w-field"><label>무게 (kg, 선택)</label><input type="number" id="ed-w" inputmode="decimal" min="0" step="0.5" value="${set?.weight ?? ''}"></div>
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
      store.upsertSession(s);
      d.close('deleted');
      renderSummary();
    };
  }
  d.onclose = () => {
    if (d.returnValue !== 'ok') return;
    const ex = $('ed-ex').value;
    const hold = EXERCISE_BY_ID[ex].kind === 'hold';
    const val = Math.max(0, Math.round(Number($('ed-val').value || 0)));
    const w = $('ed-w').value === '' ? null : Number($('ed-w').value);
    const target = set || { id: store.uid(), start: s.end || s.start, end: s.end || s.start, issues: {}, good: null };
    Object.assign(target, {
      exercise: ex, kind: hold ? 'hold' : 'reps',
      reps: hold ? null : val, holdSec: hold ? val : null, weight: hold ? null : w, edited: true,
    });
    if (set && target.good != null && !hold) target.good = Math.min(target.good, val);
    if (!set) s.sets.push(target);
    if (!hold && w != null) store.rememberWeight(ex, w);
    store.upsertSession(s);
    renderSummary();
  };
  d.showModal();
}

export function confirmDialog(title, body, okText = '확인') {
  return new Promise((resolve) => {
    const d = $('dialog');
    d.innerHTML = `<form method="dialog"><h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>
      <div class="btn-row"><button value="cancel" class="btn btn-ghost">취소</button><button value="ok" class="btn btn-danger">${esc(okText)}</button></div></form>`;
    d.onclose = () => resolve(d.returnValue === 'ok');
    d.showModal();
  });
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

function renderSettings() {
  const st = store.settings();
  const row = (l, d, ctl, stacked) => `<div class="setting${stacked ? ' stacked' : ''}"><div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ''}</div>${ctl}</div>`;
  const alerts = st.restAlerts || [];
  const chip = (v, l) => `<button type="button" class="chip" data-alert="${v}" aria-pressed="${alerts.includes(v)}">${l}</button>`;
  const camName = st.cameraId ? (st.cameraLabel || '고른 카메라') : '전면 기본';
  const camOpts = camList
    ? [['', '전면 기본(자동)'], ...camList.map((c, i) => [c.id, cameraNames(camList)[i]])]
      .map(([id, name]) => `<button type="button" class="chip" data-cam-id="${esc(id)}" data-cam-name="${esc(name)}" aria-pressed="${st.cameraId === id}">${esc(name)}</button>`).join('')
    : '';
  $('settings-body').innerHTML = `
    <div class="card">
      ${row('음성 안내', '횟수·세트·휴식을 소리로 알려줘요', sw('voice'))}
      ${row('소리 확인', '운동 전에 한 번 들어보세요', '<button class="mini-btn" id="btn-voice-test" type="button">들어보기</button>')}
      ${row('숫자 읽기', '', seg('countStyle', [['native', '하나 둘 셋'], ['number', '일 이 삼']]))}
      ${row('자세 교정 음성', '같은 문제가 반복될 때만 짧게 말해요', sw('cues'))}
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
      ${row('다시 시작 알림', '휴식이 끝나기 전에 소리로 알려줘요 (여러 개 고를 수 있어요). 끝나면 삐 소리와 함께 안내',
        `<div class="chips">${chip(30, '30초 전')}${chip(10, '10초 전')}${chip(5, '5초 전')}${chip(3, '셋·둘·하나')}</div>`, true)}
    </div>
    <h2 class="section-title">카메라</h2>
    <div class="card">
      ${row('사용할 카메라', `지금: ${esc(camName)}. 전면 광각이 따로 있는 폰은 목록에 '광각'으로 나와요`,
        `<div class="cam-ctl"><button class="mini-btn" id="btn-cam-scan" type="button">${camList ? '다시 찾기' : '카메라 찾기'}</button>
        ${camList ? `<div class="chips">${camOpts}</div>` : ''}</div>`, true)}
      ${row('넓게 보기(광각)', '센서 전체(4:3)로 찍어 좌우가 더 보이고, 줌을 1배 아래로 줄일 수 있는 폰은 가장 넓게 찍어요', sw('cameraWide'))}
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
}
$('settings-body').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-seg] button');
  if (b) {
    const key = b.parentElement.dataset.seg;
    const raw = b.dataset.v;
    const v = /^\d+$/.test(raw) ? Number(raw) : raw;
    store.setSetting(key, v);
    if (key === 'theme') applyTheme();
    renderSettings();
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
    v.style = store.settings().countStyle;
    v.unlock();
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
      camList = await listCameras();
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
  if (s) store.setSetting(s.dataset.sw, s.checked);
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

// 검증용 접근점 (앱 자동 점검·개발 도구가 사용)
window.__hfpt = { workout, store, isNative };

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
