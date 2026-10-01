import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.screen ??= { orientation: { angle: 0 } };
const { TiltSensor } = await import('../../app/js/tilt.js');
const { Tracker } = await import('../../app/js/engine/tracker.js');
const { rotatePoints } = await import('../../app/js/engine/features.js');

// 폰을 뒤로 deg 만큼 기대 세움(세로). 안드로이드 표준 = 위로 받치는 힘(+), iOS 일부 = 중력(−)
const leaning = (deg, sign = 1, angle = 0) => {
  screen.orientation.angle = angle;
  const t = new TiltSensor();
  const r = (deg * Math.PI) / 180;
  const g = [0, sign * 9.81 * Math.cos(r), sign * 9.81 * Math.sin(r)];
  // 가로 모드(90°) = 기기를 반시계로 돌림 → 기기 x 축이 위를 향한다
  t.g = angle === 90 ? [g[1], -g[0], g[2]] : g;
  return t;
};
const close = (a, b, tol = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < tol);

test('기울기 센서: 뒤로 20° 기댄 폰 → 카메라가 20° 올려다봄 (부호 규약·가로 모드 무관)', () => {
  const want = [0, -Math.cos(Math.PI / 9), Math.sin(Math.PI / 9)];
  assert.ok(close(leaning(20).cameraUp(), want));
  assert.ok(close(leaning(20, -1).cameraUp(), want), 'iOS 부호');
  assert.ok(close(leaning(20, 1, 90).cameraUp(), want), '가로 모드');
  assert.equal(Math.round(leaning(20).pitchDeg()), 20);
  assert.equal(Math.round(leaning(-15).pitchDeg()), -15);
  assert.equal(leaning(80).cameraUp(), null, '거의 눕힌 폰은 보정 안 함');
  screen.orientation.angle = 0;
});

test('기울기 보정: 센서 값을 넣으면 추적기가 그만큼 되돌린다', () => {
  const tr = new Tracker({});
  tr.setCameraUp(leaning(20).cameraUp());
  assert.equal(Math.round(tr.tiltDeg), 20);
  // 위쪽 벡터가 돌린 뒤 정확히 [0,-1,0] 이 된다
  const up = leaning(20).cameraUp();
  const [p] = rotatePoints([{ x: up[0], y: up[1], z: up[2], visibility: 1 }], tr.rot);
  assert.ok(close([p.x, p.y, p.z], [0, -1, 0]));
});
