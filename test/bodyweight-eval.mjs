#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackFixture } from './strength-eval.mjs';

export const bodyweightTruth = JSON.parse(fs.readFileSync(new URL('bodyweight-truth.json', import.meta.url)));
export function evaluateBodyweight(frameStep = 1, split) {
  return Object.entries(bodyweightTruth).filter(([n,t]) => !n.startsWith('_') && (!split || t.split === split)).map(([clip,t]) => {
    const {fx,tr,reps} = trackFixture(clip,{fixed:t.exercise,minSetReps:t.minSetReps??2},t.range,frameStep);
    return {clip,exercise:t.exercise,split:t.split,expected:t.reps,actual:reps,
      detected:fx.frames.filter(f=>f.lm).length,frames:fx.frames.length,
      wrong:tr.sets.filter(s=>s.exercise!==t.exercise).length,
      issues:tr.sets.map(s=>s.issues),note:t.note||''};
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('직접 선택 · full 모델 · Python/CPU · GIF는 실제 1주기 · 1회 자료만 minSetReps=1');
  console.table(evaluateBodyweight(1,process.argv.includes('--dev')?'dev':undefined));
}
