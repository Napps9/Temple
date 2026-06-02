import { useEffect, useState } from 'react';

export function useSavedFlag(durationMs = 2500): [boolean, () => void] {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!saved) return;
    const id = setTimeout(() => setSaved(false), durationMs);
    return () => clearTimeout(id);
  }, [saved, durationMs]);

  return [saved, () => setSaved(true)];
}
