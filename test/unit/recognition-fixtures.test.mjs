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
test('기존 실제 영상: 49개 횟수·13개 버티기(플랭크 9개 포함) 검증과 오인식 성적을 유지한다', () => {
  const truth=JSON.parse(fs.readFileSync(new URL('../truth.json',import.meta.url)));
  let n=0,exact=0,within1=0,wrongLabeled=0,wrongAll=0,holds=0;
  for(const [clip,t] of Object.entries(truth)) {
    // mode fixed = 운동을 골라서 할 때만 되는 화면(가까운 화면 스쿼트) → 아래 별도 시험
    if(clip.startsWith('_') || t.mode==='fixed') continue;
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
  assert.equal(n,49); assert.equal(holds,13);
  assert.ok(exact>=34,`정확 ${exact}/49`);
  assert.ok(within1>=44,`±1 ${within1}/49`);
  assert.equal(wrongLabeled,0);
  assert.ok(wrongAll<=3,`편집 영상 포함 오인식 ${wrongAll}`);
});
test('버티기 시간은 들어 올린 때부터 내려놓은 때까지(±1초): 플랭크 3개·사이드 플랭크 2개', () => {
  // 가만히 있는지 보는 1.2초도 버틴 시간이고, 무릎을 대거나 엉덩이를 바닥에 내리고 누운 시간은 아니다
  const truth=JSON.parse(fs.readFileSync(new URL('../truth.json',import.meta.url)));
  for(const clip of ['plank_crossfit','highplank_ranch','highplank_howto12','sideplank_nasm','sideplank_ccg']) {
    const t=truth[clip];
    const sec=trackFixture(clip).tr.sets.filter(s=>s.exercise===t.exercise).reduce((sum,s)=>sum+(s.holdSec||0),0);
    assert.ok(Math.abs(sec-t.hold)<=1,`${clip} ${sec}초/${t.hold}초`);
  }
});
test('가까운 화면(무릎 위로 자른 영상): 스쿼트 4개·런지 3개를 골라서 하면 모두 정확, 원본 영상과 같은 횟수', () => {
  const truth=JSON.parse(fs.readFileSync(new URL('../truth.json',import.meta.url)));
  const close=Object.entries(truth).filter(([,t])=>t.mode==='fixed');
  assert.equal(close.length,7);
  for(const [clip,t] of close) {
    const opts={fixed:t.exercise,minSetReps:1,holdMin:1,idleSec:600};
    assert.equal(trackFixture(clip,opts).reps,t.reps,clip);
    assert.equal(trackFixture(clip.replace(/_close$/,''),opts).reps,t.reps,`${clip} 원본`);
  }
});
