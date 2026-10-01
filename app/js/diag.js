// 진단 기록: 운동 중 AI 가 본 관절 좌표(영상·사진은 저장하지 않음)를 폰 메모리에만 잠깐 모아 둔다.
// 인식이 이상했을 때 사용자가 '진단 기록 보내기'를 누르면 파일로 내보내고, 개발자는 tools/replay.mjs 로
// 그 운동을 그대로 재현해 고친다. 앱을 닫으면 사라지고, 어디로도 자동 전송하지 않는다.

const MAX_SEC = 20 * 60; // 최근 20분까지
const STEP = 1 / 15;     // 초당 15장으로 솎음 (시범 영상 분석과 같은 간격)
const CHUNK = 900;       // 1분 단위로 메모리를 잡는다
const VALS = 33 * 4 + 33 * 3; // 화면 좌표 x,y,z,가시성 + 3D 좌표 x,y,z
const Q = 10000;         // 소수 넷째 자리까지 (int16)

const q = (v) => Math.max(-32767, Math.min(32767, Math.round((Number.isFinite(v) ? v : 0) * Q)));

export class DiagRecorder {
  constructor() {
    this.meta = null;
    this.chunks = [];
    this.events = [];
  }

  start(meta) {
    this.meta = { ...meta, startedAt: new Date().toISOString() };
    this.chunks = [];
    this.events = [];
    this.lastT = -Infinity;
  }

  get seconds() {
    const a = this.chunks[0], b = this.chunks[this.chunks.length - 1];
    return a && b?.n ? b.t[b.n - 1] - a.t[0] : 0;
  }

  get hasData() { return !!this.meta && this.seconds > 3; }

  /** 매 프레임: 사람이 없으면 lm/wl = null */
  add(t, lm, wl) {
    if (!this.meta || t - this.lastT < STEP - 0.004) return;
    this.lastT = t;
    let c = this.chunks[this.chunks.length - 1];
    if (!c || c.n === CHUNK) {
      c = { t: new Float64Array(CHUNK), has: new Uint8Array(CHUNK), v: new Int16Array(CHUNK * VALS), n: 0 };
      this.chunks.push(c);
      while (this.chunks.length > 2 && this.chunks[1].t[0] < t - MAX_SEC) this.chunks.shift();
    }
    const i = c.n++;
    c.t[i] = t;
    if (!lm || !wl) return;
    c.has[i] = 1;
    let o = i * VALS;
    for (let k = 0; k < 33; k++) {
      const p = lm[k];
      c.v[o++] = q(p.x); c.v[o++] = q(p.y); c.v[o++] = q(p.z); c.v[o++] = q(p.visibility ?? 1);
    }
    for (let k = 0; k < 33; k++) {
      const p = wl[k];
      c.v[o++] = q(p.x); c.v[o++] = q(p.y); c.v[o++] = q(p.z);
    }
  }

  /** 기울기 변경·세트 시작/끝 같은 사건 (재현할 때 같은 시점에 다시 넣는다) */
  event(t, type, data) {
    if (!this.meta || this.events.length > 5000) return;
    this.events.push([Math.round(t * 1000) / 1000, type, data ?? null]);
  }

  /**
   * 파일로 만들기. 프레임 = [시각ms, ...정수 231개] (사람 없으면 [시각ms]), 정수/10000 = 원래 값.
   * 20분이면 수십 MB 라 한꺼번에 문자열로 만들지 않고 1분씩 이어 붙이며 바로 gzip 한다(폰 메모리 보호).
   * @returns {Promise<{name:string, bytes:Uint8Array, mime:string}>}
   */
  async exportFile({ note = '', sets = [], log = [], extra = {} } = {}) {
    const d = new Date(this.meta.startedAt);
    const p2 = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}`;
    const head = JSON.stringify({
      format: 'hfpt-diag-1', scale: Q, layout: 'lm33[x,y,z,vis] + wl33[x,y,z]',
      note, meta: { ...this.meta, ...extra }, events: this.events, sets, log,
    }).slice(0, -1) + ',"frames":[';
    const parts = [head];
    let first = true;
    const chunkText = (c) => {
      let out = '';
      for (let i = 0; i < c.n; i++) {
        const ms = Math.round(c.t[i] * 1000);
        out += (first ? '' : ',') + (c.has[i] ? `[${ms},${c.v.subarray(i * VALS, (i + 1) * VALS).join(',')}]` : `[${ms}]`);
        first = false;
      }
      return out;
    };
    const base = `handsfree-pt-diag-${stamp}.json`;
    if (typeof CompressionStream === 'undefined') {
      for (const c of this.chunks) parts.push(chunkText(c));
      parts.push(']}');
      return { name: base, bytes: new TextEncoder().encode(parts.join('')), mime: 'application/json' };
    }
    const cs = new CompressionStream('gzip');
    const w = cs.writable.getWriter();
    const out = new Response(cs.readable).arrayBuffer();
    const enc = new TextEncoder();
    await w.write(enc.encode(head));
    for (const c of this.chunks) {
      await w.write(enc.encode(chunkText(c)));
      await new Promise((r) => setTimeout(r, 0)); // 화면이 멈추지 않게
    }
    await w.write(enc.encode(']}'));
    await w.close();
    return { name: `${base}.gz`, bytes: new Uint8Array(await out), mime: 'application/gzip' };
  }
}
