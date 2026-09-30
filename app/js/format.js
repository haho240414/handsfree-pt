// 날짜·요약 문구 등 여러 화면이 같이 쓰는 도우미

import { EXERCISE_BY_ID } from './engine/exercises.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const exName = (id) => EXERCISE_BY_ID[id]?.name ?? id;
export const DAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const fmtDate = (ms) => {
  const d = new Date(ms);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${DAYS[d.getDay()]})`;
};
export const fmtTime = (ms) => {
  const d = new Date(ms);
  return `${d.getHours() < 12 ? '오전' : '오후'} ${((d.getHours() + 11) % 12) + 1}:${String(d.getMinutes()).padStart(2, '0')}`;
};
export const minutes = (sess) => Math.max(1, Math.round(((sess.end || sess.start) - sess.start) / 60000));
export const setValue = (s) => (s.kind === 'hold' ? `${s.holdSec}초` : `${s.reps}회`);

export function sessionTotals(sess) {
  const reps = sess.sets.reduce((a, s) => a + (s.kind === 'reps' ? s.reps || 0 : 0), 0);
  return { reps, sets: sess.sets.length, min: minutes(sess) };
}

export function sessionLine(sess) {
  const by = new Map();
  for (const s of sess.sets) {
    if (!by.has(s.exercise)) by.set(s.exercise, []);
    by.get(s.exercise).push(s);
  }
  return [...by].map(([ex, sets]) => `${exName(ex)} ${sets.length}세트`).join(' · ');
}


export function sessionItem(sess) {
  const d = new Date(sess.start);
  const tot = sessionTotals(sess);
  return `<button class="session-item" data-session="${esc(sess.id)}">
    <div class="session-date"><div class="d">${d.getDate()}</div><div class="m">${d.getMonth() + 1}월 ${DAYS[d.getDay()]}</div></div>
    <div class="session-main"><div class="t">${tot.min}분 · ${tot.reps}회 · ${tot.sets}세트</div>
    <div class="s">${esc(sessionLine(sess)) || '기록 없음'}</div></div><span class="chev">›</span></button>`;
}
