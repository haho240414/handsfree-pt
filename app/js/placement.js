// '폰은 어디에 둘까요?' 안내 창 — 홈·설정·운동 준비 화면(촬영 위치 도움말)이 함께 쓴다.
// 카메라를 가까이 두려면 '어디에 두느냐'가 크다: 바닥에 똑바로 세우면 머리까지 담으려고 멀리 가야 한다.
// 거리는 카메라 시야각으로 계산(camera.js placementDistance) — 안드로이드 앱이면 이 폰 렌즈 값, 아니면 보통 폰 값.

import { NativeCameraInfo } from './native.js';
import { placementTable, cameraOptions, TYPICAL_FOV } from './camera.js';

const $ = (id) => document.getElementById(id);

/**
 * @param {{label?:string}} [cur] 지금 켜져 있는 카메라(운동 준비 화면): 그 카메라 시야각으로 계산한다
 */
export async function showPlacementHelp(cur = {}) {
  let front = null, rear = null, using = null;
  if (NativeCameraInfo) {
    try {
      const cams = (await NativeCameraInfo.listCameras()).cameras || [];
      const widest = (side) => cams.filter((c) => c.facing === side && Number.isFinite(c.fovLong)).sort((a, b) => b.fovLong - a.fovLong)[0];
      front = widest('front');
      rear = widest('back');
      // 카메라 이름이 보이면(권한이 있을 때) 지금 쓰는 카메라의 시야각
      if (cur.label) using = (await cameraOptions({ probe: false })).find((c) => c.label === cur.label && c.fovLong) || null;
    } catch { /* 모르면 보통 폰 값 */ }
  }
  const fov = using?.fovLong ?? (front ? Math.round(front.fovLong) : TYPICAL_FOV);
  const rows = placementTable(fov);
  const m = (v) => (v == null ? '–' : `${v}m`);
  const rearFov = rear ? Math.round(rear.fovLong) : null;
  const rearRows = rearFov && rearFov - fov > 15 && using?.facing !== 'environment' ? placementTable(rearFov) : null;
  const which = using ? `지금 쓰는 ${using.name}(시야 ${fov}°)` : front ? `이 폰 전면 카메라(시야 ${fov}°)` : `보통 폰 전면 카메라(시야 약 ${fov}°)`;
  const d = $('dialog');
  d.onclose = null;
  d.innerHTML = `<form method="dialog" class="place-help"><h3>폰은 어디에 둘까요?</h3>
    <p class="muted small" style="margin-top:0">${which} 기준, 키 175cm 가 다 들어오는 가장 가까운 거리예요.</p>
    <table class="place-table"><thead><tr><th>두는 곳</th><th>전신</th><th>무릎까지<span>스쿼트·런지</span></th><th>상체만<span>컬·레이즈</span></th></tr></thead>
    <tbody>${rows.map((r) => `<tr class="${r.key === 'floor' ? 'worst' : ''}"><td><b>${r.name}</b><span>${r.sub}</span></td>
      <td>${m(r.full)}</td><td>${m(r.knees)}</td><td>${m(r.upper)}</td></tr>`).join('')}</tbody></table>
    <ul class="feedback">
      <li><b>폰 높이는 보여야 할 부분의 가운데</b>일 때 가장 가까워요 — 전신은 허리, 상체 운동은 가슴 높이</li>
      <li>바닥에 둘 땐 <b>뒤로 20° 정도 기울여</b> 위를 보게 하세요. 기울기는 앱이 센서로 자동 보정해요(발끝이 잘리지 않게만)</li>
      <li>상체 운동(컬·레이즈·프레스 등)은 허리까지만 보이면 돼요. 누워서·엎드려 하는 운동은 폰을 가로로 눕혀 옆에서</li>
      <li><b>스쿼트·런지·데드리프트를 골라서 할 땐</b>(오늘의 루틴·하루 목표) 허리까지만 보여도 세요 — '상체만' 칸 거리. 무릎까지 보이면 자세 교정도 해요</li>
      <li>몸이 너무 작게 보이면 조금 가까이, 조명은 몸 앞쪽에서 — 역광이면 관절을 잘 못 찾아요</li>
      ${rearRows ? `<li><b>후면 초광각(시야 ${rearFov}°)</b>으로 바꾸면 탁자 위 ${m(rearRows[0].full)} · 바닥+20° ${m(rearRows[1].full)}. 화면은 반대쪽이지만 숫자는 소리로 세요(설정 → 카메라 찾기, 운동 준비 화면의 카메라 전환)</li>` : ''}
    </ul>
    <div class="btn-row"><button value="ok" class="btn btn-primary">알겠어요</button></div></form>`;
  d.showModal();
}
