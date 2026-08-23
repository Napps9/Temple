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
export const MD = 768;
export const LG = 1024;

// The rail's own width, and the sum a staff screen actually has to lay
// out in. A component inside the column cannot ask the window how wide it
// is and get a useful answer, and the product's split view — the
// email builder — was asking.
export const RAIL_W = 246;

export function staffContentWidth(windowWidth: number) {
  return windowWidth >= LG ? windowWidth - RAIL_W : windowWidth;
}

export type ModalShape = 'sheet' | 'dialog';

export function modalShape(width: number): ModalShape {
  return width >= MD ? 'dialog' : 'sheet';
}
