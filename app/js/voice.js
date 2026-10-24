// 음성 안내: 횟수는 '하나, 둘, 셋'(고유어)으로, 빠른 반복은 삐 소리로 대신한다.
// 안드로이드 앱: 앱 안의 음성 플러그인(VoicePlugin.kt) — 말할 때 음악 소리를 잠깐 줄이고, 숫자·자주 하는 말은
// 미리 파일로 만들어 두었다가 바로 튼다(매번 문장을 만드는 지연이 없음). 그 플러그인이 없으면 공개 TTS 플러그인.
// 웹: 브라우저 음성(speechSynthesis).

import { NativeTTS, NativeVoice } from './native.js';

const ONES = ['', '하나', '둘', '셋', '넷', '다섯', '여섯', '일곱', '여덟', '아홉'];
const TENS = ['', '열', '스물', '서른', '마흔', '쉰', '예순', '일흔', '여든', '아흔'];

/** 1~99 → 고유어 (하나, 둘 … 아흔아홉). 그 밖은 숫자 그대로 */
export function nativeKorean(n) {
  if (!Number.isInteger(n) || n <= 0 || n >= 100) return String(n);
  return TENS[Math.floor(n / 10)] + ONES[n % 10];
}

/** 말 빠르기 (안드로이드 TTS·브라우저 음성 모두 1 = 보통 사람 말 빠르기) */
export const RATES = { slow: 0.9, normal: 1.05, fast: 1.25 };
export const rateOf = (k) => RATES[k] ?? RATES.normal;

/** 운동 중에 끊고 바로 말하는(interrupt) 짧은 말 — 미리 만들어 두면 바로 나온다 */
const COMMON = [
  '셋, 둘, 하나', '시작!', '시작하세요.', '이어서 시작하세요.', '다음 세트를 시작하세요.',
  '휴식 끝! 시작하세요.', '휴식 끝! 다음 세트를 시작하세요.', '다시 버텨요',
];
/** 미리 만들어 둘 말: 횟수 1~99(고르는 읽기 방식대로) + 자주 하는 말 */
export function clipTexts(style = 'native') {
  const out = [];
  for (let n = 1; n < 100; n++) out.push(style === 'native' ? nativeKorean(n) : String(n));
  return [...out, ...COMMON];
}

/** 폰 목소리 이름 → 보여줄 이름 ("목소리 2 · 기기 안 · 고음질") */
export function voiceLabel(v, i) {
  const where = v.local === false ? '인터넷 필요' : '기기 안';
  const hq = v.quality >= 400 ? ' · 고음질' : '';
  // 안드로이드 이름(ko-kr-x-ism-local 같은)은 알아보기 어려워 번호로, 브라우저 이름(유나·Eddy)은 그대로
  const code = /^[a-z]{2,3}[-_][a-z]{2}[-_]|[#_]/i.test(v.name || '');
  const name = code || !v.name ? `목소리 ${i + 1}` : v.name.replace(/\s*\(.*\)\s*$/, '');
  return `${name} · ${where}${hq}`;
}

export class Voice {
  /** @param {{native?:object|null, tts?:object|null}} [o] 시험용으로 플러그인을 바꿔 끼울 수 있다 */
  constructor({ native = NativeVoice, tts = NativeTTS } = {}) {
    this.nv = native;
    this.tts = tts;
    this.enabled = true;
    this.style = 'native';
    this.rate = RATES.normal;
    this.voiceName = '';
    this.ctx = null;
    this.ko = null;
    this.lastCountAt = 0;
    this.prepared = null; // 미리 만든 목소리·빠르기·읽기 방식
    if (!this.nv && !this.tts && 'speechSynthesis' in window) {
      const pick = () => {
        const vs = speechSynthesis.getVoices();
        this.ko = (this.voiceName && vs.find((v) => v.name === this.voiceName))
          || vs.find((v) => v.lang === 'ko-KR' && /yuna|유나|google/i.test(v.name))
          || vs.find((v) => v.lang?.startsWith('ko')) || null;
      };
      this._pickWeb = pick;
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  /**
   * 설정을 반영한다: { voiceName, voiceRate, voiceDuck, countStyle }.
   * 안드로이드 앱은 그 목소리·빠르기로 숫자·자주 하는 말을 미리 만들어 둔다(한 번 만들면 다음 실행부터 바로 불러옴).
   */
  async configure(st = {}) {
    // 미리 만들기는 몇 초 걸려서 기다리지 않는다(끝나면 this.preparing 이 결과로 풀림). 만들어진 것부터 바로 쓴다
    this.style = st.countStyle || 'native';
    this.rate = rateOf(st.voiceRate);
    this.voiceName = st.voiceName || '';
    if (this._pickWeb) this._pickWeb();
    if (!this.nv) return null;
    try {
      await this.nv.configure({ voice: this.voiceName, rate: this.rate, duck: st.voiceDuck !== false });
      const key = `${this.voiceName}|${this.rate}|${this.style}`;
      if (this.prepared === key) return null;
      this.prepared = key;
      this.preparing = this.nv.prepare({ texts: clipTexts(this.style) })
        .catch((e) => { this.prepared = null; return { error: String(e?.message || e) }; });
      return null;
    } catch (e) {
      this.prepared = null;
      return { error: String(e?.message || e) };
    }
  }

  /** 고를 수 있는 한국어 목소리 [{name, local, quality}] */
  async voices() {
    if (this.nv) {
      try { return (await this.nv.status()).voices || []; } catch { return []; }
    }
    if (this.tts || !('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => v.lang?.startsWith('ko')).map((v) => ({ name: v.name, local: v.localService }));
  }

  /** 반드시 사용자 탭 안에서 호출 (iOS 소리 잠금 해제) */
  unlock() {
    try {
      this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
      this.ctx.resume?.();
    } catch { /* 소리 없이 진행 */ }
    if (!this.nv && !this.tts && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    }
  }

  /** 안드로이드: 폰 TTS 에 한국어 음성이 있는지 (없으면 설정에서 설치 안내) */
  async koreanAvailable() {
    const timeout = (p, v) => Promise.race([p, new Promise((r) => setTimeout(() => r(v), 3000))]);
    if (this.nv) {
      // 음성 엔진이 없거나 준비 안 된 폰에선 응답이 안 올 수 있어 3초 제한
      try { return !!(await timeout(this.nv.status(), {})).korean; } catch { return false; }
    }
    if (!this.tts) return 'speechSynthesis' in window;
    try {
      return !!(await timeout(this.tts.isLanguageSupported({ lang: 'ko-KR' }), { supported: false })).supported;
    } catch {
      return false;
    }
  }

  /**
   * 말하기. interrupt = 말하던 것을 끊고 바로(횟수·카운트다운). 끊고 말하는 짧은 말은 미리 만든 소리가 있으면 그걸 튼다.
   * then = 이어서 할 말(미리 만든 소리 뒤에 TTS 로 — "여섯" 다음 "더 깊게")
   */
  say(text, { interrupt = false, then = '' } = {}) {
    if (!this.enabled || !text) return;
    const whole = then ? `${text}. ${then}` : text;
    if (this.nv) {
      const speak = () => this.nv.speak({ text: whole, flush: interrupt }).catch(() => this._fallback(whole, interrupt));
      if (!interrupt) { speak(); return; }
      this.nv.play({ text, flush: true, then }).then((r) => { if (!r?.played) speak(); }).catch(speak);
      return;
    }
    this._fallback(whole, interrupt);
  }

  _fallback(text, interrupt) {
    if (this.tts) {
      // Flush(0) = 말하던 것을 끊고 바로, Add(1) = 앞 말이 끝난 뒤
      this.tts.speak({ text, lang: 'ko-KR', rate: this.rate, pitch: 1.0, volume: 1.0, queueStrategy: interrupt ? 0 : 1 })
        .catch(() => {});
      return;
    }
    if (!('speechSynthesis' in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'ko-KR';
    if (this.ko) u.voice = this.ko;
    u.rate = this.rate;
    u.pitch = 1.0;
    speechSynthesis.speak(u);
  }

  /**
   * 횟수 읽기. 점핑잭·하이니처럼 빠른 운동(최근 반복 간격 중앙값 1초 미만)은 숫자를 다 말하면 소리가 밀리고 끊긴다
   * → 매회 짧은 삐 소리, 5의 배수와 꼭 해야 할 말(자세 지적·남은 횟수)만 말로.
   */
  count(n, extra = '') {
    const now = performance.now();
    if (n <= 1 || now - this.lastCountAt > 4000) this.gaps = [];
    else this.gaps = [...(this.gaps || []), now - this.lastCountAt].slice(-3);
    this.lastCountAt = now;
    const g = [...(this.gaps || [])].sort((a, b) => a - b);
    const fast = g.length >= 2 && g[g.length >> 1] < 1000;
    const word = this.style === 'native' ? nativeKorean(n) : String(n);
    if (fast && !extra && n % 5 !== 0) {
      this.beep(n % 5 === 4 ? 990 : 880, 0.06);
      return;
    }
    this.say(word, { interrupt: true, then: extra });
  }

  beep(freq = 880, dur = 0.08, gain = 0.25) {
    if (!this.enabled || !this.ctx) return;
    try {
      const t = this.ctx.currentTime;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = freq;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t);
      o.stop(t + dur + 0.02);
    } catch { /* 무시 */ }
  }

  stop() {
    if (this.nv) this.nv.stop().catch(() => {});
    else if (this.tts) this.tts.stop().catch(() => {});
    else if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
}
