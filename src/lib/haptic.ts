// Cross-platform haptic feedback wrapper.
//
// On iOS/Android, delegates to expo-haptics. On web, falls back to
// navigator.vibrate where the browser supports it (Android Chrome).
// Desktop browsers without vibrate silently no-op so call sites
// don't need to branch — every interaction can ask for a buzz and
// the platform decides what to actually do.
//
// Use the named helpers rather than passing impact styles around;
// the semantic names (selection, tap, success, …) keep the intent
// readable at call sites and make it cheap to retune the platform-
// specific intensities without touching every consumer.

import { Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

type ImpactStyle = 'light' | 'medium' | 'heavy';
type NotificationStyle = 'success' | 'warning' | 'error';

function webVibrate(pattern: number | number[]): void {
  if (Platform.OS !== 'web') return;
  if (typeof navigator === 'undefined' || !('vibrate' in navigator)) return;
  try {
    (navigator as Navigator & { vibrate: (p: number | number[]) => boolean }).vibrate(pattern);
  } catch {
    // Vibrate can throw on some browsers (Safari) if user hasn't
    // interacted with the page yet — swallow silently.
  }
}

function impact(style: ImpactStyle): void {
  if (Platform.OS === 'web') {
    webVibrate(style === 'heavy' ? 20 : style === 'medium' ? 12 : 6);
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
    webVibrate(style === 'error' ? [10, 40, 10] : style === 'warning' ? [10, 30] : 15);
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
      webVibrate(4);
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
