// 포즈 랜드마크(MediaPipe 33점) → 운동 판별용 특징값.
// 각도는 월드 좌표(미터, 엉덩이 중심 원점, y축 아래 방향)로 계산해 카메라 거리·줌에 덜 민감하게 한다.
// 계산할 수 없는 값(관절이 안 보임)은 NaN 으로 둔다 — 판정 쪽에서 NaN 은 항상 '불통과'로 취급된다.

export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

export const KEY_JOINTS = [
  LM.L_SHOULDER, LM.R_SHOULDER, LM.L_ELBOW, LM.R_ELBOW, LM.L_WRIST, LM.R_WRIST,
  LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE,
];

export const VIS_MIN = 0.5;
const DEG = 180 / Math.PI;

const vis = (p) => (p ? (p.visibility ?? 1) : 0);

function angle3(a, b, c) {
  const ux = a.x - b.x, uy = a.y - b.y, uz = a.z - b.z;
  const vx = c.x - b.x, vy = c.y - b.y, vz = c.z - b.z;
  const nu = Math.hypot(ux, uy, uz), nv = Math.hypot(vx, vy, vz);
  if (!nu || !nv) return NaN;
  const cos = (ux * vx + uy * vy + uz * vz) / (nu * nv);
  return Math.acos(Math.max(-1, Math.min(1, cos))) * DEG;
}

// 좌/우 값을 가시성으로 합친다. 옆모습이면 보이는 쪽만 쓴다.
function sided(a, wa, b, wb) {
  const okA = wa >= VIS_MIN && Number.isFinite(a);
  const okB = wb >= VIS_MIN && Number.isFinite(b);
  if (okA && okB) {
    return { L: a, R: b, avg: (a * wa + b * wb) / (wa + wb), min: Math.min(a, b), max: Math.max(a, b) };
  }
  if (okA) return { L: a, R: NaN, avg: a, min: a, max: a };
  if (okB) return { L: NaN, R: b, avg: b, min: b, max: b };
  return { L: NaN, R: NaN, avg: NaN, min: NaN, max: NaN };
}

const minVis = (lm, ...idx) => Math.min(...idx.map((i) => vis(lm[i])));

/**
 * @param {Array<{x,y,z,visibility}>} lm  정규화 이미지 좌표 33점
 * @param {Array<{x,y,z,visibility}>} wl  월드 좌표 33점 (미터)
 */
export function computeFeatures(lm, wl) {
  const f = {};
  const L = LM;

  const visKey = KEY_JOINTS.map((i) => vis(lm[i]));
  f.visAll = visKey.reduce((s, v) => s + v, 0) / visKey.length;
  f.visLegs = (vis(lm[L.L_HIP]) + vis(lm[L.R_HIP]) + vis(lm[L.L_KNEE]) + vis(lm[L.R_KNEE])
    + vis(lm[L.L_ANKLE]) + vis(lm[L.R_ANKLE])) / 6;
  f.visArms = (vis(lm[L.L_SHOULDER]) + vis(lm[L.R_SHOULDER]) + vis(lm[L.L_ELBOW]) + vis(lm[L.R_ELBOW])
    + vis(lm[L.L_WRIST]) + vis(lm[L.R_WRIST])) / 6;

  const knee = sided(
    angle3(wl[L.L_HIP], wl[L.L_KNEE], wl[L.L_ANKLE]), minVis(lm, L.L_HIP, L.L_KNEE, L.L_ANKLE),
    angle3(wl[L.R_HIP], wl[L.R_KNEE], wl[L.R_ANKLE]), minVis(lm, L.R_HIP, L.R_KNEE, L.R_ANKLE));
  f.knee = knee.avg; f.kneeMin = knee.min; f.kneeL = knee.L; f.kneeR = knee.R;

  const hip = sided(
    angle3(wl[L.L_SHOULDER], wl[L.L_HIP], wl[L.L_KNEE]), minVis(lm, L.L_SHOULDER, L.L_HIP, L.L_KNEE),
    angle3(wl[L.R_SHOULDER], wl[L.R_HIP], wl[L.R_KNEE]), minVis(lm, L.R_SHOULDER, L.R_HIP, L.R_KNEE));
  f.hip = hip.avg; f.hipMin = hip.min;

  const elbow = sided(
    angle3(wl[L.L_SHOULDER], wl[L.L_ELBOW], wl[L.L_WRIST]), minVis(lm, L.L_SHOULDER, L.L_ELBOW, L.L_WRIST),
    angle3(wl[L.R_SHOULDER], wl[L.R_ELBOW], wl[L.R_WRIST]), minVis(lm, L.R_SHOULDER, L.R_ELBOW, L.R_WRIST));
  f.elbow = elbow.avg; f.elbowMin = elbow.min; f.elbowL = elbow.L; f.elbowR = elbow.R;

  // 팔 들어올림 각도(몸통-위팔): 차렷 ≈ 15°, 수평 ≈ 90°, 만세 ≈ 170°
  const arm = sided(
    angle3(wl[L.L_HIP], wl[L.L_SHOULDER], wl[L.L_ELBOW]), minVis(lm, L.L_HIP, L.L_SHOULDER, L.L_ELBOW),
    angle3(wl[L.R_HIP], wl[L.R_SHOULDER], wl[L.R_ELBOW]), minVis(lm, L.R_HIP, L.R_SHOULDER, L.R_ELBOW));
  f.arm = arm.avg; f.armMax = arm.max;

  // 몸통 기울기: 엉덩이 중심→어깨 중심 벡터와 '위쪽'의 각도. 0 = 똑바로 섬, 90 = 수평, >90 = 엉덩이가 어깨보다 높음
  const sL = wl[L.L_SHOULDER], sR = wl[L.R_SHOULDER], hL = wl[L.L_HIP], hR = wl[L.R_HIP];
  const torsoVis = Math.max(minVis(lm, L.L_SHOULDER, L.L_HIP), minVis(lm, L.R_SHOULDER, L.R_HIP));
  if (torsoVis >= VIS_MIN) {
    const vx = (sL.x + sR.x - hL.x - hR.x) / 2;
    const vy = (sL.y + sR.y - hL.y - hR.y) / 2;
    const vz = (sL.z + sR.z - hL.z - hR.z) / 2;
    const n = Math.hypot(vx, vy, vz);
    f.torsoTilt = n ? Math.acos(Math.max(-1, Math.min(1, -vy / n))) * DEG : NaN;
  } else f.torsoTilt = NaN;

  // 엉덩이 높이(발목 기준, m). 서 있으면 ≈ 0.8, 스쿼트 바닥 ≈ 0.4~0.5, 바닥에 누우면 ≈ 0
  const hipH = sided(
    wl[L.L_ANKLE].y - wl[L.L_HIP].y, minVis(lm, L.L_ANKLE, L.L_HIP),
    wl[L.R_ANKLE].y - wl[L.R_HIP].y, minVis(lm, L.R_ANKLE, L.R_HIP));
  f.hipH = hipH.avg;
  f.hipHAbs = Math.abs(hipH.avg);

  // 손목 높이(어깨 기준, m, 위가 +). 차렷 ≈ -0.5, 어깨높이 ≈ 0, 머리 위 ≈ +0.4
  const wristH = sided(
    wl[L.L_SHOULDER].y - wl[L.L_WRIST].y, minVis(lm, L.L_SHOULDER, L.L_WRIST),
    wl[L.R_SHOULDER].y - wl[L.R_WRIST].y, minVis(lm, L.R_SHOULDER, L.R_WRIST));
  f.wristH = wristH.avg; f.wristHMax = wristH.max;
  f.shoulderOverWrist = -wristH.avg; // 푸시업: 팔 편 상태 ≈ 0.5, 내려가면 ≈ 0.15

  // 코가 어깨보다 얼마나 아래인지(m): 엎드린 푸시업은 ≥ 0 근처, 서거나 앉아 있으면 -0.15 안팎
  const shMidY = (sL.y + sR.y) / 2;
  f.noseDrop = vis(lm[L.NOSE]) >= VIS_MIN && torsoVis >= VIS_MIN ? wl[L.NOSE].y - shMidY : NaN;

  // 무릎 높이 차(m): 스쿼트는 두 무릎 높이가 같고, 런지는 뒷무릎이 바닥 가까이 내려간다
  const kneeVisBoth = Math.min(vis(lm[L.L_KNEE]), vis(lm[L.R_KNEE]));
  f.kneeYDiff = kneeVisBoth >= 0.3 ? Math.abs(wl[L.L_KNEE].y - wl[L.R_KNEE].y) : NaN;

  const ankleVisBoth = Math.min(vis(lm[L.L_ANKLE]), vis(lm[L.R_ANKLE]));
  f.ankleDX = ankleVisBoth >= 0.3 ? Math.abs(wl[L.L_ANKLE].x - wl[L.R_ANKLE].x) : NaN;
  f.ankleDZ = ankleVisBoth >= 0.3 ? Math.abs(wl[L.L_ANKLE].z - wl[L.R_ANKLE].z) : NaN;
  // 무릎 간격(m): 정면에서 스쿼트할 때 무릎이 안으로 모이는지(발목 간격 대비) 판단
  f.kneeDX = kneeVisBoth >= 0.3 ? Math.abs(wl[L.L_KNEE].x - wl[L.R_KNEE].x) : NaN;
  // 정면을 보고 있는지: 어깨가 좌우(x)로 넓게 보이면 정면, 앞뒤(z)로 벌어지면 옆모습
  const sdx = Math.abs(sL.x - sR.x), sdz = Math.abs(sL.z - sR.z);
  f.frontal = sdx / (sdz + 1e-3);

  // 몸 일직선(어깨-엉덩이-발목) 각도와 엉덩이 처짐(+)/들림(-) (m): 플랭크·푸시업 자세 교정용
  const ankleVis = Math.max(vis(lm[L.L_ANKLE]), vis(lm[L.R_ANKLE]));
  if (torsoVis >= VIS_MIN && ankleVis >= VIS_MIN) {
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
    const S = mid(sL, sR), H = mid(hL, hR), A = mid(wl[L.L_ANKLE], wl[L.R_ANKLE]);
    f.bodyLine = angle3(S, H, A);
    const ax = A.x - S.x, ay = A.y - S.y, az = A.z - S.z;
    const len2 = ax * ax + ay * ay + az * az;
    const k = len2 ? ((H.x - S.x) * ax + (H.y - S.y) * ay + (H.z - S.z) * az) / len2 : 0;
    f.hipSag = H.y - (S.y + k * ay); // 월드 y는 아래가 + → 양수면 엉덩이가 선보다 아래(처짐)
  } else {
    f.bodyLine = NaN;
    f.hipSag = NaN;
  }

  const wristVisBoth = Math.min(vis(lm[L.L_WRIST]), vis(lm[L.R_WRIST]));
  f.wristDX = wristVisBoth >= 0.3 ? Math.abs(wl[L.L_WRIST].x - wl[L.R_WRIST].x) : NaN;

  // 화면(2D) 정보: 사람이 화면 안에 다 들어왔는지 안내용
  let minX = 1, maxX = 0, minY = 1, maxY = 0, n2d = 0;
  for (const i of [L.NOSE, ...KEY_JOINTS]) {
    const p = lm[i];
    if (vis(p) < VIS_MIN) continue;
    n2d++;
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  f.box = n2d ? { x: minX, y: minY, w: maxX - minX, h: maxY - minY } : null;
  // 화면상 어깨 높이(0=위, 1=아래): 풀업처럼 몸 전체가 오르내리는지 보는 용도 (월드 좌표는 엉덩이 기준이라 안 보임)
  const shVis = Math.min(vis(lm[L.L_SHOULDER]), vis(lm[L.R_SHOULDER]));
  f.shY = shVis >= VIS_MIN ? (lm[L.L_SHOULDER].y + lm[L.R_SHOULDER].y) / 2 : NaN;
  // 발뒤꿈치 들림(m): 발끝보다 뒤꿈치가 높을수록 + (카프 레이즈)
  const heel = sided(
    wl[31].y - wl[29].y, minVis(lm, 29, 31),
    wl[32].y - wl[30].y, minVis(lm, 30, 32));
  f.heelLift = heel.avg;
  const edge = 0.02;
  f.cutoff = !!f.box && (minX < edge || maxX > 1 - edge || minY < edge || maxY > 1 - edge);

  return f;
}

// 스무딩 대상 특징 (나머지는 원본 그대로)
export const SMOOTH_KEYS = [
  'knee', 'kneeMin', 'kneeL', 'kneeR', 'hip', 'hipMin', 'elbow', 'elbowMin', 'elbowL', 'elbowR', 'arm', 'armMax', 'torsoTilt', 'hipH', 'hipHAbs',
  'wristH', 'wristHMax', 'shoulderOverWrist', 'kneeYDiff', 'ankleDX', 'ankleDZ', 'wristDX',
  'kneeDX', 'frontal', 'bodyLine', 'hipSag', 'shY', 'heelLift', 'noseDrop',
];
