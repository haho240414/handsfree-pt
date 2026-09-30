// 운동 정의 (판정 규칙표).
// - signal: 반복 카운터에 넣을 1차원 신호. 힘주는 구간이 '낮은 값'이 되도록 부호를 맞춘다.
// - prom: 1회로 인정할 최소 진폭 (신호 단위: 미터 또는 도)
// - check(w, b, rep): 반복 1회 구간(w)·최저점 부근(b) 프레임·반복 정보(rep.top/bottom = 신호의 꼭대기/바닥 값)로
//   '이 운동이 맞는지' 검사. [이름, 통과여부, soft?]
//   soft 조건은 '자동 인식'에서만 쓰고, 사용자가 운동을 직접 고른 경우엔 건너뛴다.
// - form(w, b): 자세 교정. [코드, 문제있음?, 짧은 음성 신호, 설명]. 값을 모르면(NaN) 문제로 보지 않는다.
// - verified: 실제 영상으로 횟수를 확인한 운동인지 (false 면 화면에 '베타' 표시)
// 숫자는 실제 영상 측정값으로 조정한다 (test/eval.mjs, README '검증' 참고).

const vals = (w, k) => w.map((f) => f[k]).filter(Number.isFinite).sort((a, b) => a - b);

/** 백분위수 (자료 부족하면 NaN → 비교가 모두 false 가 되어 조건 불통과) */
export function P(w, k, q) {
  const a = vals(w, k);
  if (a.length < 3) return NaN;
  const i = (a.length - 1) * q / 100;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return a[lo] + (a[hi] - a[lo]) * (i - lo);
}
export const M = (w, k) => P(w, k, 50);
export const R = (w, k) => P(w, k, 90) - P(w, k, 10);
// 한 팔씩 하는 동작도 잡도록 좌우 중 더 크게 움직인 쪽의 범위 (한쪽이 안 보이면 보이는 쪽)
const RS = (w, a, b) => {
  const ra = R(w, a), rb = R(w, b);
  return Number.isFinite(ra) && Number.isFinite(rb) ? Math.max(ra, rb) : Number.isFinite(ra) ? ra : rb;
};

// 다리가 고정인지 (점핑잭이 아닌지)
const legsStill = (w) => !(R(w, 'ankleDX') > 0.2);
// 가까이서 말하며 손짓하는 것과 구분 (카메라에서 떨어져 하체까지 보일 때만)
const atDistance = (w) => M(w, 'visLegs') > 0.55;
// 엎드린 자세(얼굴이 바닥 쪽): 푸시업·플랭크 계열. 앉거나 누운 자세와 구분
const faceDown = (w) => M(w, 'noseDrop') > -0.1;

export const GROUPS = ['하체', '가슴·어깨', '등', '팔', '코어', '유산소'];

export const EXERCISES = [
  // ───────── 하체 ─────────
  {
    id: 'squat', name: '스쿼트', group: '하체', unit: '회', kind: 'reps', priority: 9, verified: true,
    tip: '정면 또는 옆에서 무릎~발끝까지 보이게',
    signal: (f) => f.hipH, prom: 0.10, minDur: 0.5, maxDur: 8,
    check: (w, b) => [
      ['서서 하는 동작', P(w, 'hipH', 90) > 0.55],
      ['상체가 너무 숙여지지 않음', M(w, 'torsoTilt') < 55],
      ['무릎을 깊게 굽힘', P(w, 'knee', 10) < 115 && R(w, 'knee') > 25],
      ['엉덩이만 접는 동작 아님(데드리프트 아님)', !(P(w, 'torsoTilt', 90) > 60 && P(w, 'knee', 10) > 90), true],
      ['두 무릎 높이가 비슷(런지 아님)', M(b, 'kneeYDiff') < 0.2, true],
      ['팔을 머리 위로 흔들지 않음', !(P(w, 'wristH', 90) > 0.15 && R(w, 'wristH') > 0.5), true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 실측: 제대로 앉은 스쿼트는 바닥에서 무릎각 55~71°, 정면에서 무릎 간격/발목 간격 1.09~1.24
    form: (w, b) => [
      ['shallow', P(w, 'knee', 10) > 100, '더 깊게', '허벅지가 바닥과 평행해질 때까지 앉아 보세요'],
      ['kneesIn', M(b, 'frontal') > 4 && M(b, 'kneeDX') / M(b, 'ankleDX') < 0.85, '무릎 바깥으로', '무릎이 안쪽으로 모였어요. 발끝 방향으로 밀어주세요'],
      ['lean', M(b, 'torsoTilt') > 60, '가슴 펴기', '상체가 많이 숙여졌어요. 가슴을 세우고 앉으세요'],
    ],
  },
  {
    id: 'lunge', name: '런지', group: '하체', unit: '회', kind: 'reps', priority: 8, verified: true,
    tip: '옆이나 대각선에서 두 다리가 다 보이게',
    signal: (f) => f.hipH, prom: 0.10, minDur: 0.5, maxDur: 8,
    check: (w, b) => [
      ['서서 하는 동작', P(w, 'hipH', 90) > 0.55],
      ['상체를 세움', M(w, 'torsoTilt') < 45],
      ['무릎을 굽힘', P(w, 'knee', 10) < 140],
      ['앞뒤로 다리를 벌림(뒷무릎이 내려감)', M(b, 'kneeYDiff') >= 0.2, true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 실측: 바닥에서 무릎각 60~96°, 상체 기울기 7~24°
    form: (w, b) => [
      ['shallow', M(b, 'kneeMin') > 110, '더 깊게', '뒷무릎이 바닥에 가까워질 때까지 내려가세요'],
      ['lean', M(b, 'torsoTilt') > 35, '상체 세우기', '상체를 세우고 내려가세요'],
    ],
  },
  {
    id: 'deadlift', name: '데드리프트', group: '하체', unit: '회', kind: 'reps', priority: 8, verified: true,
    tip: '옆에서 머리~발끝이 보이게 (루마니안 포함)',
    // 엉덩이를 접는 동작(힌지). 바닥에서 시작하므로 첫 '들어올리기'도 1회로 센다(leadIn)
    // 실측: 바닥 무릎각 컨벤셔널 100~108°·루마니안 137~146°, 몸통 기울기 68~88°, 엉덩이 높이 0.48(컨벤셔널)~0.69m
    signal: (f) => -f.torsoTilt, prom: 25, minDur: 0.6, maxDur: 10, leadIn: true,
    check: (w) => [
      ['서서 하는 동작(엉덩이가 바닥까지 안 내려감)', P(w, 'hipH', 10) > 0.35],
      ['엉덩이를 접었다 폄', R(w, 'hip') > 45 && P(w, 'torsoTilt', 90) > 40],
      ['끝까지 일어섬', P(w, 'torsoTilt', 10) < 30],
      ['무릎은 조금만 굽힘(스쿼트 아님)', P(w, 'knee', 10) > 90],
      ['상체가 수평을 넘지 않음(버피 아님)', P(w, 'torsoTilt', 90) < 105],
      ['팔은 아래로(케틀벨 스윙 아님)', P(w, 'wristH', 90) < -0.25, true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 끝까지 섰는지(록아웃)는 횟수를 세는 순간(올라오는 도중)엔 아직 알 수 없어 교정 규칙에서 뺐다 — 실측 오경보 2/3회
  },
  {
    id: 'calf', name: '카프 레이즈', group: '하체', unit: '회', kind: 'reps', priority: 3, verified: false,
    tip: '옆에서 발끝·뒤꿈치가 잘 보이게',
    // 실측: 뒤꿈치가 발끝보다 약 3cm 올라감 → 작은 움직임이라 잡음에 약함(베타)
    signal: (f) => -f.heelLift, prom: 0.02, minDur: 0.5, maxDur: 6,
    check: (w) => [
      ['서서 무릎을 폄', P(w, 'knee', 10) > 150],
      ['상체를 세움', M(w, 'torsoTilt') < 25],
      ['몸 전체가 위로 올라감', R(w, 'shY') > 0.012, true],
      ['팔은 고정', R(w, 'wristH') < 0.15, true],
    ],
  },

  // ───────── 가슴·어깨 ─────────
  {
    id: 'pushup', name: '푸시업', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 9, verified: true,
    tip: '옆이나 대각선에서 머리~발끝이 한 화면에',
    signal: (f) => f.shoulderOverWrist, prom: 0.08, minDur: 0.4, maxDur: 8,
    check: (w) => [
      ['엎드린 자세', M(w, 'torsoTilt') > 45 && faceDown(w)],
      ['손으로 바닥을 짚음', P(w, 'shoulderOverWrist', 90) > 0.2],
      ['몸을 일직선으로 유지(힙 쓰러스트 아님)', R(w, 'torsoTilt') < 25 && P(w, 'hip', 10) > 130],
      ['팔을 굽혔다 폄', R(w, 'elbow') > 25 && P(w, 'elbow', 10) < 140, true],
      ['몸이 바닥 가까이', M(w, 'hipH') < 0.5],
    ],
    form: (w) => [
      ['shallow', P(w, 'elbow', 10) > 115, '더 깊게', '가슴이 바닥 가까이 가도록 내려가세요'],
      ['sag', M(w, 'hipSag') > 0.08, '엉덩이 올리기', '허리가 처졌어요. 배에 힘을 주고 몸을 일직선으로'],
      ['pike', M(w, 'hipSag') < -0.12, '엉덩이 내리기', '엉덩이가 너무 높아요. 머리부터 발끝까지 일직선으로'],
    ],
  },
  {
    id: 'bench', name: '벤치 프레스', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '벤치 옆에서 팔과 몸통이 보이게',
    // 누워서 손을 위로 밀어올림 → 손목이 어깨보다 위(+). 가슴까지 내리면 작아짐
    signal: (f) => f.wristH, prom: 0.15, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['누운 자세', M(w, 'torsoTilt') > 60 && M(w, 'torsoTilt') < 120],
      ['팔을 위로 밀어올림', P(w, 'wristH', 90) > 0.3],
      ['팔꿈치를 굽혔다 폄', RS(w, 'elbowL', 'elbowR') > 30],
      ['엉덩이는 고정(브릿지 아님)', R(w, 'hip') < 25, true],
    ],
    form: (w) => [
      ['lockout', P(w, 'wristH', 90) < 0.35, '끝까지 밀기', '팔을 끝까지 펴서 밀어올리세요'],
    ],
  },
  {
    id: 'press', name: '숄더 프레스', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '정면에서 머리 위 손끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.18, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['상체를 세움', M(w, 'torsoTilt') < 35],
      ['머리 위로 밀어올림', P(w, 'wristH', 90) > 0.12],
      // 점핑잭(팔 편 채 엉덩이~머리 위)과 구분: 팔꿈치를 굽혔다 펴거나, 어깨 높이에서 밀어올림
      ['어깨 높이에서 밀어올림', RS(w, 'elbowL', 'elbowR') > 30 || P(w, 'wristH', 10) > -0.3],
      ['팔꿈치가 어깨 높이까지 내려옴(트라이셉 아님)', P(w, 'arm', 10) < 125, true],
      ['몸은 제자리(풀업 아님)', !(R(w, 'shY') > 0.1)],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 실측: 끝까지 밀면 손목이 어깨보다 0.42~0.44m 위
    form: (w) => [
      ['lockout', P(w, 'wristH', 90) < 0.3, '끝까지 밀기', '팔을 머리 위로 끝까지 뻗으세요'],
    ],
  },
  {
    id: 'lateral', name: '사이드 레터럴 레이즈', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면에서 양팔 끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.18, minDur: 0.5, maxDur: 8,
    check: (w, b) => [
      ['상체를 세움', M(w, 'torsoTilt') < 35],
      ['팔을 내린 상태에서 시작', P(w, 'wristH', 10) < -0.3],
      ['어깨 높이까지 들어올림', P(w, 'wristH', 90) > -0.3 && P(w, 'wristH', 90) < 0.2, true],
      ['팔을 옆으로 벌림(프론트 레이즈 아님)', M(b, 'wristDX') > 0.7, true],
      ['팔꿈치를 거의 폄', P(w, 'elbow', 10) > 110, true],
      ['다리는 고정', legsStill(w), true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 실측: 어깨 높이까지 올리면 손목이 어깨보다 0.08~0.11m 위, 양 손목 간격 1.05~1.11m
    form: (w) => [
      ['low', P(w, 'wristH', 90) < -0.15, '어깨 높이까지', '팔을 어깨 높이까지 들어올리세요'],
      ['high', P(w, 'wristH', 90) > 0.25, '너무 높아요', '어깨보다 높이 올리면 승모근이 개입해요'],
    ],
  },
  {
    id: 'frontraise', name: '프론트 레이즈', group: '가슴·어깨', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆이나 대각선에서 팔 전체가 보이게',
    // 실측: 위에서 양 손목 간격 0.05~0.47m (옆으로 벌리는 레터럴은 1m 이상)
    signal: (f) => -f.wristH, prom: 0.15, minDur: 0.5, maxDur: 8,
    check: (w, b) => [
      ['상체를 세움', M(w, 'torsoTilt') < 35],
      ['팔을 내린 상태에서 시작', P(w, 'wristH', 10) < -0.3],
      ['팔을 앞으로 듦', M(b, 'wristDX') < 0.7 && P(w, 'wristHMax', 90) > -0.3],
      ['상체 고정(케틀벨 스윙 아님)', R(w, 'torsoTilt') < 20],
      ['팔꿈치를 거의 폄', P(w, 'elbow', 10) > 110, true],
      ['다리는 고정', legsStill(w), true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
  },

  // ───────── 등 ─────────
  {
    id: 'pullup', name: '풀업·친업', group: '등', unit: '회', kind: 'reps', priority: 7, verified: true,
    tip: '정면에서 바와 발끝까지 보이게 (멀리 두세요)',
    // 매달린 자세에서 몸을 끌어올림 → 손목-어깨 거리가 줄고, 화면에서 어깨가 위로 올라간다
    // 실측: 매달림 손목 높이 0.46m → 당긴 끝 0.0~0.06m, 화면상 어깨 0.44 → 0.24
    signal: (f) => f.wristH, prom: 0.2, minDur: 0.6, maxDur: 8,
    check: (w, b) => [
      ['바에 매달림(팔이 머리 위)', P(w, 'wristH', 90) > 0.3],
      ['팔을 당김', RS(w, 'elbowL', 'elbowR') > 40],
      ['몸이 위로 올라감', P(w, 'shY', 90) - M(b, 'shY') > 0.08],
      ['상체를 세움', M(w, 'torsoTilt') < 40],
    ],
    form: (w) => [
      ['partial', P(w, 'wristH', 10) > 0.15, '더 높이', '턱이 바 위로 올라오도록 당기세요'],
    ],
  },
  {
    id: 'latpulldown', name: '랫풀다운', group: '등', unit: '회', kind: 'reps', priority: 4, verified: true,
    tip: '앞이나 대각선에서 팔 전체가 보이게',
    // 앉아서 바를 당김 → 풀업과 팔 모양은 같지만 몸은 제자리
    signal: (f) => f.wristH, prom: 0.2, minDur: 0.6, maxDur: 8,
    check: (w, b) => [
      ['팔을 위로 뻗은 자세에서 시작', P(w, 'wristH', 90) > 0.3],
      ['팔을 당김', RS(w, 'elbowL', 'elbowR') > 40],
      ['몸은 제자리(풀업 아님)', !(P(w, 'shY', 90) - M(b, 'shY') > 0.05)],
      ['상체를 세움', M(w, 'torsoTilt') < 40],
    ],
  },
  {
    id: 'row', name: '바벨·덤벨 로우', group: '등', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '옆에서 숙인 상체와 팔이 보이게',
    // 상체를 숙인 채 팔꿈치를 뒤로 당김
    signal: (f) => f.elbowMin, prom: 30, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['상체를 숙임', M(w, 'torsoTilt') > 35 && M(w, 'torsoTilt') < 85],
      ['상체 고정(데드리프트 아님)', R(w, 'torsoTilt') < 20],
      ['팔을 당김', P(w, 'elbowMin', 10) < 120],
      ['서서 하는 동작', P(w, 'hipH', 50) > 0.4],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
  },

  // ───────── 팔 ─────────
  {
    id: 'curl', name: '덤벨 컬', group: '팔', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면이나 대각선에서 팔 전체가 보이게',
    // 정면에서 보면 AI가 팔꿈치 굽힘을 실제보다 덜 굽힌 것(≈90°)으로 읽는다 → 실측 기준으로 설정
    signal: (f) => f.elbowMin, prom: 35, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['상체를 세움', M(w, 'torsoTilt') < 35],
      ['팔꿈치를 옆구리 가까이', P(w, 'arm', 90) < 70, true],
      ['손이 어깨보다 아래', P(w, 'wristHMax', 90) < 0.12, true],
      ['팔을 충분히 굽힘', P(w, 'elbowMin', 10) < 112],
      ['손목이 어깨 쪽으로 올라옴', R(w, 'wristHMax') > 0.25 && P(w, 'wristHMax', 90) > -0.2],
      ['몸은 제자리(딥스 아님)', !(R(w, 'shY') > 0.08), true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    // 실측: 팔을 내린 상태 팔꿈치각 138~155°, 몸통 흔들림(기울기 범위) 12~19°
    form: (w) => [
      ['partial', P(w, 'elbowMin', 90) < 125, '끝까지 펴기', '내릴 때 팔을 끝까지 펴 주세요'],
      ['swing', R(w, 'torsoTilt') > 28, '반동 줄이기', '몸을 흔들지 말고 팔만 움직이세요'],
    ],
  },
  {
    id: 'triext', name: '트라이셉 익스텐션', group: '팔', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '정면이나 옆에서 머리 위 팔까지 보이게',
    // 위팔은 머리 위에 고정, 아래팔만 머리 뒤로 내렸다 폄. 실측: 위팔 각도 141~172°로 유지
    signal: (f) => f.wristH, prom: 0.1, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['팔꿈치를 머리 위로 고정', P(w, 'arm', 10) > 120],
      ['상체를 세움', M(w, 'torsoTilt') < 35],
      ['손이 머리 뒤로 내려갔다 올라옴', R(w, 'wristH') > 0.1 && P(w, 'wristH', 90) > 0.3],
    ],
  },
  {
    id: 'dips', name: '딥스', group: '팔', unit: '회', kind: 'reps', priority: 4, verified: false,
    tip: '옆에서 팔과 몸통이 보이게',
    // 팔로 몸을 지탱한 채 팔꿈치를 굽혔다 폄 (평행봉·벤치·바닥)
    signal: (f) => f.elbowMin, prom: 30, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['팔로 몸을 지탱(손목이 어깨 아래)', P(w, 'shoulderOverWrist', 90) > 0.25],
      ['상체가 서 있거나 뒤로 기댐(푸시업 아님)', M(w, 'torsoTilt') < 60 && !faceDown(w)],
      ['팔을 굽혔다 폄', RS(w, 'elbowL', 'elbowR') > 30],
      // 실측: 바닥 딥스 어깨 오르내림 0.086·몸통 39°, 덤벨 컬은 0.01~0.06·7~13°
      ['몸이 팔 힘으로 오르내림(컬 아님)', R(w, 'shY') > 0.05 && (M(w, 'torsoTilt') > 20 || R(w, 'shY') > 0.09)],
    ],
  },

  // ───────── 코어 ─────────
  {
    id: 'situp', name: '윗몸일으키기·크런치', group: '코어', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '옆이나 대각선에서 머리~무릎이 보이게',
    // 누우면 몸통 기울기 ≈ 90°. 크런치는 70°대, 윗몸일으키기는 40~50°까지 내려온다
    signal: (f) => f.torsoTilt, prom: 10, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['바닥에 누운 자세', M(w, 'hipHAbs') < 0.35 && P(w, 'hipHAbs', 90) < 0.3],
      ['누운 상태에서 시작', P(w, 'torsoTilt', 90) > 75],
      ['어깨를 들어올림', P(w, 'torsoTilt', 10) < 85],
      ['엉덩이를 들지 않음(브릿지·힙 쓰러스트 아님)', P(w, 'torsoTilt', 90) < 102 && P(w, 'hip', 90) < 150],
    ],
  },
  {
    id: 'bridge', name: '힙 브릿지·힙 쓰러스트', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆에서 어깨~발까지 보이게',
    // 엉덩이를 들어 어깨-엉덩이-무릎을 일직선으로. 실측: 끝까지 올리면 엉덩이 각도 160~170°
    // 바닥 브릿지는 몸통 기울기 90→115°, 벤치에 등 기댄 힙 쓰러스트는 25→80°
    signal: (f) => -f.hip, prom: 15, minDur: 0.5, maxDur: 8,
    check: (w) => [
      ['누웠거나 등을 벤치에 기댐', M(w, 'hipH') < 0.55 && P(w, 'torsoTilt', 90) > 65],
      ['엉덩이를 폈다 접음', R(w, 'hip') > 25 && P(w, 'hip', 90) > 150],
      ['무릎을 세움', M(w, 'knee') < 130, true],
    ],
    form: (w) => [
      ['low', P(w, 'hip', 90) < 155, '엉덩이 더 높이', '어깨-엉덩이-무릎이 일직선이 될 때까지 올리세요'],
    ],
  },
  {
    id: 'legraise', name: '레그 레이즈', group: '코어', unit: '회', kind: 'reps', priority: 5, verified: true,
    tip: '옆에서 머리~발끝이 보이게',
    // 누워서 다리를 편 채 들어올림. 실측: 엉덩이 각도 170° → 72~80°, 무릎 160° 이상 유지
    signal: (f) => f.hip, prom: 40, minDur: 0.6, maxDur: 8,
    check: (w) => [
      ['누운 자세', M(w, 'torsoTilt') > 55],
      ['다리를 편 채 들어올림', P(w, 'knee', 10) > 130 && P(w, 'hip', 10) < 115],
      ['상체는 고정', R(w, 'torsoTilt') < 20],
    ],
  },
  {
    id: 'plank', name: '플랭크', group: '코어', unit: '초', kind: 'hold', priority: 4, verified: false,
    tip: '옆에서 머리~발끝이 한 화면에',
    // 매 프레임 자세 조건 (버티는 동작이라 반복 대신 시간을 잰다)
    pose: (f) => f.torsoTilt > 55 && f.torsoTilt < 120
      && f.hip > 140 && f.knee > 140
      && f.hipH < 0.5 && f.shoulderOverWrist > 0.12,
    // 최근 구간이 움직이지 않는지 (푸시업과 구분)
    still: (w) => R(w, 'shoulderOverWrist') < 0.06 && R(w, 'hipH') < 0.08,
    form: (w) => [
      ['sag', M(w, 'hipSag') > 0.08, '엉덩이 올리기', '허리가 처졌어요. 배에 힘을 주세요'],
      ['pike', M(w, 'hipSag') < -0.12, '엉덩이 내리기', '엉덩이가 너무 높아요. 몸을 일직선으로'],
    ],
  },

  // ───────── 유산소 ─────────
  {
    id: 'jumpingjack', name: '점핑잭', group: '유산소', unit: '회', kind: 'reps', priority: 7, verified: false,
    tip: '정면에서 손끝~발끝까지 보이게',
    signal: (f) => -f.wristH, prom: 0.3, minDur: 0.35, maxDur: 4,
    check: (w) => [
      ['서서 하는 동작', M(w, 'torsoTilt') < 35 && P(w, 'hipH', 90) > 0.5],
      ['팔을 머리 위로', P(w, 'wristH', 90) > 0.05],
      ['팔을 내림', P(w, 'wristH', 10) < -0.2],
      ['다리를 벌렸다 모음', R(w, 'ankleDX') > 0.14, true],
      ['운동 거리에 서 있음(하체 보임)', atDistance(w), true],
    ],
    form: (w) => [
      ['arms', P(w, 'wristH', 90) < 0.1, '팔 끝까지', '팔을 머리 위까지 올리세요'],
    ],
  },
  {
    id: 'climber', name: '마운틴 클라이머', group: '유산소', unit: '회', kind: 'reps', priority: 6, verified: true,
    tip: '옆에서 머리~발끝이 한 화면에',
    // 플랭크 자세에서 무릎을 번갈아 당김 — 한 다리 1회. 실측: 당긴 무릎 56~73°, 사이 100°대
    signal: (f) => f.kneeMin, prom: 25, minDur: 0.25, maxDur: 3,
    check: (w) => [
      ['엎드려 팔로 지탱', M(w, 'torsoTilt') > 60 && P(w, 'shoulderOverWrist', 10) > 0.3],
      ['무릎을 가슴 쪽으로 당김', P(w, 'kneeMin', 10) < 95],
      ['팔은 편 채 유지(푸시업 아님)', R(w, 'shoulderOverWrist') < 0.1],
    ],
  },
  {
    id: 'burpee', name: '버피', group: '유산소', unit: '회', kind: 'reps', priority: 7, verified: true,
    tip: '옆이나 정면에서 멀리 (엎드린 자세까지 보이게)',
    // 서기 → 엎드리기 → 서기(점프). 실측: 엉덩이 높이 0.75m ↔ 바닥 -0.1~0.2m
    signal: (f) => f.hipH, prom: 0.35, minDur: 1, maxDur: 12,
    check: (w, b, rep) => [
      ['서 있다가', rep.top > 0.55],
      ['바닥까지 엎드림', rep.bottom < 0.3 && P(w, 'torsoTilt', 90) > 60],
    ],
  },
  {
    id: 'kbswing', name: '케틀벨 스윙', group: '유산소', unit: '회', kind: 'reps', priority: 6, verified: false,
    tip: '옆에서 머리~발끝이 보이게',
    // 엉덩이를 접었다 펴며 팔을 가슴 높이까지 흔들어 올림
    signal: (f) => -f.torsoTilt, prom: 22, minDur: 0.5, maxDur: 4,
    check: (w) => [
      ['엉덩이를 접었다 폄', R(w, 'hip') > 35 && P(w, 'torsoTilt', 90) > 35],
      ['끝까지 일어섬', P(w, 'torsoTilt', 10) < 30],
      ['팔을 가슴 높이까지 흔들어 올림', P(w, 'wristH', 90) > -0.25],
      ['무릎은 조금만 굽힘(스쿼트 아님)', P(w, 'knee', 10) > 95],
    ],
  },
];

export const EXERCISE_BY_ID = Object.fromEntries(EXERCISES.map((e) => [e.id, e]));

/** 자세 교정 코드 → 설명 (기록 화면용) */
export function formInfo(exId, code) {
  const ex = EXERCISE_BY_ID[exId];
  if (!ex?.form) return null;
  const row = ex.form([], []).find((r) => r[0] === code);
  return row ? { code, cue: row[2], tip: row[3] } : null;
}
