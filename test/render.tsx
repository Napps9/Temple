import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render as rtlRender } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';

// Rendering a Temple component, with the providers it assumes.
//
// Almost anything below the screen level reads the gym's brand for its
// tint, and `useGymBrand` is a react-query hook — so without a client in
// the tree a component throws before it renders a single word. That is
// not a thing worth discovering once per test file.
//
// The client is built fresh per render with retries off and no cache
// between tests: a retrying query turns a deliberate failure into a slow
// deliberate failure, and a shared cache makes tests order-dependent in
// the way that takes a day to find.
export function renderWithProviders(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return { client, ...rtlRender(ui, { wrapper: Wrapper }) };
}

export { screen, within, fireEvent, waitFor } from '@testing-library/react';
