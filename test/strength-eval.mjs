#!/usr/bin/env node
// 추가 근력 운동 자료는 기존 49개 평가와 분리한다. GIF는 실제 1주기만 사용한다.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { Tracker } from '../app/js/engine/tracker.js';

const ROOT = new URL('./', import.meta.url);
export const strengthTruth = JSON.parse(fs.readFileSync(new URL('strength-truth.json', ROOT)));
export const unpack = (points) => points?.map(([x,y,z,visibility]) => ({x,y,z,visibility})) ?? null;
export function trackFixture(name, opts = {}, range, frameStep = 1) {
  const fx = JSON.parse(fs.readFileSync(new URL(`fixtures/${name}.full.json`, ROOT)));
  const tr = new Tracker(opts);
  for (let i=0;i<fx.frames.length;i+=frameStep) {
    const f=fx.frames[i];
    if (range && (f.t < range[0] || f.t > range[1])) continue;
    tr.update(f.t, unpack(f.lm), unpack(f.wl));
  }
  tr.finish();
  return { fx, tr, reps: tr.sets.reduce((sum,s)=>sum+(s.reps||0),0) };
}
export function evaluateStrength() {
  return Object.entries(strengthTruth).filter(([n])=>!n.startsWith('_')).map(([clip,t])=>{
    const {fx,tr,reps}=trackFixture(clip,{fixed:t.exercise,minSetReps:t.minSetReps??2},t.range);
    return {clip,exercise:t.exercise,split:t.split,expected:t.reps,actual:reps,
      detected:fx.frames.filter(f=>f.lm).length,frames:fx.frames.length,
      wrong:tr.sets.filter(s=>s.exercise!==t.exercise).length,note:t.note||''};
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('직접 선택 · 앱과 같은 full 모델 · MediaPipe Python 0.10.21/CPU 좌표 추출');
  console.log('1회 GIF는 minSetReps=1로 평가한다. 앱의 기본 세트 기록 기준은 2회이다.');
  console.table(evaluateStrength());
  console.log('촬영 각도·시작 지점에 따른 실패도 포함했다. 이 표는 갤럭시 실기 정확도를 나타내지 않는다.');
}
