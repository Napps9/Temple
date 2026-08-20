// Which container a modal takes, by viewport width.
//
// Pulled out of <Sheet> so the rule is one testable line rather than a
// ternary buried in a render, and so <SheetAction> reaches the same answer
// without duplicating the number.
//
// 768 is Tailwind's `md`, which is the width every `md:` class already in
// the app switches at. A modal that changed shape at its own private
// breakpoint would be the only thing on screen doing so.
export const DIALOG_MIN_WIDTH = 768;

export type ModalShape = 'sheet' | 'dialog';

export function modalShape(width: number): ModalShape {
  return width >= DIALOG_MIN_WIDTH ? 'dialog' : 'sheet';
}
