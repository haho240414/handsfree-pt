// 카메라 고르기·넓게 보기·폰을 어디에 둘지.
// - 4:3·크롭 없는 원본 화면을 요청한다. 실제 화각·지원 여부는 기기와 WebView 에 따라 다르다.
// - 줌은 1배 아래로 못 간다: 안드로이드 크롬·WebView 의 줌은 화면을 잘라 내는 방식(Chromium VideoCaptureCamera2, 핏락에서 확인).
//   더 넓게 보려면 폰이 따로 보여 주는 광각 카메라를 골라야 하고, 시야각은 안드로이드 앱이 렌즈 정보로 계산한다(CameraInfoPlugin).
// - 카메라를 가까이 두려면 '어디에 두느냐'가 더 크다: 바닥에 똑바로 세우면 머리까지 담으려고 멀리 가야 한다(아래 placementDistance).

import { NativeCameraInfo } from './native.js';

const SIZE = {
  wide: { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 }, resizeMode: 'none' },
  normal: { width: { ideal: 1280 }, height: { ideal: 720 } },
};
const stop = (stream) => stream?.getTracks().forEach((t) => t.stop());
const isWideLabel = (label = '') => /wide|광각|ultra/i.test(label);

/** 설정대로 카메라를 연다. 고른 카메라가 없어졌으면(다른 폰·초기화) 전면 기본으로 */
export async function openCamera(st) {
  const size = st.cameraWide ? SIZE.wide : SIZE.normal;
  const defaults = { facingMode: st.facingMode || 'user', ...size, frameRate: { ideal: 30 } };
  const want = st.cameraId ? { deviceId: { exact: st.cameraId }, ...size, frameRate: { ideal: 30 } } : defaults;
  const open = (video) => navigator.mediaDevices.getUserMedia({ video, audio: false });
  let stream;
  try {
    stream = await open(want);
  } catch (e) {
    if (st.cameraId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) {
      stream = await open(defaults);
    } else throw e;
  }
  // 직접 고른 카메라는 존중한다. 자동 모드에서는 권한을 받은 뒤 이름이 확인된 전면 광각만 고른다.
  if (!st.cameraWide || st.cameraId || st.facingMode === 'environment') return stream;
  const track = stream.getVideoTracks()[0];
  if (isWideLabel(track?.label)) return stream;
  let devices;
  try { devices = await navigator.mediaDevices.enumerateDevices(); } catch { return stream; }
  const wide = devices.find((d) => d.kind === 'videoinput' && d.deviceId
    && facingFromLabel(d.label) === 'user' && isWideLabel(d.label)
    && d.deviceId !== track?.getSettings?.().deviceId);
  if (!wide) return stream;
  // 갤럭시에서 동시에 두 카메라를 열면 실패할 수 있으므로 먼저 기본 카메라를 놓는다.
  stop(stream);
  try { return await open({ deviceId: { exact: wide.deviceId }, ...size, frameRate: { ideal: 30 } }); }
  catch { return open(defaults); }
}

/** 넓게 보기: 줌을 가장 작게(1배 미만이면 광각 렌즈로 바뀌는 폰이 있다). 실제로 잡힌 카메라 정보를 돌려준다 */
export async function widenCamera(stream, wide) {
  const track = stream.getVideoTracks()[0];
  const caps = track.getCapabilities?.() || {};
  let set = track.getSettings?.() || {};
  const zoomMin = Number.isFinite(caps.zoom?.min) && caps.zoom.min > 0 ? caps.zoom.min : null;
  if (wide && zoomMin != null && (set.zoom == null || zoomMin < set.zoom)) {
    // applyConstraints 는 이전 설정을 대체한다. 줌만 넘기면 4:3·해상도 요청이 사라진다.
    const constraints = track.getConstraints?.() || {};
    try {
      await track.applyConstraints({ ...constraints, advanced: [...(constraints.advanced || []), { zoom: zoomMin }] });
    } catch { /* 줌 조절 안 됨: 실제 getSettings 값으로 표시 */ }
    set = track.getSettings?.() || set;
  }
  return {
    label: track.label || '',
    facing: set.facingMode || facingFromLabel(track.label),
    width: set.width ?? null, height: set.height ?? null,
    zoom: set.zoom ?? null, zoomMin, wideRequested: !!wide,
  };
}

/** 실제로 열린 카메라 설정만 표시한다. 4:3 이라고 광각 렌즈로 전환됐다고 단정하지 않는다. */
export function cameraSummary(info) {
  if (!info) return '';
  const parts = [info.facing === 'user' ? '전면' : info.facing === 'environment' ? '후면' : '카메라'];
  if (isWideLabel(info.label)) parts.push('광각');
  if (info.width > 0 && info.height > 0) {
    const ratio = Math.max(info.width, info.height) / Math.min(info.width, info.height);
    if (Math.abs(ratio - 4 / 3) < 0.04) parts.push('4:3');
    else if (Math.abs(ratio - 16 / 9) < 0.04) parts.push('16:9');
  }
  if (Number.isFinite(info.zoom)) parts.push(`${Math.round(info.zoom * 10) / 10}배`);
  return parts.join(' · ');
}

export function facingFromLabel(label = '') {
  if (/front|user|전면|facetime/i.test(label)) return 'user';
  if (/back|rear|environment|후면/i.test(label)) return 'environment';
  return '';
}

/**
 * 설정 화면용: 이 폰의 카메라 목록. 이름·방향은 카메라 권한이 있어야 보여서 잠깐 켰다 끄고,
 * 카메라마다 잠깐 열어 방향과 줌 범위를 확인한다(줌 1배 미만 = 광각).
 */
export async function listCameras() {
  let tmp = null;
  try { tmp = await navigator.mediaDevices.getUserMedia({ video: true, audio: false }); } catch { /* 권한 거부 */ }
  tmp?.getTracks().forEach((t) => t.stop());
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  const out = [];
  for (const [i, d] of devs.entries()) {
    let s = null;
    let info = { facing: facingFromLabel(d.label), zoomMin: null, maxW: null, maxH: null };
    try {
      s = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: d.deviceId } }, audio: false });
      const t = s.getVideoTracks()[0];
      const caps = t.getCapabilities?.() || {};
      const set = t.getSettings?.() || {};
      info = {
        facing: set.facingMode || caps.facingMode?.[0] || info.facing,
        zoomMin: caps.zoom?.min ?? null, maxW: caps.width?.max ?? null, maxH: caps.height?.max ?? null,
      };
    } catch { /* 지금은 열 수 없는 카메라 */ }
    finally { stop(s); }
    out.push({ id: d.deviceId, label: d.label || `카메라 ${i + 1}`, ...info });
  }
  return out;
}

/** 목록 표시 이름(시야각을 모를 때): 전면 1 · 후면 2 */
export function cameraNames(cams) {
  const seen = {};
  return cams.map((c) => {
    const side = c.facing === 'user' ? '전면' : c.facing === 'environment' ? '후면' : '카메라';
    seen[side] = (seen[side] || 0) + 1;
    return `${side} ${seen[side]}${/wide|광각|ultra/i.test(c.label) ? ' · 광각' : ''}`;
  });
}

/** 시야각을 모를 때 쓰는 보통 폰 전면 카메라 값: 세로로 세웠을 때 위아래 시야(4:3 센서 전체) */
export const TYPICAL_FOV = 70;
/** 바닥 기준 높이(m)로 본 '화면에 들어와야 할 범위' — 키 175cm 에 위아래 여유. 운동별 구분은 engine/exercises.js VIEW */
export const VIEW_RANGE = { upper: [0.8, 1.95], overhead: [0.8, 2.3], knees: [0.4, 1.95], full: [-0.05, 1.95] };

/**
 * 폰을 바닥에서 h(m) 높이에 세로로 세우고 위로 tilt(°) 기울였을 때, 범위 [y0, y1] 이 다 들어오는 가장 가까운 거리(m).
 * 위로 기울이면 위쪽은 더 보이고 발밑은 덜 보인다. 그 자리에선 안 되면 null
 */
export function placementDistance(fovLong, [y0, y1], { h = 0.9, tilt = 0 } = {}) {
  const half = (fovLong * Math.PI) / 360;
  const t = (tilt * Math.PI) / 180;
  const up = Math.tan(t + half);
  const down = Math.tan(half - t);
  if (!(up > 0)) return null;
  let d = 0;
  if (y1 > h) d = Math.max(d, (y1 - h) / up);
  if (y0 < h) {
    if (!(down > 0)) return null;
    d = Math.max(d, (h - y0) / down);
  }
  return Math.ceil(d * 10) / 10;
}

/** 두는 곳마다 필요한 거리 (자리 잡기 안내 표) */
export const SPOTS = [
  { key: 'table', name: '의자·탁자 위', sub: '허리 높이, 폰은 똑바로', h: 0.9, tilt: 0 },
  { key: 'floorTilt', name: '바닥 + 뒤로 20° 기울이기', sub: '기울기는 앱이 자동 보정', h: 0.08, tilt: 20 },
  { key: 'chest', name: '선반·서랍장 위', sub: '가슴 높이, 상체 운동에 좋아요', h: 1.3, tilt: 0 },
  { key: 'floor', name: '바닥에 똑바로', sub: '가장 멀리 가야 해요', h: 0.08, tilt: 0 },
];
export function placementTable(fovLong = TYPICAL_FOV) {
  return SPOTS.map((sp) => ({
    ...sp,
    full: placementDistance(fovLong, VIEW_RANGE.full, sp),
    knees: placementDistance(fovLong, VIEW_RANGE.knees, sp),
    upper: placementDistance(fovLong, VIEW_RANGE.upper, sp),
  }));
}
/** 그 카메라로 전신을 담는 가장 가까운 거리(바닥+기울이기·탁자 중 가까운 쪽) */
export const bestDistance = (fovLong) => Math.min(...['table', 'floorTilt'].map((k) => {
  const sp = SPOTS.find((x) => x.key === k);
  return placementDistance(fovLong, VIEW_RANGE.full, sp) ?? 99;
}));

/** 웹 카메라 이름의 번호('camera2 1, facing front' → 1) = 안드로이드 카메라 목록 순서 */
const camIndex = (label, i) => {
  const m = /camera2?\s*(\d+)/i.exec(label || '');
  return m ? Number(m[1]) : i;
};

/**
 * 이 폰의 카메라 + 시야각 (넓은 순). 안드로이드 앱이면 시야각을 붙이고 '전면 광각'·'후면 초광각' 이름을 단다.
 * probe=false: 카메라를 하나씩 열어 보지 않고 목록만 (이미 카메라 권한이 있을 때 — 운동 시작 직후 자동 고르기)
 */
export async function cameraOptions({ probe = true } = {}) {
  let nat = [];
  if (NativeCameraInfo) {
    try { nat = (await NativeCameraInfo.listCameras()).cameras || []; } catch { nat = []; }
  }
  const web = probe || !nat.length
    ? await listCameras()
    : (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput')
      .map((d, i) => ({ id: d.deviceId, label: d.label || `카메라 ${i + 1}`, facing: facingFromLabel(d.label) }));
  const list = web.filter((c) => !/infrared/i.test(c.label)).map((c, i) => {
    const idx = camIndex(c.label, i);
    const n = nat.find((x) => x.index === idx);
    const facing = n?.facing === 'front' ? 'user' : n?.facing === 'back' ? 'environment' : c.facing;
    const fovLong = Number.isFinite(n?.fovLong) ? Math.round(n.fovLong) : null;
    return { deviceId: c.id, label: c.label, facing, fovLong, distance: fovLong ? bestDistance(fovLong) : null };
  });
  for (const side of ['user', 'environment']) {
    const same = list.filter((c) => c.facing === side);
    same.forEach((c, k) => { c.name = `${side === 'user' ? '전면' : '후면'}${same.length > 1 ? ` ${k + 1}` : ''}`; });
    const known = same.filter((c) => c.fovLong != null).sort((a, b) => b.fovLong - a.fovLong);
    if (known.length >= 2 && known[0].fovLong - known[1].fovLong > 8) {
      known[0].wide = true;
      known[0].name = side === 'user' ? '전면 광각' : '후면 초광각';
    }
  }
  for (const c of list) c.name ||= '카메라';
  return list.sort((a, b) => (b.fovLong ?? 0) - (a.fovLong ?? 0));
}
