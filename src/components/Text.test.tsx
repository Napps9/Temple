// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { renderWithProviders as render, screen } from '../../test/render';

import { fontClass, Text, TextInput } from './Text';

// The wrapper's whole job is the class it prepends, because React Native
// has no font inheritance and `font-normal` is what names the regular cut.
//
// It is tested through fontClass rather than through the DOM on purpose:
// react-native-web consumes `className` and emits its own `css-*` classes,
// so the string never survives to an attribute a render test could read.
// The composition is the contract; the rendering is react-native-web's.
describe('fontClass', () => {
  it('names the regular cut when the caller says nothing', () => {
    expect(fontClass()).toBe('font-normal');
    expect(fontClass(undefined)).toBe('font-normal');
  });

  it('keeps the caller’s own classes', () => {
    expect(fontClass('text-ink text-[13px]')).toBe(
      'font-normal text-ink text-[13px]',
    );
  });

  it('puts font-normal before the caller’s weight, never after', () => {
    const cls = fontClass('font-bold');
    expect(cls.indexOf('font-normal')).toBeLessThan(cls.indexOf('font-bold'));
  });

  it('does not add a stray space for an empty class', () => {
    expect(fontClass('')).toBe('font-normal');
  });
});

describe('Text', () => {
  it('renders what it was given', () => {
    render(<Text>Seventeen booked in</Text>);
    expect(screen.getByText('Seventeen booked in')).toBeTruthy();
  });

  it('passes the rest of Text’s props straight through', () => {
    render(
      <Text accessibilityRole="header" numberOfLines={1}>
        Members
      </Text>,
    );
    expect(screen.getByRole('heading', { name: 'Members' })).toBeTruthy();
  });
});

describe('TextInput', () => {
  it('passes the rest of TextInput’s props straight through', () => {
    render(<TextInput placeholder="Search members" value="Ana" readOnly />);
    const input = screen.getByPlaceholderText('Search members');
    expect((input as HTMLInputElement).value).toBe('Ana');
  });
});
