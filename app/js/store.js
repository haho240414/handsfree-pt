// 기록·설정 저장 (이 폰의 브라우저 저장소). 서버로 보내지 않는다.

const KEY = 'hfpt.v1';

export const DEFAULT_SETTINGS = {
  voice: true,          // 음성 안내
  countStyle: 'native', // native(하나 둘 셋) | number(일 이 삼)
  cues: true,           // 자세 교정 음성
  rest: 60,             // 휴식 타이머(초), 0 = 끔
  model: 'full',        // full(정확) | lite(빠름)
  lockReps: 2,          // 자동 인식 확정에 필요한 반복 수
  mirror: true,         // 화면 좌우 반전(거울처럼)
  debug: false,         // 인식 과정 보기
  theme: 'auto',        // auto | light | dark
};

const blank = () => ({ sessions: [], settings: { ...DEFAULT_SETTINGS }, weights: {}, lastPick: [] });

let state = load();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blank();
    const s = JSON.parse(raw);
    return { ...blank(), ...s, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) } };
  } catch {
    return blank();
  }
}

let saveFailed = false;
function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveFailed = false;
  } catch {
    saveFailed = true; // 사생활 보호 모드 등: 이번 실행 동안만 메모리에 유지
  }
}
export const storageOk = () => !saveFailed;

export const settings = () => state.settings;
export function setSetting(k, v) {
  state.settings[k] = v;
  persist();
}

export const sessions = () => state.sessions;
export const getSession = (id) => state.sessions.find((s) => s.id === id) || null;

export function upsertSession(sess) {
  const i = state.sessions.findIndex((s) => s.id === sess.id);
  if (i >= 0) state.sessions[i] = sess;
  else state.sessions.push(sess);
  state.sessions.sort((a, b) => b.start - a.start);
  persist();
}

export function deleteSession(id) {
  state.sessions = state.sessions.filter((s) => s.id !== id);
  persist();
}

export const lastWeight = (ex) => state.weights[ex] ?? null;
export function rememberWeight(ex, kg) {
  if (kg == null || kg === '') delete state.weights[ex];
  else state.weights[ex] = Number(kg);
  persist();
}

export const lastPick = () => state.lastPick || [];
export function setLastPick(ids) {
  state.lastPick = ids;
  persist();
}

export function exportJSON() {
  return JSON.stringify({ app: 'handsfree-pt', version: 1, exportedAt: new Date().toISOString(), ...state }, null, 2);
}

export function importJSON(text) {
  const data = JSON.parse(text);
  if (!Array.isArray(data.sessions)) throw new Error('핸즈프리 PT 백업 파일이 아니에요');
  const known = new Set(state.sessions.map((s) => s.id));
  let added = 0;
  for (const s of data.sessions) {
    if (!s?.id || known.has(s.id)) continue;
    state.sessions.push(s);
    added++;
  }
  state.sessions.sort((a, b) => b.start - a.start);
  if (data.weights) state.weights = { ...data.weights, ...state.weights };
  persist();
  return added;
}

export function wipe() {
  const keep = state.settings;
  state = blank();
  state.settings = keep;
  persist();
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
