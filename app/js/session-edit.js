// 직접 수정한 횟수와 카메라가 분석한 자세는 서로 다른 기록이다.
export function assessment(set) {
  if (set.assessment) return set.assessment;
  const original = set.orig || set;
  return {
    exercise: original.exercise, kind: original.kind,
    reps: original.reps ?? null, good: set.orig && set.reps !== original.reps ? null : set.good ?? null,
    issues: { ...(set.issues || {}) },
  };
}

export function editRecordedSet(set, { exercise = set.exercise, kind = set.kind, value, weight = set.weight }) {
  if (!Number.isFinite(value) || value < 0) throw new Error('0 이상의 숫자를 입력해 주세요');
  set.assessment = assessment(set);
  if (!set.orig && !set.added) set.orig = { exercise: set.exercise, kind: set.kind, reps: set.reps, holdSec: set.holdSec };
  Object.assign(set, {
    exercise, kind, reps: kind === 'reps' ? Math.round(value) : null,
    holdSec: kind === 'hold' ? Math.round(value) : null,
    weight: kind === 'hold' ? null : weight, edited: true,
  });
  return set;
}

export function postureFeedback(set) {
  const a = assessment(set);
  if (a.exercise !== set.exercise || a.kind !== set.kind) return null;
  if (a.good == null || a.reps == null || a.kind !== 'reps') return null;
  return { analyzed: a.reps, bad: Math.max(0, a.reps - a.good), issues: a.issues };
}
