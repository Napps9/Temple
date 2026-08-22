import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactElement } from 'react';
import { cloneElement, isValidElement } from 'react';

// An icon slot takes an Ionicons name or an element — in practice the
// AIMark, the one glyph in the product that is not an Ionicon. The slot
// injects its own size and tint into either, which is what keeps the
// invariant every icon-bearing control relies on: the icon and its label
// are never two different colours, whoever supplied the icon.
export type IconSlot =
  | ComponentProps<typeof Ionicons>['name']
  | ReactElement<{ size?: number; color?: string }>;

export function renderIconSlot(icon: IconSlot, size: number, color: string) {
  if (isValidElement(icon)) return cloneElement(icon, { size, color });
  return <Ionicons name={icon} size={size} color={color} />;
}
