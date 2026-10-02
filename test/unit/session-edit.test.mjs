import test from 'node:test';
import assert from 'node:assert/strict';
import { editRecordedSet, postureFeedback, assessment } from '../../app/js/session-edit.js';
import { SessionClock } from '../../app/js/session-clock.js';

const set = () => ({exercise:'squat',kind:'reps',reps:12,good:12,issues:{}});
test('12회를 13회로 고쳐도 자세 지적은 생기지 않는다',()=>{
  const s=set();editRecordedSet(s,{value:13});assert.equal(s.reps,13);
  assert.deepEqual(postureFeedback(s),{analyzed:12,bad:0,issues:{}});
  assert.equal(s.orig.reps,12);assert.equal(s.edited,true);
});
test('여러 번 수정·되돌리기를 해도 원래 자세 분석을 유지한다',()=>{
  const s={...set(),good:10,issues:{shallow:2}};
  editRecordedSet(s,{value:5});editRecordedSet(s,{value:20});editRecordedSet(s,{value:12});
  assert.equal(postureFeedback(s).bad,2);assert.equal(s.good,10);assert.equal(s.orig.reps,12);
});
test('운동을 바꾸면 이전 운동의 자세 평가를 붙이지 않는다',()=>{
  const s=set();editRecordedSet(s,{exercise:'lunge',value:12});assert.equal(postureFeedback(s),null);
  editRecordedSet(s,{exercise:'squat',value:12});assert.equal(postureFeedback(s).bad,0);
});
test('버티기·직접 추가·옛 수정 기록에 자세 평가를 만들어 넣지 않는다',()=>{
  const s={exercise:'plank',kind:'hold',holdSec:30,good:null};editRecordedSet(s,{value:45});
  assert.equal(s.holdSec,45);assert.equal(postureFeedback(s),null);
  assert.equal(postureFeedback({...set(),good:null,added:true}),null);
  const old={...set(),reps:5,good:5,orig:{exercise:'squat',kind:'reps',reps:12}};
  assert.equal(assessment(old).good,null);
});
test('잘못된 숫자는 기록을 바꾸지 않는다',()=>{
  const s=set();for(const value of [NaN,Infinity,-1])assert.throws(()=>editRecordedSet(s,{value}));
  assert.equal(s.reps,12);assert.equal(s.edited,undefined);
});
test('준비와 두 번의 일시정지를 운동 시간에서 제외하고 실제 기록 시각을 복구한다',()=>{
  const c=new SessionClock();assert.equal(c.elapsed(3000),0);c.start(5000);
  c.pause(10000);assert.equal(c.elapsed(100000),5);assert.equal(c.resume(40000),30000);
  assert.equal(c.elapsed(43000),8);c.pause(45000);c.resume(65000);
  assert.equal(c.elapsed(70000),15);assert.equal(c.wallOffset(3),3000);assert.equal(c.wallOffset(8),38000);assert.equal(c.wallOffset(15),65000);
});
test('중복 일시정지와 재개가 시간을 이중 차감하지 않는다',()=>{
  const c=new SessionClock();c.start(0);c.pause(1000);c.pause(3000);c.resume(5000);c.resume(6000);
  assert.equal(c.elapsed(6000),2);assert.equal(c.gaps.length,1);
});
