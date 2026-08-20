// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { fireEvent, renderWithProviders as render, screen } from '../../test/render';

import { Button } from './Button';

// The variants encode a rule about where the gym's colour is allowed —
// one action per page, everything repeated is ink.
//
// The container classes cannot be read back: react-native-web consumes
// className and emits its own css-* classes. The icon tint can, and it is
// derived from the same variant table, so it is the handle this uses.
const INK_LIGHT = '#14161A';

describe('Button', () => {
  const tintOf = () =>
    document.querySelector('[data-icon]')?.getAttribute('data-color');

  it('does not tint a repeated row action with the brand colour', () => {
    render(
      <Button variant="plain" icon="calendar-outline" onPress={() => {}}>
        Book
      </Button>,
    );
    expect(tintOf()).toBe(INK_LIGHT);
  });

  it('tints the destructive one red, wherever it is used', () => {
    render(
      <Button variant="destructive" icon="trash-outline" onPress={() => {}}>
        Remove
      </Button>,
    );
    expect(tintOf()).toBe('#DC2626');
  });

  it('does not tint the primary with ink — that is the accent’s one slot', () => {
    render(
      <Button icon="add" onPress={() => {}}>
        Book this class
      </Button>,
    );
    expect(tintOf()).not.toBe(INK_LIGHT);
  });

  it('presses', () => {
    const onPress = vi.fn();
    render(
      <Button variant="plain" onPress={onPress}>
        Book
      </Button>,
    );
    fireEvent.click(screen.getByText('Book'));
    expect(onPress).toHaveBeenCalledOnce();
  });

  it('swallows the press while loading, and keeps its accessible name', () => {
    const onPress = vi.fn();
    render(
      <Button variant="plain" onPress={onPress} loading>
        Book
      </Button>,
    );
    // The spinner replaces the label, so the name has to come from the prop.
    expect(screen.queryByText('Book')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Book' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('swallows the press while disabled', () => {
    const onPress = vi.fn();
    render(
      <Button onPress={onPress} disabled>
        Save
      </Button>,
    );
    fireEvent.click(screen.getByText('Save'));
    expect(onPress).not.toHaveBeenCalled();
  });
});
