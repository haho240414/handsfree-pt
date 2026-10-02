import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { strengthTruth, trackFixture } from '../strength-eval.mjs';
import { EXERCISE_BY_ID } from '../../app/js/engine/exercises.js';

test('새 근력 운동 8종: 관절이 보이는 원본 자료의 횟수를 직접 선택으로 센다', () => {
  for (const [clip,t] of Object.entries(strengthTruth)) {
    if(clip.startsWith('_') || t.split==='holdout' || t.limitedView) continue;
    const {reps}=trackFixture(clip,{fixed:t.exercise,minSetReps:t.minSetReps??2},t.range);
    assert.equal(reps,t.reps,clip);
  }
});
test('컨센트레이션 컬 별도 영상: 초기 동작 일부가 잘린 구간은 3회 중 최소 2회', () => {
  const t=strengthTruth.concentration_puregym;
  const {reps}=trackFixture('concentration_puregym',{fixed:t.exercise},t.range);
  assert.ok(reps>=t.reps-1 && reps<=t.reps,`${reps}/${t.reps}`);
});
test('발 쪽 벤치 영상에서 팔이 검출되지 않으면 추정 횟수를 만들지 않는다', () => {
  const {reps}=trackFixture('dbbench_strengthlog',{fixed:'dumbbellbench',minSetReps:1});
  assert.equal(reps,0);
});
test('저프레임 행잉 레그 레이즈: 확인한 손이 잠깐 잘려도 스쿼트로 바뀌지 않는다', () => {
  const {tr}=trackFixture('hanglegraise_cleanhealth',{},null,2);
  assert.deepEqual(tr.sets.map(s=>[s.exercise,s.reps]),[['hanglegraise',5]]);
});
test('저프레임 양팔 컬: 한쪽 팔의 최저점 시각이 밀려도 4회를 중복 집계하지 않는다', () => {
  const {reps}=trackFixture('curl_mccarthy',{fixed:'curl'},null,2);
  assert.equal(reps,4);
});
test('기존 실제 영상: 49개 횟수·3개 버티기 검증과 오인식 성적을 유지한다', () => {
  const truth=JSON.parse(fs.readFileSync(new URL('../truth.json',import.meta.url)));
  let n=0,exact=0,within1=0,wrongLabeled=0,wrongAll=0,holds=0;
  for(const [clip,t] of Object.entries(truth)) {
    if(clip.startsWith('_')) continue;
    const {tr}=trackFixture(clip);
    const wrong=tr.sets.some(s=>s.exercise!==t.exercise);
    if(wrong) wrongAll++;
    if(t.reps!=null) {
      n++;
      const reps=tr.sets.filter(s=>s.exercise===t.exercise).reduce((sum,s)=>sum+(s.reps||0),0);
      if(reps===t.reps) exact++;
      if(Math.abs(reps-t.reps)<=1) within1++;
      if(wrong) wrongLabeled++;
    } else if(t.hold!=null) {
      holds++;
      const holdTr=EXERCISE_BY_ID[t.exercise].auto===false ? trackFixture(clip,{fixed:t.exercise}).tr : tr;
      const sec=holdTr.sets.filter(s=>s.exercise===t.exercise).reduce((sum,s)=>sum+(s.holdSec||0),0);
      assert.ok(Math.abs(sec-t.hold)<=3,clip);
    }
  }
  assert.equal(n,49); assert.equal(holds,3);
  assert.ok(exact>=34,`정확 ${exact}/49`);
  assert.ok(within1>=44,`±1 ${within1}/49`);
  assert.equal(wrongLabeled,0);
  assert.ok(wrongAll<=3,`편집 영상 포함 오인식 ${wrongAll}`);
});
