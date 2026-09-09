import { createContext, type ReactNode } from 'react';

// Another package that ships source vite cannot parse, stubbed like the
// rest. A jsdom window has no notch, so the context's null default — which
// lib/safe-area reads as four zeros — is also the honest answer here.
export type EdgeInsets = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

const NONE: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const SafeAreaInsetsContext = createContext<EdgeInsets | null>(null);

export function useSafeAreaInsets(): EdgeInsets {
  return NONE;
}

export function SafeAreaProvider({ children }: { children?: ReactNode }) {
  return <>{children}</>;
}
