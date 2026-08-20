// Haptics, stubbed for the test runner.
//
// expo-haptics pulls in expo-modules-core, which reads globals the native
// runtime injects (`__DEV__`, `globalThis.expo`) and throws at import time
// without them. Since lib/haptic is imported by Button, and Button is
// inside most of the app, that put every interactive component out of
// reach of a render test.
//
// Stubbing is the right boundary rather than a workaround: a buzz is not
// something jsdom can produce, and no render test should assert on one.
// lib/haptic only reaches this module on native anyway — on web it uses
// navigator.vibrate or a hidden iOS switch, neither of which is here.
export enum ImpactFeedbackStyle {
  Light = 'light',
  Medium = 'medium',
  Heavy = 'heavy',
}

export enum NotificationFeedbackType {
  Success = 'success',
  Warning = 'warning',
  Error = 'error',
}

export const impactAsync = async (_style?: ImpactFeedbackStyle) => {};
export const selectionAsync = async () => {};
export const notificationAsync = async (_type?: NotificationFeedbackType) => {};
