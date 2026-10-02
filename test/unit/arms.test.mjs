import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArmRepCounter } from '../../app/js/engine/counter.js';
import { computeFeatures } from '../../app/js/engine/features.js';
import { Tracker } from '../../app/js/engine/tracker.js';
import { EXERCISE_BY_ID, uniqueExerciseFamilies } from '../../app/js/engine/exercises.js';
import { standingPose, wave } from './synth.mjs';

function countSignals(values) {
  const c = new ArmRepCounter({ prom: 35, minDur: 0.5, maxDur: 8 });
  const reps = [];
  for (let i=0; i<=400; i++) {
    const t=i/20;
    for (const rep of c.update(t, values(t))) {
      if (c.isDuplicate(rep)) continue;
      c.accept(rep.amp, rep); reps.push(rep);
    }
  }
  return reps;
}
const phase = (t) => t >= 2 && t < 14 ? wave((t-2)/3) : 0;

test('양팔 동시 컬은 두 배로 세지 않고 4회로 합친다', () => {
  assert.equal(countSignals(t=>({L:160-90*phase(t),R:160-90*phase(t)})).length,4);
  assert.equal(countSignals(t=>({L:160-90*phase(t),R:160-90*phase(t-0.2)})).length,4);
});
test('반대쪽 팔을 굽힌 채 쉬어도 움직이는 팔의 4회를 센다', () => {
  const reps=countSignals(t=>({L:160-90*phase(t),R:65}));
  assert.equal(reps.length,4);
  assert.ok(reps.every(r=>r.side==='L'));
});

function curlPose(L, R) {
  const {lm,wl}=standingPose();
  for (const [sh,el,wr,deg] of [[11,13,15,L],[12,14,16,R]]) {
    const a=(180-deg)*Math.PI/180;
    wl[el]={...wl[sh],y:wl[sh].y+0.28};
    wl[wr]={...wl[el],y:wl[el].y+0.25*Math.cos(a),z:wl[el].z-0.25*Math.sin(a)};
    for (const i of [el,wr]) lm[i]={...lm[i],x:0.5+wl[i].x*0.25,y:0.55+(wl[i].y-0.45)*0.25,z:wl[i].z};
  }
  return {lm,wl};
}
function trackCurls(angles, mask=()=>{}) {
  const tr=new Tracker({fixed:'curl'});
  for (let i=0;i<=400;i++) {
    const t=i/20, {lm,wl}=curlPose(...angles(t));
    mask(t,lm);
    tr.update(t,lm,wl);
  }
  tr.finish();
  return tr.sets.reduce((sum,s)=>sum+s.reps,0);
}
test('실제 추적기: 쉬는 팔이 굽혀져 있어도 움직이는 컬 4회가 기록된다', () => {
  assert.equal(trackCurls(t=>[160-115*phase(t),40]),4);
  assert.equal(trackCurls(t=>[40,160-115*phase(t)]),4);
  assert.equal(trackCurls(t=>[160-115*phase(t),160-115*phase(t)]),4);
});
test('실제 추적기: 화면 밖으로 추정된 팔 동작은 컬로 기록하지 않는다', () => {
  assert.equal(trackCurls(t=>[160-115*phase(t),160-115*phase(t)],(_t,lm)=>{
    lm[15].y=1.2; lm[16].y=1.2;
  }),0);
});
test('슈러그 선택 중 가만히 서 있는 작은 좌표 떨림은 반복으로 세지 않는다', () => {
  const tr=new Tracker({fixed:'shrug'});
  for(let i=0;i<=400;i++) {
    const t=i/20, {lm,wl}=standingPose();
    for(const j of [11,12]) wl[j].y+=0.006*Math.sin(t*4);
    tr.update(t,lm,wl);
  }
  tr.finish();
  assert.equal(tr.sets.length,0);
});
test('번갈아 드는 팔은 한쪽마다 세고 옆모습에서 가린 팔은 무시한다', () => {
  assert.equal(countSignals(t=>({L:160-90*phase(t),R:160-90*phase(t-1.5)})).length,8);
  assert.equal(countSignals(t=>({L:NaN,R:160-90*phase(t)})).length,4);
});
test('길게 가린 팔의 이전 최저점을 복구 프레임과 연결해 세지 않는다', () => {
  const c = new ArmRepCounter({ prom:35,minDur:0.5,maxDur:8 });
  for (const [t,L] of [[0,160],[0.5,110],[1,65],[1.3,NaN],[2,NaN]]) c.update(t,{L,R:NaN});
  assert.deepEqual(c.update(2.1,{L:160,R:NaN}),[]);
  assert.equal(c.mode,'peak');
});
test('높은 신뢰도라도 화면 밖 손목·낮은 presence는 팔 각도로 쓰지 않는다', () => {
  const {lm,wl}=standingPose();
  lm[15]={...lm[15],y:1.2,visibility:1};
  lm[16]={...lm[16],presence:0.1,visibility:1};
  const f=computeFeatures(lm,wl);
  assert.ok(Number.isNaN(f.elbow));
  assert.ok(Number.isNaN(f.wristH));
  assert.ok(Number.isNaN(f.wristDist));
  assert.equal(f.seen.arms,false);
});
test('비슷한 운동 변형은 후보 중 하나만 유지하고 직접 선택 이름은 보존한다', () => {
  assert.deepEqual(uniqueExerciseFamilies(['hammercurl','curl','kickback','bad']),['hammercurl','kickback']);
  const tr=new Tracker({candidates:['hammercurl','curl']});
  assert.equal(tr.o.fixed,'hammercurl');
  assert.deepEqual(tr.specs.map(e=>e.id),['hammercurl']);
  for(const id of ['hammercurl','gobletsquat','dumbbellrdl','dumbbellbench']) assert.equal(EXERCISE_BY_ID[id].auto,false);
});
