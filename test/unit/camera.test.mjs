import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openCamera, widenCamera, cameraSummary, listCameras } from '../../app/js/camera.js';

function media(t, methods) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: methods } });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'navigator', previous); else delete globalThis.navigator; });
}
function stream(label = 'camera2 1, facing front', settings = {}, caps = {}) {
  const track = { label, stopped: false, stop() { this.stopped = true; },
    getSettings: () => settings, getCapabilities: () => caps, getConstraints: () => ({}) };
  return { track, getTracks: () => [track], getVideoTracks: () => [track] };
}

test('넓게 보기: 별도 전면 광각을 선택하고 기본 카메라를 먼저 닫는다', async (t) => {
  const normal = stream(), wide = stream('front wide');
  const calls = [];
  media(t, {
    enumerateDevices: async () => [
      { kind: 'videoinput', deviceId: 'rear-wide', label: 'rear ultra wide' },
      { kind: 'videoinput', deviceId: 'front-wide', label: 'front wide' },
    ],
    getUserMedia: async (request) => {
      calls.push(request);
      if (calls.length === 2) { assert.equal(normal.track.stopped, true); return wide; }
      return normal;
    },
  });
  assert.equal(await openCamera({ cameraWide: true }), wide);
  assert.equal(calls[1].video.deviceId.exact, 'front-wide');
  assert.equal(calls[1].video.aspectRatio.ideal, 4 / 3);
  assert.equal(calls[1].video.resizeMode, 'none');
  assert.equal(calls[1].audio, false);
});

test('광각이 후면에만 있으면 전면을 유지하고 직접 고른 카메라는 바꾸지 않는다', async (t) => {
  const current = stream(); let scans = 0;
  media(t, { getUserMedia: async () => current, enumerateDevices: async () => {
    scans++; return [{ kind: 'videoinput', deviceId: 'rear-wide', label: 'rear ultra wide' }];
  } });
  assert.equal(await openCamera({ cameraWide: true }), current);
  assert.equal(current.track.stopped, false);
  assert.equal(await openCamera({ cameraWide: true, cameraId: 'chosen' }), current);
  assert.equal(await openCamera({ cameraWide: false }), current);
  assert.equal(scans, 1);
});

test('별도 광각을 열 수 없으면 기본 전면을 다시 열어 복구한다', async (t) => {
  const current = stream(), restored = stream(); let calls = 0;
  media(t, { enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'wide', label: '전면 광각' }],
    getUserMedia: async ({ video }) => {
      calls++;
      if (video.deviceId) throw Object.assign(new Error(), { name: 'NotReadableError' });
      return calls === 1 ? current : restored;
    } });
  assert.equal(await openCamera({ cameraWide: true }), restored);
  assert.equal(current.track.stopped, true);
  assert.equal(calls, 3);
});

test('저장된 카메라가 사라지면 전면으로 복구하고 권한 오류는 그대로 전달한다', async (t) => {
  const current = stream(); const calls = [];
  media(t, { getUserMedia: async (request) => {
    calls.push(request);
    if (request.video.deviceId) throw Object.assign(new Error(), { name: 'OverconstrainedError' });
    return current;
  } });
  assert.equal(await openCamera({ cameraId: 'missing', cameraWide: true }), current);
  assert.equal(calls[1].video.facingMode, 'user');
  navigator.mediaDevices.getUserMedia = async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); };
  await assert.rejects(openCamera({ cameraId: 'missing', cameraWide: true }), { name: 'NotAllowedError' });
});

test('최소 줌 적용 후에도 화면 비율·해상도·기존 고급 설정을 유지한다', async () => {
  const settings = { width: 960, height: 1280, facingMode: 'user', zoom: 1 };
  const s = stream('front', settings, { zoom: { min: 0.8, max: 4 } });
  const constraints = { width: { ideal: 1280 }, height: { ideal: 960 }, aspectRatio: { ideal: 4 / 3 },
    resizeMode: 'none', frameRate: { ideal: 30 }, advanced: [{ focusMode: 'continuous' }] };
  s.track.getConstraints = () => constraints;
  s.track.applyConstraints = async (request) => {
    assert.deepEqual(request, { ...constraints, advanced: [{ focusMode: 'continuous' }, { zoom: 0.8 }] });
    settings.zoom = 0.8;
  };
  const info = await widenCamera(s, true);
  assert.equal(info.zoom, 0.8);
  assert.equal(cameraSummary(info), '전면 · 4:3 · 0.8배');
  assert.deepEqual(constraints.advanced, [{ focusMode: 'continuous' }]);
});

test('줌 설정을 거절하거나 무시하는 카메라에서 광각 성공을 표시하지 않는다', async () => {
  const s = stream('front', { width: 1280, height: 720, zoom: 1 }, { zoom: { min: 0.6, max: 4 } });
  s.track.applyConstraints = async () => { throw new Error('unsupported'); };
  assert.equal(cameraSummary(await widenCamera(s, true)), '전면 · 16:9 · 1배');
  s.track.applyConstraints = async () => {};
  assert.equal((await widenCamera(s, true)).zoom, 1);
  const noZoom = stream('front', { width: 1280, height: 960 });
  assert.equal(cameraSummary(await widenCamera(noZoom, true)), '전면 · 4:3');
});

test('카메라 목록 검사 중 예외가 나도 열린 카메라를 닫는다', async (t) => {
  const permission = stream(), probe = stream(); let calls = 0;
  probe.track.getCapabilities = () => { throw new Error('bad capabilities'); };
  media(t, { getUserMedia: async () => ++calls === 1 ? permission : probe,
    enumerateDevices: async () => [{ kind: 'videoinput', deviceId: 'front', label: 'front' }] });
  assert.equal((await listCameras()).length, 1);
  assert.equal(permission.track.stopped, true);
  assert.equal(probe.track.stopped, true);
});

test('후면 전환 요청을 존중하고 전면 광각으로 다시 바꾸지 않는다', async (t) => {
  const rear = stream('rear', {facingMode:'environment'});let request;
  media(t,{getUserMedia:async r=>{request=r;return rear;},enumerateDevices:async()=>{throw Error('후면 요청에는 전면 목록 검사 불필요');}});
  assert.equal(await openCamera({cameraWide:true,facingMode:'environment'}),rear);
  assert.equal(request.video.facingMode,'environment');
  assert.equal(request.video.resizeMode,'none');
});
