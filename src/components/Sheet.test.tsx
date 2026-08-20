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
    // Both the backdrop and the button are named "Close" — the button is
    // the inner one.
    const closers = screen.getAllByLabelText('Close');
    fireEvent.click(closers[closers.length - 1]);
    expect(onClose).toHaveBeenCalledOnce();
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

  it('falls back to Cancel when the caller does not name it', () => {
    render(<ConfirmDialog {...base} />);
    expect(screen.getByText('Cancel')).toBeTruthy();
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
