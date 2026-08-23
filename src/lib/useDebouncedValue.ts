import { useEffect, useState } from 'react';

// Generic debounce — no existing one in the repo. Same
// setTimeout/clearTimeout/ref shape as the
// autosave debounce, just reusable for any value.
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debounced;
}
