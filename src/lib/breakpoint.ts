// The one width at which the product changes shape.
//
// 768 is Tailwind's `md`, which is what every `md:` class in the app
// already switches at. Three things now turn on it — a modal becomes a
// dialog, the staff nav becomes a sidebar, and page layouts widen — and
// they have to turn together: a sidebar that appeared at 1024 while
// modals became dialogs at 768 would give the same window two different
// ideas of how big it is.
//
// It lives outside the components that use it so the rule is one testable
// line rather than a ternary buried in three renders.
export const MD = 768;

export type ModalShape = 'sheet' | 'dialog';

export function modalShape(width: number): ModalShape {
  return width >= MD ? 'dialog' : 'sheet';
}
