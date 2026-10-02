// 준비·일시정지 시간은 운동 시간에서 제외한다. 세트 시각은 실제 시각으로 되돌린다.
export class SessionClock {
  start(now) { this.origin = now; this.pausedAt = null; this.gaps = []; }
  elapsed(now) {
    if (this.origin == null) return 0;
    return Math.max(0, ((this.pausedAt ?? now) - this.origin - this.gaps.reduce((n, g) => n + g.ms, 0)) / 1000);
  }
  pause(now) { if (this.pausedAt == null) this.pausedAt = now; }
  resume(now) {
    if (this.pausedAt == null) return 0;
    const ms = Math.max(0, now - this.pausedAt);
    this.gaps.push({ t: this.elapsed(now), ms });
    this.pausedAt = null;
    return ms;
  }
  wallOffset(t) { return t * 1000 + this.gaps.filter((g) => g.t <= t).reduce((n, g) => n + g.ms, 0); }
}
