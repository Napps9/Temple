import {
  Platform,
  Text as RNText,
  TextInput as RNTextInput,
  type TextStyle,
} from 'react-native';
import type { ComponentProps } from 'react';

// The product's typeface, applied.
//
// React Native has no font inheritance: setting a family on a parent does
// nothing to the text inside it, and there is no `body` to style. Every
// piece of text has to name its own font, which is why an app either
// wraps Text once or writes the family 2,300 times.
//
// This is that wrapper. It prepends `font-normal`, which the Tailwind
// plugin in tailwind.config.js defines as Geist 400 — so text with no
// weight class of its own gets the regular cut, and text that names a
// weight overrides it by source order. Everything else about RN's Text is
// untouched and passes straight through.
//
// It is imported instead of react-native's Text throughout the app. That
// is the whole enforcement mechanism: there is no lint rule, so a new
// `import { Text } from 'react-native'` will silently render in the
// platform font.
// Prepending rather than appending is load-bearing. NativeWind resolves
// two utilities of equal specificity by their order in the generated
// stylesheet, not by their order in the class string — but a caller who
// reads `font-normal font-bold` and expects bold to win is reading it the
// way it behaves. Appending would read as though the regular cut always
// won, which is the opposite of what happens.
export function fontClass(className?: string) {
  return className ? `font-normal ${className}` : 'font-normal';
}

export function Text({ className, ...rest }: ComponentProps<typeof RNText>) {
  return <RNText className={fontClass(className)} {...rest} />;
}

// Same, for the fields. A form whose label is Geist and whose value is San
// Francisco is worse than one that is consistently either.
// On web the browser draws its own focus rectangle around a focused
// input: a sharp blue box inside whatever rounded control the input
// sits in. Every input here is already framed by its control (the
// bordered field, the search pill, the composer card), so the ring only
// ever clashed with it.
const NO_OUTLINE =
  Platform.OS === 'web' ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

export function TextInput({
  className,
  style,
  ...rest
}: ComponentProps<typeof RNTextInput>) {
  return (
    <RNTextInput
      className={fontClass(className)}
      style={NO_OUTLINE ? [NO_OUTLINE, style] : style}
      {...rest}
    />
  );
}
