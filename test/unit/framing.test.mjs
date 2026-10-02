import { test } from 'node:test';
import assert from 'node:assert/strict';
import { framingIssue, FramingGuide } from '../../app/js/framing.js';
import { computeFeatures } from '../../app/js/engine/features.js';
import { standingPose } from './synth.mjs';

const good = () => ({ present: true, raw: { torsoFrac: 0.2, box: { w: 0.3, h: 0.75 },
  seen: { head: true, knees: true, feet: true }, cutoff: false } });

test('인식 없음·몸이 작음·관절 가림을 구분하며 잘 보이면 안내를 지운다', () => {
  assert.equal(framingIssue({ raw: null }).code, 'missing');
  assert.equal(framingIssue(good()), null);
  const far = good(); far.raw.torsoFrac = 0.07; far.raw.box = { w: 0.15, h: 0.3 };
  assert.equal(framingIssue(far).code, 'far');
  const hidden = good(); hidden.raw.seen.knees = false;
  assert.equal(framingIssue(hidden).code, 'knees');
  const unclear = good(); unclear.present = false;
  assert.equal(framingIssue(unclear).code, 'unclear');
});

test('신뢰도가 높아도 화면 밖 무릎·발은 잘 보인다고 안내하지 않는다', () => {
  const { lm, wl } = standingPose();
  for (const i of [25, 26, 27, 28]) { lm[i].visibility = 1; lm[i].y = 1.2; }
  const raw = computeFeatures(lm, wl);
  assert.equal(raw.seen.knees, false);
  assert.equal(raw.seen.feet, false);
  assert.equal(framingIssue({ present: true, raw }).code, 'knees');
  lm[25].y = 0.8;
  assert.equal(computeFeatures(lm, wl).seen.knees, true); // 옆모습: 한쪽만 보여도 충분
});

test('운동 중 잠깐 가린 1프레임에는 안내가 깜빡이지 않고 지속 문제·복구는 반영한다', () => {
  const guide = new FramingGuide();
  const issue = framingIssue({ raw: null });
  assert.equal(guide.update(issue, 0), null);
  assert.equal(guide.update(null, 100), null);
  assert.equal(guide.update(null, 1000), null);
  assert.equal(guide.update(issue, 1100), null);
  assert.equal(guide.update(issue, 1900), issue);
  assert.equal(guide.update(null, 2000), issue);
  assert.equal(guide.update(null, 2500), null);
});

test('팔 운동을 골랐으면 잘 보이는 상체를 더 멀리 보내지 않고 손목 가림을 안내한다', () => {
  const upper=good(); upper.raw.seen.arms=true; upper.raw.seen.bothArms=true;
  upper.raw.seen.knees=false; upper.raw.seen.feet=false;
  upper.raw.cutoff=true; upper.raw.upperCutoff=false; upper.raw.torsoFrac=0.48;
  assert.equal(framingIssue(upper,{upperBody:true}),null);
  upper.raw.seen.arms=false;
  assert.equal(framingIssue(upper,{upperBody:true}).code,'hands');
  upper.raw.seen.arms=true; upper.raw.seen.bothArms=false;
  assert.equal(framingIssue(upper,{upperBody:true,bothArms:true}).code,'hands');
});
