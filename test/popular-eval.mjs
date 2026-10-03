#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trackFixture } from './strength-eval.mjs';
export const popularTruth = JSON.parse(fs.readFileSync(new URL('popular-truth.json',import.meta.url)));
export function evaluatePopular(frameStep=1,split) {
  return Object.entries(popularTruth).filter(([n,t])=>!n.startsWith('_') && (!split || t.split===split)).map(([clip,t])=>{
    const {tr,reps}=trackFixture(clip,{fixed:t.exercise,minSetReps:t.minSetReps??2},t.range,frameStep);
    return {clip,exercise:t.exercise,split:t.split,expected:t.reps,actual:reps,
      wrong:tr.sets.filter(s=>s.exercise!==t.exercise).length,issues:tr.sets.map(s=>s.issues)};
  });
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  console.log('직접 선택 · 동일 full 모델 · Python/CPU · GIF 실제 1주기 · 한 반복 자료는 minSetReps=1');
  console.table(evaluatePopular(process.argv.includes('--half')?2:1));
}
