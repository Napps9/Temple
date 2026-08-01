import type { ReactNode } from 'react';
import { Children, cloneElement, isValidElement } from 'react';

// Routing, stubbed for the test runner.
//
// expo-router ships source vite cannot parse, and inlining it for
// transformation does not help. That is the reason it is stubbed; it is
// not the reason to keep the stub. A component render test should not be
// standing up a navigation container to find out what a tile says, and
// what it actually wants to assert about a link is the destination —
// which a stub exposes far more directly than the real thing.
//
// `href` lands as a data attribute so a test can read it. `asChild`
// behaves as expo-router's does: render the single child, carrying the
// href onto it rather than wrapping it in another element.
export function Link({
  href,
  asChild,
  children,
}: {
  href: unknown;
  asChild?: boolean;
  children: ReactNode;
}) {
  const to = typeof href === 'string' ? href : JSON.stringify(href);
  if (asChild) {
    const only = Children.only(children);
    if (isValidElement(only)) {
      return cloneElement(only as React.ReactElement<Record<string, unknown>>, {
        'data-href': to,
      });
    }
  }
  return <a data-href={to}>{children}</a>;
}

export function Redirect({ href }: { href: unknown }) {
  return <span data-redirect={String(href)} />;
}

export const router = {
  push: () => {},
  replace: () => {},
  back: () => {},
  navigate: () => {},
};

export function useRouter() {
  return router;
}

export function useLocalSearchParams<T = Record<string, string>>(): T {
  return {} as T;
}

export function useSegments(): string[] {
  return [];
}

export function usePathname(): string {
  return '/';
}

export function useFocusEffect() {}

export const Stack = Object.assign(
  ({ children }: { children?: ReactNode }) => <>{children}</>,
  { Screen: () => null },
);

export const Tabs = Object.assign(
  ({ children }: { children?: ReactNode }) => <>{children}</>,
  { Screen: () => null },
);
