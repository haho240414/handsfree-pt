import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window ??= globalThis;
const { Voice, clipTexts, nativeKorean, rateOf } = await import('../../app/js/voice.js');

/** 앱 안 음성 플러그인 흉내: 미리 만든 말(clips)만 play 가 성공한다 */
function fakeNative(clips = []) {
  const calls = [];
  const have = new Set(clips);
  return {
    calls,
    configure: async (o) => { calls.push(['configure', o]); return {}; },
    prepare: async (o) => { calls.push(['prepare', o.texts.length]); return { ready: o.texts.length }; },
    play: async (o) => { calls.push(['play', o.text, o.then || '']); return { played: have.has(o.text) }; },
    speak: async (o) => { calls.push(['speak', o.text, o.flush]); },
    stop: async () => { calls.push(['stop']); },
    status: async () => ({ korean: true, voices: [{ name: 'ko-kr-x-ism-local', local: true, quality: 400 }] }),
  };
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('음성: 미리 만들 말 — 횟수 1~99(읽기 방식대로)와 자주 하는 짧은 말', () => {
  const t = clipTexts('native');
  assert.equal(t[0], '하나');
  assert.equal(t[11], nativeKorean(12));
  assert.ok(t.includes('셋, 둘, 하나') && t.includes('시작!'));
  assert.equal(clipTexts('number')[11], '12');
  assert.equal(new Set(t).size, t.length);
});

test('음성: 횟수는 미리 만든 소리로, 자세 지적은 그 뒤에 이어서', async () => {
  const nv = fakeNative(['여섯']);
  const v = new Voice({ native: nv, tts: null });
  v.count(6, '더 깊게');
  await tick(); await tick();
  assert.deepEqual(nv.calls, [['play', '여섯', '더 깊게']]);
});

test('음성: 미리 만든 소리가 아직 없으면 TTS 로 한 번에 말한다', async () => {
  const nv = fakeNative([]);
  const v = new Voice({ native: nv, tts: null });
  v.count(7, '더 깊게');
  await tick(); await tick();
  assert.deepEqual(nv.calls.at(-1), ['speak', '일곱. 더 깊게', true]);
});

test('음성: 끊지 않는 안내는 미리 만든 소리를 찾지 않고 순서대로 말한다', async () => {
  const nv = fakeNative(['시작!']);
  const v = new Voice({ native: nv, tts: null });
  v.say('스쿼트 12회 3세트');
  await tick();
  assert.deepEqual(nv.calls, [['speak', '스쿼트 12회 3세트', false]]);
});

test('음성: 설정 반영 — 빠르기·목소리를 넘기고, 같은 설정이면 다시 만들지 않는다', async () => {
  const nv = fakeNative();
  const v = new Voice({ native: nv, tts: null });
  const st = { voiceRate: 'fast', voiceName: 'ko-kr-x-ism-local', voiceDuck: false, countStyle: 'native' };
  await v.configure(st);
  await v.preparing;
  await v.configure(st);
  assert.deepEqual(nv.calls.filter((c) => c[0] === 'configure').map((c) => c[1]),
    [{ voice: 'ko-kr-x-ism-local', rate: rateOf('fast'), duck: false }, { voice: 'ko-kr-x-ism-local', rate: rateOf('fast'), duck: false }]);
  assert.equal(nv.calls.filter((c) => c[0] === 'prepare').length, 1);
  await v.configure({ ...st, voiceRate: 'slow' });
  assert.equal(nv.calls.filter((c) => c[0] === 'prepare').length, 2);
});

test('음성: 앱을 켤 때는 미리 만들기를 늦추고, 그 전에 운동을 시작하면 바로 만든다', async () => {
  const nv = fakeNative();
  const v = new Voice({ native: nv, tts: null });
  await v.configure({}, { delay: 60000 });
  assert.equal(nv.calls.filter((c) => c[0] === 'prepare').length, 0, '아직 안 만듦');
  await v.configure({});
  assert.equal(nv.calls.filter((c) => c[0] === 'prepare').length, 1, '운동 시작 → 바로');
  const r = await v.preparing;
  assert.equal(r.ready, 107);
});

test('음성: 꺼져 있으면 아무 말도 안 한다', async () => {
  const nv = fakeNative(['하나']);
  const v = new Voice({ native: nv, tts: null });
  v.enabled = false;
  v.count(1);
  v.say('시작!', { interrupt: true });
  await tick();
  assert.deepEqual(nv.calls, []);
});
