// The two widths at which the product changes shape, and why they are
// two rather than one.
//
// MD is Tailwind's `md`, which is what every `md:` class in the app
// already switches at: a modal becomes a dialog, and page layouts widen.
// Both of those are measured against the window, because a dialog floats
// over the window and a page that widens is filling it.
//
// LG is where the staff rail appears, and it has to be higher. The rail
// takes 246px out of the row before the page sees any of it, so with the
// rail on, the window and the page's column stop agreeing about how much
// room there is. At a 768 window that column is 522px wide while every
// `md:` class inside it still fires — the classes calendar goes to its
// wide layout in two thirds of the space it was drawn for. Putting the
// rail at 1024 keeps the column at least `md` wide whenever it is on, so
// the two agree again.
//
// They live outside the components that use them so the rule is two
// testable lines rather than a ternary buried in three renders.
//
// A component that needs to know its own column's width measures it with
// onLayout rather than deriving it from the window here: unpinned, the
// rail is a 68px strip with the open panel floating over the page, so a
// window-based estimate is 178px pessimistic for everyone who never pins.
export const MD = 768;
export const LG = 1024;

export type ModalShape = 'sheet' | 'dialog';

export function modalShape(width: number): ModalShape {
  return width >= MD ? 'dialog' : 'sheet';
}
