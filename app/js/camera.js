// 카메라 고르기·넓게 보기.
// 폰마다 다르다: 전면 광각이 따로 된 카메라로 보이는 폰, 줌을 1배 아래로 내릴 수 있는 폰(그게 광각), 둘 다 안 되는 폰.
// 4:3·크롭 없는 원본 화면을 요청한다. 실제 화각·지원 여부는 기기와 WebView 에 따라 다르다.

const SIZE = {
  wide: { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 }, resizeMode: 'none' },
  normal: { width: { ideal: 1280 }, height: { ideal: 720 } },
};
const stop = (stream) => stream?.getTracks().forEach((t) => t.stop());
const isWideLabel = (label = '') => /wide|광각|ultra/i.test(label);

/** 설정대로 카메라를 연다. 고른 카메라가 없어졌으면(다른 폰·초기화) 전면 기본으로 */
export async function openCamera(st) {
  const size = st.cameraWide ? SIZE.wide : SIZE.normal;
  const defaults = { facingMode: 'user', ...size, frameRate: { ideal: 30 } };
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
  if (!st.cameraWide || st.cameraId) return stream;
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

/** 목록 표시 이름: 전면 1 · 광각 (줌 0.6배까지) */
export function cameraNames(cams) {
  const seen = {};
  return cams.map((c) => {
    const side = c.facing === 'user' ? '전면' : c.facing === 'environment' ? '후면' : '카메라';
    seen[side] = (seen[side] || 0) + 1;
    const zoomWide = c.zoomMin != null && c.zoomMin < 1;
    const wide = /wide|광각|ultra/i.test(c.label) || zoomWide ? ' · 광각' : '';
    const zoom = zoomWide ? ` (줌 ${Math.round(c.zoomMin * 10) / 10}배까지)` : '';
    return `${side} ${seen[side]}${wide}${zoom}`;
  });
}
