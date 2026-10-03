import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bodyweightTruth, evaluateBodyweight } from '../bodyweight-eval.mjs';
import { trackFixture, unpack } from '../strength-eval.mjs';
import { Tracker } from '../../app/js/engine/tracker.js';
import { EXERCISE_BY_ID } from '../../app/js/engine/exercises.js';
import { exerciseFraming, framingIssue } from '../../app/js/framing.js';

const patterns = ['birddog','deadbug','shouldertap','pikepushup'];
const clips = ['birddog_lyndhurst','deadbug_strengthlog','shouldertap_strengthlog','pikepushup_strengthlog'];
const fixture = (clip) => JSON.parse(fs.readFileSync(new URL(`../fixtures/${clip}.full.json`,import.meta.url)));
const total = (tr) => { tr.finish(); return tr.sets.reduce((n,s)=>n+(s.reps||0),0); };

test('맨몸 8종과 별도 데드 버그 영상: 15fps·7.5fps 모두 실제 반복 수를 센다', () => {
  for (const step of [1,2]) for (const row of evaluateBodyweight(step)) {
    assert.equal(row.actual,row.expected,`${row.clip}/${step}`);
    assert.equal(row.wrong,0,row.clip);
    assert.ok(row.issues.every(x=>Object.keys(x).length===0),`${row.clip} 정상 시범 오경고`);
  }
});

test('코어·파이크 새 패턴은 서로 혼동하지 않고 일반 푸시업·동키킥·컬을 세지 않는다', () => {
  for(let i=0;i<clips.length;i++) for(const ex of patterns.filter(x=>x!==patterns[i])) {
    assert.equal(trackFixture(clips[i],{fixed:ex,minSetReps:1}).reps,0,`${clips[i]}→${ex}`);
  }
  for(const clip of ['pushup_isolated_side','donkey_puregym','curl_mccarthy','legraise_livestrong']) for(const ex of patterns) {
    assert.equal(trackFixture(clip,{fixed:ex,minSetReps:1}).reps,0,`${clip}→${ex}`);
  }
});

test('여러 맨몸 운동을 골라도 두 번 반복한 동작을 올바른 선택 이름으로 기록한다', () => {
  for(const [clip,t] of Object.entries(bodyweightTruth)) {
    if(clip.startsWith('_') || t.split==='holdout') continue;
    const fx=fixture(clip),candidates=[t.exercise,...patterns.filter(id=>id!==t.exercise),'reverselunge','chairsquat'];
    const tr=new Tracker({candidates});
    // 실제 영상 정답 평가와 별개인 합성 연속성 검사: 같은 1주기를 두 번 이어 재생한다.
    for(let cycle=0;cycle<2;cycle++) for(const frame of fx.frames) {
      tr.update(cycle*fx.duration+frame.t,unpack(frame.lm),unpack(frame.wl));
    }
    assert.equal(total(tr),2*t.reps,clip);
    assert.ok(tr.sets.every(s=>s.exercise===t.exercise),`${clip} 다른 이름으로 기록됨`);
  }
});

test('새 패턴은 팔이 가리거나 무릎이 화면 밖이면 추정 반복을 만들지 않는다', () => {
  for(let n=0;n<clips.length;n++) for(const mask of ['arms','knees']) {
    const tr=new Tracker({fixed:patterns[n],minSetReps:1});
    for(const frame of fixture(clips[n]).frames) {
      const lm=unpack(frame.lm),wl=unpack(frame.wl);
      if(lm) for(const j of mask==='arms'?[13,14,15,16]:[25,26]) {
        if(mask==='arms') lm[j].visibility=0;
        else {lm[j].x=1.2;lm[j].visibility=1;}
      }
      tr.update(frame.t,lm,wl);
    }
    assert.equal(total(tr),0,`${clips[n]} / ${mask}`);
  }
});

test('새 패턴의 정지 자세에 작은 관절 잡음이 있어도 횟수를 만들지 않는다', () => {
  for(let n=0;n<clips.length;n++) {
    const base=fixture(clips[n]).frames.find((f,i)=>i>=10 && f.lm);
    const tr=new Tracker({fixed:patterns[n],minSetReps:1});
    let seed=4102; const random=()=>((seed=(1664525*seed+1013904223)>>>0)/4294967296-.5);
    for(let i=0;i<450;i++) {
      const lm=unpack(base.lm),wl=unpack(base.wl);
      for(const p of wl) for(const k of ['x','y','z']) p[k]+=random()*0.02;
      tr.update(i/15,lm,wl);
    }
    assert.equal(total(tr),0,clips[n]);
  }
});

test('교차 팔다리·푸시업의 준비 구도는 팔과 하체를 함께 확인한다', () => {
  const snap={present:true,raw:{torsoFrac:.2,box:{w:.6,h:.6},cutoff:false,
    seen:{head:true,arms:true,bothArms:true,knees:true,feet:true}}};
  for(const id of [...patterns,'pushup','kneepushup','inclinepushup']) {
    const opt=exerciseFraming(EXERCISE_BY_ID[id]);
    assert.equal(opt.upperBody,false,id);
    assert.equal(framingIssue(snap,opt),null,id);
    snap.raw.seen.knees=false;
    assert.equal(framingIssue(snap,opt).code,'knees',id);
    snap.raw.seen.knees=true;snap.raw.seen.arms=false;
    assert.equal(framingIssue(snap,opt).code,'hands',id);
    snap.raw.seen.arms=true;
  }
  snap.raw.seen.bothArms=false;
  assert.equal(framingIssue(snap,exerciseFraming(EXERCISE_BY_ID.deadbug)).code,'hands');
  assert.equal(exerciseFraming(EXERCISE_BY_ID.hammercurl).upperBody,true);
});

test('무릎 푸시업·의자 스쿼트에는 변형에 맞지 않는 자세 교정이 없다', () => {
  assert.deepEqual(EXERCISE_BY_ID.kneepushup.form([],[]).map(x=>x[0]),['shallow']);
  assert.ok(!EXERCISE_BY_ID.chairsquat.form([],[]).some(x=>x[0]==='shallow'));
  assert.equal(EXERCISE_BY_ID.pikepushup.form,undefined);
});

test('새 8종의 시범 좌표가 포함되고 교대 코어는 양쪽 동작을 보여준다', () => {
  const {demos}=JSON.parse(fs.readFileSync(new URL('../../app/data/demos.json',import.meta.url)));
  for(const [clip,t] of Object.entries(bodyweightTruth)) {
    if(clip.startsWith('_') || t.split==='holdout') continue;
    assert.ok(demos[t.exercise]?.f?.length>20,t.exercise);
    assert.equal(EXERCISE_BY_ID[t.exercise].auto,false);
  }
  assert.ok(demos.deadbug.f.length>=75,'데드 버그 양쪽 시범');
  assert.ok(demos.shouldertap.f.length>=55,'숄더 탭 양쪽 시범');
});
