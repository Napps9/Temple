// @vitest-environment jsdom
import { Text } from './Text';
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders as render, screen } from '../../test/render';

import { Button } from './Button';
import { ConfirmDialog } from './ConfirmDialog';
import { Sheet, SheetAction } from './Sheet';

// What a render test can prove about a modal here: that it says what it
// was given, that the two ways out both work, and that a press inside it
// is not a press outside it. What it cannot prove is that the sheet is
// anchored to the bottom of a phone — jsdom has no layout — which is why
// the breakpoint itself is a pure rule tested in lib/modal-shape.test.ts.
describe('Sheet', () => {
  it('says its title, its subtitle and its body', () => {
    render(
      <Sheet visible title="Metcon" subtitle="Thursday at 17:30" onClose={() => {}}>
        <Text>Seventeen booked in</Text>
      </Sheet>,
    );
    expect(screen.getByText('Metcon')).toBeTruthy();
    expect(screen.getByText('Thursday at 17:30')).toBeTruthy();
    expect(screen.getByText('Seventeen booked in')).toBeTruthy();
  });

  it('renders no subtitle when it was not given one', () => {
    render(
      <Sheet visible title="Metcon" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Thursday at 17:30')).toBeNull();
  });

  it('renders nothing at all while closed', () => {
    render(
      <Sheet visible={false} title="Metcon" onClose={() => {}}>
        <Text>Seventeen booked in</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Seventeen booked in')).toBeNull();
  });

  it('closes from the close button', () => {
    const onClose = vi.fn();
    render(
      <Sheet visible title="Metcon" onClose={onClose}>
        <Text>Body</Text>
      </Sheet>,
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  // The dim is a press target, not a control. It used to be an ARIA button
  // wrapping the dialog — invalid, and the first tab stop in every modal in
  // the product, announced "Close" and visibly nowhere.
  it('offers exactly one thing called Close, and it is the head button', () => {
    render(
      <Sheet visible title="Metcon" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.getAllByLabelText('Close')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Close' })).toHaveLength(1);
  });

  it('does not close when the press lands inside it', () => {
    const onClose = vi.fn();
    render(
      <Sheet visible title="Metcon" onClose={onClose}>
        <Text>Seventeen booked in</Text>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('Seventeen booked in'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('renders the foot only when it has actions', () => {
    const { rerender } = render(
      <Sheet visible title="Metcon" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.queryByText('Book this class')).toBeNull();

    rerender(
      <Sheet
        visible
        title="Metcon"
        onClose={() => {}}
        actions={
          <SheetAction grow>
            <Button onPress={() => {}}>Book this class</Button>
          </SheetAction>
        }>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.getByText('Book this class')).toBeTruthy();
  });

  it('names itself for a screen reader', () => {
    render(
      <Sheet visible title="Cancel Thursday 17:30 Metcon?" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(
      screen.getByRole('dialog', { name: 'Cancel Thursday 17:30 Metcon?' }),
    ).toBeTruthy();
  });

  // Board 04's rule: a modal never opens another modal. When the sheet is
  // showing a step, back returns to the body and close still closes the
  // whole thing — two different exits, and a step must not swallow the
  // second one.
  it('offers back only while it is showing a step', () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <Sheet visible title="Record workout" onClose={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    rerender(
      <Sheet visible title="Tag a movement" onClose={() => {}} onBack={onBack}>
        <Text>Body</Text>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('still closes from a step', () => {
    const onClose = vi.fn();
    render(
      <Sheet visible title="Tag a movement" onClose={onClose} onBack={() => {}}>
        <Text>Body</Text>
      </Sheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});

// The one rule in the shell's own header that shipped broken: a
// ConfirmDialog rendered inside a Sheet's body was a Modal inside a
// ScrollView inside a Modal. On web it portals out and looks right, which
// is why nobody saw it; on a phone it is two grabbers and two backdrops.
describe('Sheet nesting', () => {
  it('refuses to render inside another sheet', () => {
    // React logs the thrown error before the boundary catches it.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() =>
      render(
        <Sheet visible title="Bulk edit" onClose={() => {}}>
          <Sheet visible title="Close the gym?" onClose={() => {}}>
            <Text>Body</Text>
          </Sheet>
        </Sheet>,
      ),
    ).toThrow(/never\s+opens another modal/);
    quiet.mockRestore();
  });

  it('is happy with two sheets side by side', () => {
    render(
      <>
        <Sheet visible title="One" onClose={() => {}}>
          <Text>First</Text>
        </Sheet>
        <Sheet visible={false} title="Two" onClose={() => {}}>
          <Text>Second</Text>
        </Sheet>
      </>,
    );
    expect(screen.getByText('First')).toBeTruthy();
  });
});

// The shell owns the ways out, so it owns refusing them. Before this, the
// backdrop and Escape called onClose unconditionally and two modals out of
// 33 guarded it — a stray click beside a half-written workout took the lot.
describe('Sheet dismissal', () => {
  const body = <Text>Seventeen booked in</Text>;

  // Every exit the shell owns runs through the same requestDismiss, so
  // the head's Close stands for all of them. The dim is deliberately not
  // reachable by label any more — that is the a11y fix, asserted above.
  function dismiss() {
    fireEvent.click(screen.getByLabelText('Close'));
  }

  it('lets a clean sheet go without asking', () => {
    const onClose = vi.fn();
    render(<Sheet visible title="Metcon" onClose={onClose}>{body}</Sheet>);
    dismiss();
    expect(onClose).toHaveBeenCalledOnce();
    expect(screen.queryByText('Discard your changes?')).toBeNull();
  });

  it('refuses every shell exit while a write is in flight', () => {
    const onClose = vi.fn();
    render(<Sheet visible title="Metcon" onClose={onClose} busy>{body}</Sheet>);
    dismiss();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('leaves the caller its own foot while busy', () => {
    render(
      <Sheet
        visible
        title="Metcon"
        onClose={() => {}}
        busy
        actions={
          <SheetAction grow>
            <Button onPress={() => {}}>Save</Button>
          </SheetAction>
        }>
        {body}
      </Sheet>,
    );
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('asks before throwing away typing', () => {
    const onClose = vi.fn();
    render(<Sheet visible title="Metcon" onClose={onClose} dirty>{body}</Sheet>);
    dismiss();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    expect(screen.queryByText('Seventeen booked in')).toBeNull();
  });

  it('offers the question two answers and no third way out', () => {
    render(
      <Sheet visible title="Metcon" onClose={() => {}} dirty onBack={() => {}}>
        {body}
      </Sheet>,
    );
    dismiss();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    expect(screen.queryByLabelText('Close')).toBeNull();
  });

  it('gives the body back when the answer is keep editing', () => {
    const onClose = vi.fn();
    render(
      <Sheet
        visible
        title="Metcon"
        onClose={onClose}
        dirty
        actions={
          <SheetAction grow>
            <Button onPress={() => {}}>Save</Button>
          </SheetAction>
        }>
        {body}
      </Sheet>,
    );
    dismiss();
    fireEvent.click(screen.getByText('Keep editing'));
    expect(screen.getByText('Seventeen booked in')).toBeTruthy();
    expect(screen.getByText('Save')).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes once when the answer is discard', () => {
    const onClose = vi.fn();
    render(<Sheet visible title="Metcon" onClose={onClose} dirty>{body}</Sheet>);
    dismiss();
    fireEvent.click(screen.getByText('Discard'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('lets a write in flight outrank the question', () => {
    const onClose = vi.fn();
    render(<Sheet visible title="Metcon" onClose={onClose} dirty busy>{body}</Sheet>);
    dismiss();
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('reopens on the body, not on a question it asked last time', () => {
    const onClose = vi.fn();
    const { rerender } = render(
      <Sheet visible title="Metcon" onClose={onClose} dirty>{body}</Sheet>,
    );
    dismiss();
    expect(screen.getByText('Discard your changes?')).toBeTruthy();
    rerender(<Sheet visible={false} title="Metcon" onClose={onClose} dirty>{body}</Sheet>);
    rerender(<Sheet visible title="Metcon" onClose={onClose} dirty>{body}</Sheet>);
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(screen.getByText('Seventeen booked in')).toBeTruthy();
  });

  it('takes the caller’s words for the question when it has better ones', () => {
    render(
      <Sheet
        visible
        title="Metcon"
        onClose={() => {}}
        dirty
        discard={{ title: 'Throw away this workout?', confirmLabel: 'Throw it away' }}>
        {body}
      </Sheet>,
    );
    dismiss();
    expect(screen.getByText('Throw away this workout?')).toBeTruthy();
    expect(screen.getByText('Throw it away')).toBeTruthy();
    expect(screen.getByText('Keep editing')).toBeTruthy();
  });
});

// ConfirmDialog is seven call sites' worth of destructive decisions, and
// it now renders through Sheet without any of them changing. These check
// the contract those callers rely on.
describe('ConfirmDialog', () => {
  const base = {
    visible: true,
    title: 'Cancel Thursday 17:30 Metcon?',
    body: '17 members are booked in. Everyone is refunded in full.',
    confirmLabel: 'Cancel the class',
    cancelLabel: 'Keep the class',
    onConfirm: () => {},
    onCancel: () => {},
  };

  it('puts the question in the title and the consequence in the body', () => {
    render(<ConfirmDialog {...base} />);
    expect(screen.getByText('Cancel Thursday 17:30 Metcon?')).toBeTruthy();
    expect(
      screen.getByText('17 members are booked in. Everyone is refunded in full.'),
    ).toBeTruthy();
  });

  it('lets the caller name the safe option', () => {
    render(<ConfirmDialog {...base} cancelLabel="Keep the class" />);
    expect(screen.getByText('Keep the class')).toBeTruthy();
    expect(screen.getByText('Cancel the class')).toBeTruthy();
  });

  it('has no unnamed fallback for the safe option', () => {
    // cancelLabel is required, so "Cancel" cannot appear beside a title
    // that is itself a cancel. The type is the enforcement; this pins the
    // consequence.
    render(<ConfirmDialog {...base} />);
    expect(screen.getByText('Keep the class')).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();
  });

  it('shows an error without losing the body', () => {
    render(<ConfirmDialog {...base} error="That class has already started." />);
    expect(screen.getByText('That class has already started.')).toBeTruthy();
    expect(
      screen.getByText('17 members are booked in. Everyone is refunded in full.'),
    ).toBeTruthy();
  });

  it('confirms and cancels through the buttons it was given', () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        {...base}
        cancelLabel="Keep the class"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel the class'));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByText('Keep the class'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('swallows the confirm while a previous one is still in flight', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base} onConfirm={onConfirm} pending />);
    // Button renders a spinner in place of the label while loading, so the
    // label is gone and the press cannot land.
    expect(screen.queryByText('Cancel the class')).toBeNull();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
