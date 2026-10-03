import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {popularTruth,evaluatePopular} from '../popular-eval.mjs';
import {trackFixture,unpack} from '../strength-eval.mjs';
import {Tracker} from '../../app/js/engine/tracker.js';
import {EXERCISE_BY_ID,uniqueExerciseFamilies} from '../../app/js/engine/exercises.js';
import {exerciseFraming,framingIssue} from '../../app/js/framing.js';
const dev=Object.entries(popularTruth).filter(([n,t])=>!n.startsWith('_') && t.split==='dev');
const fixture=n=>JSON.parse(fs.readFileSync(new URL(`../fixtures/${n}.full.json`,import.meta.url)));
const finish=tr=>{tr.finish();return tr.sets.reduce((n,s)=>n+(s.reps||0),0);};

test('추가 근력 10종: 15fps·7.5fps에서 관찰한 반복 수와 일치한다',()=>{
  for(const step of [1,2]) for(const row of evaluatePopular(step,'dev')) {
    assert.equal(row.actual,row.expected,`${row.clip}/${step}`);
    assert.equal(row.wrong,0,row.clip);
    assert.ok(row.issues.every(s=>Object.keys(s).length===0),`${row.clip} 정상 시범 오경고`);
  }
});

test('여러 운동을 고르고 두 주기를 이어도 한 팔·양팔을 중복하지 않고 올바른 이름으로 기록한다',()=>{
  for(const [clip,t] of dev) {
    const fx=fixture(clip),frames=fx.frames.filter(f=>!t.range || f.t>=t.range[0] && f.t<=t.range[1]);
    const start=frames[0].t,duration=frames.at(-1).t-start+1/fx.fps;
    const candidates=uniqueExerciseFamilies([t.exercise,...dev.map(([,v])=>v.exercise),'press','curl','frontraise','seatedrow','legext','squat']);
    const tr=new Tracker({candidates});
    for(let cycle=0;cycle<2;cycle++) for(const fr of frames)
      tr.update(cycle*duration+fr.t-start,unpack(fr.lm),unpack(fr.wl));
    assert.equal(finish(tr),2*t.reps,clip);
    assert.ok(tr.sets.every(s=>s.exercise===t.exercise),clip);
  }
});

test('기구 새 패턴은 서로 혼동하지 않고 숄더 프레스·컬·서서 하는 하체 운동을 세지 않는다',()=>{
  const examples={seatedlegcurl:'seatedlegcurl_strengthlog',facepull:'facepull_strengthlog',hipabduction:'hipabduction_strengthlog',chestpress:'chestpress_puregym'};
  for(const [id,clip] of Object.entries(examples)) for(const other of Object.keys(examples).filter(s=>s!==id)) {
    assert.equal(trackFixture(clip,{fixed:other,minSetReps:1},id==='chestpress'?[32,37.6]:undefined).reps,0,`${id}→${other}`);
  }
  for(const clip of ['chestpress_strengthlog','press_livelean','curl_mccarthy','squat_side_nicke','deadlift_glossop_side'])
    for(const id of Object.keys(examples)) assert.equal(trackFixture(clip,{fixed:id,minSetReps:1}).reps,0,`${clip}→${id}`);
});

test('팔·무릎·발목이 관찰되지 않으면 새 운동의 추정 반복을 만들지 않는다',()=>{
  for(const [clip,t] of dev) {
    const ids=['hipthrust','seatedlegcurl','hipabduction'].includes(t.exercise)?[25,26]:[13,14,15,16];
    for(const mode of ['occluded','outside']) {
      const tr=new Tracker({fixed:t.exercise,minSetReps:1});
      for(const fr of fixture(clip).frames) {
        if(t.range && (fr.t<t.range[0] || fr.t>t.range[1]))continue;
        const lm=unpack(fr.lm),wl=unpack(fr.wl);
        if(lm) for(const i of ids) {if(mode==='occluded')lm[i].visibility=0;else {lm[i].y=1.3;lm[i].visibility=1;}}
        tr.update(fr.t,lm,wl);
      }
      assert.equal(finish(tr),0,`${clip}/${mode}`);
    }
  }
  const tr=new Tracker({fixed:'seatedlegcurl',minSetReps:1});
  for(const fr of fixture('seatedlegcurl_strengthlog').frames) {
    const lm=unpack(fr.lm);if(lm)for(const i of [27,28])lm[i].y=1.3;
    tr.update(fr.t,lm,unpack(fr.wl));
  }
  assert.equal(finish(tr),0,'화면 밖 발목');
});

test('새 기구 운동의 정지 자세에 ±1cm 잡음이 있어도 반복을 만들지 않는다',()=>{
  for(const [clip,t] of dev) {
    const base=fixture(clip).frames.find(f=>f.lm && (!t.range || f.t>=t.range[0]));
    const tr=new Tracker({fixed:t.exercise,minSetReps:1});
    let seed=23;const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296-.5);
    for(let i=0;i<450;i++) {
      const lm=unpack(base.lm),wl=unpack(base.wl);
      for(const p of wl)for(const k of ['x','y','z'])p[k]+=random()*.02;
      tr.update(i/15,lm,wl);
    }
    assert.equal(finish(tr),0,clip);
  }
});

test('직접 선택한 변형 이름을 유지하고 포즈로 구별 못 하는 같은 계열은 동시에 추측하지 않는다',()=>{
  for(const pair of [['barbellcurl','curl'],['onearmrow','row'],['inclinedbpress','bench'],['cablelateral','lateral'],['ropepushdown','pushdown'],['hipthrust','bridge'],['seatedlegcurl','legext'],['chestpress','seatedrow']])
    assert.deepEqual(uniqueExerciseFamilies(pair),[pair[0]],pair.join('/'));
  const demos=JSON.parse(fs.readFileSync(new URL('../../app/data/demos.json',import.meta.url))).demos;
  for(const [,t] of dev){assert.equal(EXERCISE_BY_ID[t.exercise].auto,false);assert.equal(EXERCISE_BY_ID[t.exercise].verified,false);assert.ok(demos[t.exercise]?.f?.length>20,t.exercise);}
});

test('별도 밴드 페이스 풀은 1회이며 미지원 한 다리 레그 컬의 누락 결과를 분리해 남긴다',()=>{
  for(const step of [1,2]) {
    const rows=evaluatePopular(step,'holdout');
    assert.equal(rows.find(r=>r.exercise==='facepull').actual,1);
    assert.equal(rows.find(r=>r.exercise==='seatedlegcurl').actual,0,'한 다리 변형의 확인된 한계');
  }
});

test('케이블 레터럴은 앞으로 드는 동작을 옆으로 드는 횟수로 세지 않는다',()=>{
  assert.equal(trackFixture('frontraise_puregym',{fixed:'cablelateral',minSetReps:1}).reps,0);
});

test('머신 준비 화면은 필요한 무릎·발목 구도를 안내하고 상체 운동은 하체 가림으로 막지 않는다',()=>{
  const snap={present:true,raw:{torsoFrac:.2,box:{w:.6,h:.6},seen:{head:true,arms:true,knees:true,bothKnees:true,feet:true}}};
  assert.equal(framingIssue(snap,exerciseFraming(EXERCISE_BY_ID.hipabduction)),null);
  snap.raw.seen.bothKnees=false;
  assert.equal(framingIssue(snap,exerciseFraming(EXERCISE_BY_ID.hipabduction)).code,'knees');
  snap.raw.seen.feet=false;
  assert.equal(framingIssue(snap,exerciseFraming(EXERCISE_BY_ID.seatedlegcurl)).code,'ankles');
  assert.equal(framingIssue(snap,exerciseFraming(EXERCISE_BY_ID.chestpress)),null);
});
