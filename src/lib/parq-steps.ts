// The PAR-Q stepper's pure rules: one question per screen, a review
// step at the end, and no way to submit past an unanswered question.
// RN-free so the flow logic unit-tests in node.

export type ParqAnswerState = { answeredYes: boolean | null };

// Steps 0..n-1 are the questions; step n is the review.
export function reviewStep(questionCount: number): number {
  return questionCount;
}

export function isReview(step: number, questionCount: number): boolean {
  return step >= questionCount;
}

export function progressLabel(step: number, questionCount: number): string {
  return isReview(step, questionCount)
    ? 'Check your answers'
    : `${step + 1} of ${questionCount}`;
}

export function progressFraction(step: number, questionCount: number): number {
  if (questionCount === 0) return 0;
  return Math.min(1, (step + 1) / (questionCount + 1));
}

// Advancing from a question needs that question answered; the review
// step advances only by submitting, which is not this function's job.
export function canAdvance(
  step: number,
  answers: ParqAnswerState[],
): boolean {
  if (isReview(step, answers.length)) return false;
  return answers[step]?.answeredYes != null;
}

export function firstUnanswered(answers: ParqAnswerState[]): number | null {
  const i = answers.findIndex((a) => a.answeredYes === null);
  return i === -1 ? null : i;
}

// Where a fresh open should land: the first unanswered question, or the
// review when everything is already answered (a re-take with preserved
// answers should not replay all seven screens).
export function initialStep(answers: ParqAnswerState[]): number {
  return firstUnanswered(answers) ?? reviewStep(answers.length);
}
