// Cross-platform haptic feedback wrapper.
//
// On iOS/Android (native) we delegate to expo-haptics. On the web we
// can't reach the Taptic Engine directly, so:
//   - Android Chrome → navigator.vibrate (a real buzz).
//   - iOS Safari → no Vibration API at all, so we toggle a hidden
//     <input switch>, which fires the system "switch" haptic (iOS 17.4+).
//   - Desktop → navigator.vibrate exists but no-ops; nothing to feel.
// Every call site can ask for a buzz and the platform decides.
//
// Use the named helpers rather than passing impact styles around; the
// semantic names (selection, tap, success, …) keep the intent readable
// at call sites and make it cheap to retune intensities centrally.

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

type ImpactStyle = 'light' | 'medium' | 'heavy';
type NotificationStyle = 'success' | 'warning' | 'error';

// iOS Safari ships no Vibration API. Toggling a <label>-wrapped
// <input switch> fires the system switch haptic (iOS 17.4+). We keep one
// hidden switch around and click its label. It only fires inside a user
// gesture — every call site is an onPress handler, so that holds.
let iosSwitch: HTMLLabelElement | null = null;
function iosWebHaptic(): void {
  if (typeof document === 'undefined') return;
  try {
    if (!iosSwitch) {
      const label = document.createElement('label');
      label.setAttribute('aria-hidden', 'true');
      label.style.position = 'absolute';
      label.style.width = '1px';
      label.style.height = '1px';
      label.style.opacity = '0';
      label.style.overflow = 'hidden';
      label.style.pointerEvents = 'none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      label.appendChild(input);
      document.body.appendChild(label);
      iosSwitch = label;
    }
    iosSwitch.click();
  } catch {
    // Best effort — pre-17.4 iOS / non-Safari simply no-op.
  }
}

// Web buzz. Android Chrome vibrates; where there's no Vibration API
// (iOS Safari) we fall back to the switch haptic. Durations are long
// enough to actually be felt — sub-10ms pulses are imperceptible on most
// phones, which is why the earlier values went unnoticed.
function webHaptic(durationMs: number | number[]): void {
  if (Platform.OS !== 'web') return;
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      (
        navigator as Navigator & {
          vibrate: (p: number | number[]) => boolean;
        }
      ).vibrate(durationMs);
    } catch {
      // Some browsers throw before the first interaction — ignore.
    }
    return;
  }
  iosWebHaptic();
}

function impact(style: ImpactStyle): void {
  if (Platform.OS === 'web') {
    webHaptic(style === 'heavy' ? 32 : style === 'medium' ? 22 : 14);
    return;
  }
  const map = {
    light: Haptics.ImpactFeedbackStyle.Light,
    medium: Haptics.ImpactFeedbackStyle.Medium,
    heavy: Haptics.ImpactFeedbackStyle.Heavy,
  } as const;
  Haptics.impactAsync(map[style]).catch(() => undefined);
}

function notify(style: NotificationStyle): void {
  if (Platform.OS === 'web') {
    webHaptic(
      style === 'error' ? [12, 40, 12] : style === 'warning' ? [12, 30] : 20,
    );
    return;
  }
  const map = {
    success: Haptics.NotificationFeedbackType.Success,
    warning: Haptics.NotificationFeedbackType.Warning,
    error: Haptics.NotificationFeedbackType.Error,
  } as const;
  Haptics.notificationAsync(map[style]).catch(() => undefined);
}

export const haptic = {
  // Light tap — passive UI element, switching a tab, opening a card.
  selection(): void {
    if (Platform.OS === 'web') {
      webHaptic(10);
      return;
    }
    Haptics.selectionAsync().catch(() => undefined);
  },
  // Light bump — most button presses, chip toggles.
  tap(): void {
    impact('light');
  },
  // Medium thunk — confirming a meaningful action (book, save).
  press(): void {
    impact('medium');
  },
  // Heavy thunk — destructive confirmation (delete, leave).
  heavy(): void {
    impact('heavy');
  },
  success(): void {
    notify('success');
  },
  warning(): void {
    notify('warning');
  },
  error(): void {
    notify('error');
  },
};
