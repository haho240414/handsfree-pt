// 기록·설정 저장 (이 폰의 브라우저 저장소). 서버로 보내지 않는다.

const KEY = 'hfpt.v1';

export const DEFAULT_SETTINGS = {
  voice: true,          // 음성 안내
  countStyle: 'native', // native(하나 둘 셋) | number(일 이 삼)
  cues: true,           // 자세 교정 음성
  rest: 60,             // 휴식 타이머(초), 0 = 끔
  restAlerts: [10],     // 휴식 끝 몇 초 전에 알려줄지 (30·10·5, 3 = '셋 둘 하나')
  setEndSec: 0,         // 반복이 멈추고 이 초가 지나면 세트 끝, 0 = 자동(평소 반복 간격의 2.2배, 3.5~12초)
  model: 'full',        // full(정확) | lite(빠름)
  gpu: true,            // GPU 가속 (끄면 CPU 호환 모드)
  analysisFps: 15,      // 초당 분석 장수: 15(절전, 기본 — 인식 기준을 맞춘 영상도 초당 15장) / 30(빠른 동작용)
  handGesture: true,    // 쉬는 동안 두 손을 머리 위로 2초 = 휴식 끝
  lockReps: 2,          // 자동 인식 확정에 필요한 반복 수
  mirror: true,         // 화면 좌우 반전(거울처럼, 전면 카메라일 때만)
  cameraId: '',         // 고른 카메라(deviceId), '' = 전면 기본
  cameraLabel: '',
  cameraWide: true,     // 넓게 보기: 센서 전체(4:3)로 찍고, 줌을 줄일 수 있으면 가장 넓게(광각)
  debug: false,         // 인식 과정 보기
  theme: 'auto',        // auto | light | dark
};

const blank = () => ({
  sessions: [], settings: { ...DEFAULT_SETTINGS }, weights: {}, lastPick: [],
  routineDraft: null,  // 지금 짜 둔 오늘 루틴 { name, focus, equipment, level, reason, items, seedN }
  routinePrefs: { focus: 'auto', equipment: 'body', minutes: 30, level: 1 },
  routines: [],        // 저장한 내 루틴 [{ id, name, items, savedAt }]
});

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

/* ---------- 오늘의 루틴(PT 모드) ---------- */
export const routineDraft = () => state.routineDraft || null;
export function setRoutineDraft(r) {
  state.routineDraft = r;
  persist();
}
export const routinePrefs = () => ({ focus: 'auto', equipment: 'body', minutes: 30, level: 1, ...(state.routinePrefs || {}) });
export function setRoutinePrefs(p) {
  state.routinePrefs = { ...routinePrefs(), ...p };
  persist();
}
export const routines = () => state.routines || [];
export function saveRoutine(r) {
  const list = routines().filter((x) => x.id !== r.id);
  list.unshift(r);
  state.routines = list.slice(0, 30);
  persist();
}
export function deleteRoutine(id) {
  state.routines = routines().filter((x) => x.id !== id);
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
  if (Array.isArray(data.routines)) {
    const have = new Set(routines().map((r) => r.id));
    state.routines = [...routines(), ...data.routines.filter((r) => r?.id && !have.has(r.id))];
  }
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
