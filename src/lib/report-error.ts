import Constants from 'expo-constants';
import { Platform } from 'react-native';

import { readSelectedGym } from '@/lib/selected-gym';
import { supabase } from '@/lib/supabase';

// The transport behind the crash screen. Until 0281 a crash was a
// screenshot or nothing; now it is a row the gym's owner can read on
// Diagnostics. Best-effort and silent by design: a reporter that can
// itself throw, or that fills the table from a render loop, is worse
// than none, so it never throws and drops a repeat of the last message
// inside a minute (the RPC caps a caller at twenty an hour behind that).

let last: { message: string; at: number } | null = null;
let installed = false;

// The gym whose screen broke, when the device has chosen one (0283).
// The server falls back to the oldest membership either way.
async function selectedGym(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    return userId ? await readSelectedGym(userId) : null;
  } catch {
    return null;
  }
}

function describe(error: unknown): { message: string; stack: string | null } {
  if (error instanceof Error) {
    return { message: error.message || error.name, stack: error.stack ?? null };
  }
  if (typeof error === 'string') return { message: error, stack: null };
  try {
    return { message: JSON.stringify(error) ?? String(error), stack: null };
  } catch {
    return { message: String(error), stack: null };
  }
}

export function reportClientError({
  error,
  route,
  componentStack,
}: {
  error: unknown;
  route?: string | null;
  componentStack?: string | null;
}): void {
  try {
    const { message, stack } = describe(error);
    if (!message) return;
    const now = Date.now();
    if (last && last.message === message && now - last.at < 60_000) return;
    last = { message, at: now };
    const path =
      route ??
      (Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.location.pathname
        : null);
    void selectedGym()
      .then((gymId) =>
        supabase.rpc('report_client_error', {
          p_route: path,
          p_message: message,
          p_stack: stack,
          p_component_stack: componentStack ?? null,
          p_platform: Platform.OS,
          p_app_version: Constants.expoConfig?.version ?? null,
          p_gym_id: gymId,
        }),
      )
      .then(
        () => undefined,
        () => undefined,
      );
  } catch {
    // Never throws.
  }
}

// The errors the crash screen never sees: rejected promises, and on
// native anything the runtime's own handler catches first. Installed
// once from the root layout.
export function installGlobalErrorReporting(): void {
  if (installed) return;
  installed = true;
  if (Platform.OS === 'web') {
    if (typeof window === 'undefined') return;
    window.addEventListener('error', (e) => {
      reportClientError({ error: e.error ?? e.message });
    });
    window.addEventListener('unhandledrejection', (e) => {
      reportClientError({ error: e.reason });
    });
    return;
  }
  const utils = (
    globalThis as {
      ErrorUtils?: {
        getGlobalHandler(): ((e: Error, isFatal?: boolean) => void) | undefined;
        setGlobalHandler(h: (e: Error, isFatal?: boolean) => void): void;
      };
    }
  ).ErrorUtils;
  if (!utils) return;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((e, isFatal) => {
    reportClientError({ error: e, route: '(native)' });
    previous?.(e, isFatal);
  });
}
