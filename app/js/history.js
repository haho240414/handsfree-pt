// 기록 화면: 이번 주 요약 · 연속 운동일 · 달력 · 운동별 주간 추이 · 전체 목록

import { EXERCISE_BY_ID } from './engine/exercises.js';
import * as store from './store.js';
import { icon } from './icons.js';
import { esc, exName, sessionTotals, sessionItem, minutes } from './format.js';
import { personalRecords, weeklyGroups, sessionCalories, e1rm } from './stats.js';

let monthOffset = 0;
let chartEx = null;
let root = null;

const dayKey = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${x.getMonth() + 1}-${x.getDate()}`;
};
const mondayOf = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
};
// 달력 색 진하기용 점수: 반복 수 + 버티기 5초당 1
const load = (sets) => sets.reduce((a, s) => a + (s.kind === 'hold' ? (s.holdSec || 0) / 5 : s.reps || 0), 0);

export function renderHistory(el) {
  root = el;
  const insightsOpen = !!el.querySelector('.history-insights')?.open;
  const sessions = store.sessions();
  if (!sessions.length) {
    el.innerHTML = '<div class="empty">아직 기록이 없어요.<br>운동을 하면 여기에 날짜별로 정리돼요.</div>';
    return;
  }
  el.innerHTML = listHtml(sessions) + `<details class="history-insights" ${insightsOpen?'open':''}><summary>통계 · 달력 ${icon('caret-right')}</summary>${weekCard(sessions)+groupCard(sessions)+calendarCard(sessions)+chartCard(sessions)+prCard(sessions)}</details>`;
}

function weekCard(sessions) {
  const wk = mondayOf(new Date()).getTime();
  const cur = sessions.filter((s) => s.start >= wk);
  const days = new Set(cur.map((s) => dayKey(s.start))).size;
  const reps = cur.reduce((a, s) => a + sessionTotals(s).reps, 0);
  const min = cur.reduce((a, s) => a + minutes(s), 0);
  const kcal = cur.reduce((a, s) => a + sessionCalories(s, store.settings().bodyKg || 70), 0);
  const daySet = new Set(sessions.map((s) => dayKey(s.start)));
  const d = new Date();
  if (!daySet.has(dayKey(d))) d.setDate(d.getDate() - 1);
  let streak = 0;
  while (daySet.has(dayKey(d))) { streak++; d.setDate(d.getDate() - 1); }
  const stat = (v, u, l) => `<div class="stat"><div class="num">${v}${u ? `<small style="font-size:13px"> ${u}</small>` : ''}</div><div class="lbl">${l}</div></div>`;
  return `<div class="card" style="margin-bottom:12px"><div style="font-weight:800;margin-bottom:6px">이번 주</div>
    <div class="today-card" style="margin:0;grid-template-columns:repeat(4,1fr)">${stat(days, '일', '운동한 날')}${stat(reps, '회', '총 반복')}${stat(min, '분', '운동 시간')}${stat(kcal, '', 'kcal(어림)')}</div>
    ${streak >= 2 ? `<div class="muted small" style="margin-top:8px">${streak}일 연속 운동 중</div>` : ''}</div>`;
}

// 이번 주 부위별 세트 — 한쪽만 하고 있지 않은지 (일반적인 권장: 큰 부위 주 10세트 안팎)
function groupCard(sessions) {
  const g = weeklyGroups(sessions);
  const rows = Object.entries(g).filter(([, v]) => v.sets);
  if (!rows.length) return '';
  const max = Math.max(...rows.map(([, v]) => v.sets), 10);
  return `<div class="card" style="margin-bottom:12px"><div style="font-weight:800;margin-bottom:8px">이번 주 부위별 세트</div>
    ${Object.entries(g).map(([name, v]) => `<div class="grp-row"><span class="grp-name">${name}</span>
      <span class="grp-bar"><i style="width:${Math.round((100 * v.sets) / max)}%"></i></span>
      <span class="grp-val">${v.sets}세트${v.volume ? ` · ${Math.round(v.volume).toLocaleString()}kg` : ''}</span></div>`).join('')}
    <div class="muted small" style="margin-top:6px">0세트인 부위가 있으면 오늘의 루틴 '추천'이 그쪽으로 짜 줘요</div></div>`;
}

// 운동별 최고 기록: 무게 운동은 최고 무게·예상 1RM, 맨몸은 한 세트 최다 횟수, 버티기는 최장 시간
const fmtD = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()}`; };
function prParts(p) {
  if (p.maxHold) return { main: `${p.maxHold.sec}초`, sub: fmtD(p.maxHold.date) };
  if (p.maxWeight) {
    return { main: `${p.maxWeight.w}kg × ${p.maxWeight.reps}회`, sub: `${p.best1rm ? `예상 1RM ${p.best1rm.v}kg · ` : ''}${fmtD(p.maxWeight.date)}` };
  }
  return { main: `${p.maxReps.reps}회`, sub: fmtD(p.maxReps.date) };
}
function prCard(sessions) {
  const pr = personalRecords(sessions);
  const rows = Object.entries(pr).filter(([, p]) => p.maxWeight || p.maxReps?.reps || p.maxHold);
  if (!rows.length) return '';
  return `<div class="card pr-card" style="margin-bottom:12px"><div style="font-weight:800;margin-bottom:6px">최고 기록</div>
    ${rows.map(([ex, p]) => {
      const { main, sub } = prParts(p);
      return `<div class="pr-row"><span>${esc(exName(ex))}</span><span class="pr-val"><b>${main}</b><span class="muted small">${sub}</span></span></div>`;
    }).join('')}
    <div class="muted small" style="margin-top:6px">예상 1RM = 무게 × (1 + 횟수/30), 12회 이하일 때만</div></div>`;
}

function calendarCard(sessions) {
  const base = new Date();
  base.setDate(1);
  base.setMonth(base.getMonth() + monthOffset);
  const y = base.getFullYear(), m = base.getMonth();
  const byDay = new Map();
  for (const s of sessions) {
    const d = new Date(s.start);
    if (d.getFullYear() !== y || d.getMonth() !== m) continue;
    byDay.set(d.getDate(), (byDay.get(d.getDate()) || 0) + load(s.sets));
  }
  const first = new Date(y, m, 1).getDay();
  const last = new Date(y, m + 1, 0).getDate();
  const today = new Date();
  let cells = ['일', '월', '화', '수', '목', '금', '토'].map((d) => `<div class="cal-head">${d}</div>`).join('');
  for (let i = 0; i < first; i++) cells += '<div class="cal-day blank"></div>';
  for (let d = 1; d <= last; d++) {
    const v = byDay.get(d) || 0;
    const lv = v === 0 ? '' : v < 50 ? 'l1' : v < 150 ? 'l2' : 'l3';
    const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
    cells += `<div class="cal-day ${lv} ${isToday ? 'today' : ''}" title="${v ? Math.round(v) + '회' : ''}">${d}</div>`;
  }
  return `<div class="card" style="margin-bottom:12px">
    <div class="cal-nav"><button class="icon-btn" data-cal="-1" aria-label="이전 달">‹</button>
    <b>${y}년 ${m + 1}월</b>
    <button class="icon-btn" data-cal="1" aria-label="다음 달" ${monthOffset >= 0 ? 'disabled style="opacity:.3"' : ''}>›</button></div>
    <div class="calendar">${cells}</div></div>`;
}

function chartCard(sessions) {
  const count = new Map();
  for (const s of sessions) for (const set of s.sets) count.set(set.exercise, (count.get(set.exercise) || 0) + 1);
  const exs = [...count].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (!exs.length) return '';
  if (!exs.includes(chartEx)) chartEx = exs[0];
  const hold = EXERCISE_BY_ID[chartEx]?.kind === 'hold';
  const weeks = [];
  const mon = mondayOf(new Date());
  for (let i = 7; i >= 0; i--) {
    const a = new Date(mon);
    a.setDate(a.getDate() - 7 * i);
    const b = new Date(a);
    b.setDate(b.getDate() + 7);
    weeks.push({ a: a.getTime(), b: b.getTime(), label: `${a.getMonth() + 1}/${a.getDate()}`, v: 0 });
  }
  for (const s of sessions) {
    for (const set of s.sets) {
      if (set.exercise !== chartEx) continue;
      const v = hold ? set.holdSec || 0 : set.reps || 0;
      const w = weeks.find((x) => set.start >= x.a && set.start < x.b);
      if (w) w.v += v;
    }
  }
  const p = personalRecords(sessions)[chartEx];
  const max = Math.max(1, ...weeks.map((w) => w.v));
  const W = 320, H = 150, pad = 18, bw = (W - pad * 2) / weeks.length;
  const bars = weeks.map((w, i) => {
    const h = Math.round((w.v / max) * (H - 44));
    const x = pad + i * bw + 5, y = H - 22 - h;
    return `<rect class="bar ${i === weeks.length - 1 ? 'cur' : ''}" x="${x}" y="${y}" width="${bw - 10}" height="${Math.max(h, w.v ? 2 : 0)}" rx="4"></rect>
      ${w.v ? `<text class="val" x="${x + (bw - 10) / 2}" y="${y - 4}" text-anchor="middle">${w.v}</text>` : ''}
      <text x="${x + (bw - 10) / 2}" y="${H - 6}" text-anchor="middle">${w.label}</text>`;
  }).join('');
  const pp = p && (p.maxWeight || p.maxReps?.reps || p.maxHold) ? prParts(p) : null;
  const bestTxt = pp ? `최고 기록: ${pp.main} (${pp.sub})` : '';
  return `<div class="card chart" style="margin-bottom:12px"><div style="font-weight:800">운동별 주간 ${hold ? '시간(초)' : '반복 수'}</div>
    <div class="chips">${exs.slice(0, 10).map((id) => `<button class="chip" data-chart-ex="${id}" aria-pressed="${id === chartEx}">${esc(exName(id))}</button>`).join('')}</div>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(exName(chartEx))} 최근 8주 추이">${bars}</svg>
    <div class="muted small">${bestTxt}</div></div>`;
}

function listHtml(sessions) {
  let html = '';
  let cur = '';
  for (const s of sessions) {
    const d = new Date(s.start);
    const label = `${d.getFullYear()}년 ${d.getMonth() + 1}월`;
    if (label !== cur) {
      if (cur) html += '</div>';
      html += `<h2 class="section-title">${label}</h2><div class="session-list">`;
      cur = label;
    }
    html += sessionItem(s);
  }
  return html + (cur ? '</div>' : '');
}

document.addEventListener('click', (e) => {
  if (!root) return;
  const cal = e.target.closest('[data-cal]');
  if (cal && root.contains(cal)) {
    monthOffset = Math.min(0, monthOffset + Number(cal.dataset.cal));
    renderHistory(root);
  }
  const chip = e.target.closest('[data-chart-ex]');
  if (chip && root.contains(chip)) {
    chartEx = chip.dataset.chartEx;
    renderHistory(root);
  }
});
