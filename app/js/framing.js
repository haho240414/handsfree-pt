// 구도 안내는 카운트 기준을 바꾸지 않는다. 운동 중에도 별도로 표시하고 잠깐 가리는 프레임은 걸러낸다.
export function framingIssue(snap, { upperBody = false, bothArms = false } = {}) {
  const raw = snap.raw;
  if (!raw) return { code: 'missing', text: `몸이 안 보여요. ${upperBody ? '상체와 팔' : '전신'}이 화면에 들어오게 폰을 조정하고 조명을 밝혀 주세요`, speak: true };
  const s = raw.seen || {};
  if (raw.torsoFrac > (upperBody ? 0.62 : 0.42)) return { code: 'close', text: '너무 가까워요. 두세 걸음 뒤로 가 주세요', speak: true };
  if (raw.box && Math.max(raw.box.w, raw.box.h) < 0.35 && raw.torsoFrac < 0.1) {
    return { code: 'far', text: `몸이 너무 작게 보여요. ${upperBody ? '팔 전체가' : '전신이'} 잘리지 않게 조금 가까이 와 주세요`, speak: true };
  }
  if (upperBody && (!s.arms || (bothArms && !s.bothArms))) return { code: 'hands', text: `${bothArms ? '양팔' : '움직이는 팔'}의 어깨·팔꿈치·손목이 모두 보이게 폰을 조정해 주세요`, speak: true };
  if (!upperBody && !s.knees) return { code: 'knees', text: '무릎이 안 보여요. 뒤로 가거나 폰을 낮추고, 다리가 가려지지 않게 해 주세요', speak: true };
  if (!s.head) return { code: 'head', text: '머리가 안 보여요. 머리까지 화면에 들어오게 폰을 조정해 주세요', speak: true };
  if (upperBody ? raw.upperCutoff : raw.cutoff) return { code: 'edge', text: '몸 일부가 화면 밖이에요. 화면 가운데로 와 주세요', speak: false };
  if (!upperBody && !s.feet) return { code: 'feet', text: '발까지 보이면 하체 운동을 더 잘 세요', speak: false };
  if (!snap.present) return { code: 'unclear', text: '몸이 흐리거나 가려져 있어요. 조명을 밝히고 카메라 각도를 바꿔 주세요', speak: true };
  return null;
}

export class FramingGuide {
  constructor() { this.pending = null; this.since = null; this.shown = null; }
  update(issue, now) {
    if (issue?.code !== this.pending?.code || this.since == null) {
      this.pending = issue;
      this.since = now;
    }
    if (now - this.since >= (issue ? 800 : 500)) this.shown = issue;
    return this.shown;
  }
}
