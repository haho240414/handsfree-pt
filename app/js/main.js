// 화면 전환·홈·운동 고르기·요약·기록·설정

import { EXERCISES, EXERCISE_BY_ID, GROUPS, formInfo } from './engine/exercises.js';
import * as store from './store.js';
import { Workout } from './workout.js';
import { renderHistory } from './history.js';
import { esc, exName, DAYS, fmtDate, fmtTime, minutes, setValue, sessionTotals, sessionLine, sessionItem } from './format.js';

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
        <div class="n">${esc(e.name)}${e.verified ? '' : ' <span class="beta">베타</span>'}</div><div class="h">📱 ${esc(e.tip)}</div>
      </button>`).join('');
    return `<div class="pick-group">${g}</div><div class="pick-grid">${items}</div>`;
  }).join('');
  $('pick-groups').innerHTML = html
    + '<p class="muted small" style="margin-top:12px">베타: 실제 영상으로 아직 충분히 확인하지 못한 운동이에요. 틀리게 세면 요약 화면에서 고쳐 주세요.</p>'
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
$('btn-start-picked').addEventListener('click', () => {
  const ids = [...picked];
  store.setLastPick(ids);
  workout.start({ candidates: ids });
});

/* ---------- 요약 / 상세 ---------- */
let curSession = null;
function openSummary(id, fresh) {
  curSession = store.getSession(id);
  if (!curSession) return;
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
        <div class="set-main"><div class="v">${setValue(set)}${set.weight ? ` <span class="muted" style="font-size:14px">× ${set.weight}kg</span>` : ''}</div>${q}</div>
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
  html += '<button class="btn btn-ghost btn-lg" style="margin-top:12px" id="btn-add-set">+ 세트 직접 추가</button>';
  $('summary-body').innerHTML = html;
}
$('summary-body').addEventListener('click', (e) => {
  const b = e.target.closest('[data-edit-set]');
  if (b) editSet(b.dataset.editSet);
  if (e.target.closest('#btn-add-set')) editSet(null);
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
function renderSettings() {
  const row = (l, d, ctl, stacked) => `<div class="setting${stacked ? ' stacked' : ''}"><div><div class="l">${l}</div>${d ? `<div class="d">${d}</div>` : ''}</div>${ctl}</div>`;
  $('settings-body').innerHTML = `
    <div class="card">
      ${row('음성 안내', '횟수·세트·휴식을 소리로 알려줘요', sw('voice'))}
      ${row('숫자 읽기', '', seg('countStyle', [['native', '하나 둘 셋'], ['number', '일 이 삼']]))}
      ${row('자세 교정 음성', '같은 문제가 반복될 때만 짧게 말해요', sw('cues'))}
      ${row('휴식 타이머', '세트가 끝나면 자동으로 시작', seg('rest', [[0, '끔'], [30, '30초'], [60, '1분'], [90, '1분30'], [120, '2분']]), true)}
    </div>
    <h2 class="section-title">인식</h2>
    <div class="card">
      ${row('인식 모델', '빠름은 오래된 폰용 (정확도는 떨어져요)', seg('model', [['full', '정확'], ['lite', '빠름']]))}
      ${row('자동 인식 확정', '몇 번 반복하면 운동 종류를 확정할지', seg('lockReps', [[2, '2회'], [3, '3회']]))}
      ${row('화면 좌우 반전', '거울처럼 보이기', sw('mirror'))}
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
    const blob = new Blob([store.exportJSON()], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `handsfree-pt-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
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
  history: () => renderHistory($('history-body')),
  settings: renderSettings,
};
applyTheme();
go('home');

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
  window.__hfpt = { workout, store };
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
