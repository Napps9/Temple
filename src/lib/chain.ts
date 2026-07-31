// Two or three things said in one breath.
//
// "Put Marcus on Unlimited and tag him VIP" is two writes, and making the
// owner say it twice is the kind of small tax that adds up to a surface
// nobody uses. But a chain is only safe when every part of it can be
// agreed to in advance, and most of the interesting failures here are
// about when that is not true.
//
// The rules live here rather than inline in the feed because "should
// these have run together" is exactly the sort of judgement that is easy
// to get subtly wrong and impossible to notice from the outside.

export type StepShape = {
  // 'do' writes something; 'ask' answers a question.
  kind: 'do' | 'ask';
  // False when the spec has no apply — an 'ask' never does.
  canApply: boolean;
  // False when the preview came back as a question ("which Marcus?"), a
  // refusal, or an answer rather than a proposal. The confirm label is
  // what an action sets when it has something to agree to.
  confirmable: boolean;
};

// Every step survived sanitising, every step is a write, and every step
// came back with something to confirm. Anything less and the chain
// collapses: a question cannot be answered in advance, and an answer is
// not a thing to agree to.
//
// `asked` is how many the parser emitted. A step whose sanitiser refused
// is missing from `steps`, and running the rest of a sentence whose
// middle was dropped would be doing something nobody said.
export function travelTogether(steps: StepShape[], asked: number): boolean {
  if (steps.length < 2 || steps.length !== asked) return false;
  return steps.every((s) => s.kind === 'do' && s.canApply && s.confirmable);
}

// What the bar says about the parts it is not doing yet. Naming the
// number matters: "and one other thing" tells an owner there is exactly
// one sentence left to repeat, which is a different job from "and some
// other things".
export function leftoverLine(rest: number): string | null {
  if (rest <= 0) return null;
  const it = rest === 1 ? 'it' : 'them';
  const what = rest === 1 ? 'one other thing' : `${rest} other things`;
  return (
    `That was ${what} too — say ${it} again once this is settled and ` +
    `I will do ${it}.`
  );
}

// The failure sentence. No rollback and no retry: these are separate
// writes across separate tables and some of them have already left the
// building — an email has gone, Stripe has moved money. Inventing a
// reverse for every verb would be a second set of writes to get wrong,
// and a reverse that itself failed leaves the owner worse off than being
// told plainly. So it stops, says what got done and what did not, and
// leaves everything after the failure untouched rather than attempted,
// because the later step usually assumed the earlier one.
export function chainStopLine(doneCount: number, why: string): string {
  return doneCount === 0
    ? why
    : `I stopped there. ${why} Nothing after that was tried.`;
}
