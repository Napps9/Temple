import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DEMO_TARGETS, demoTargetsJson, resolveDemoTarget } from './demo-targets';

const published = fileURLToPath(new URL('../../public/demo-targets.json', import.meta.url));

describe('demo targets', () => {
  it('publishes the same list the sign-in screen honours', () => {
    expect(readFileSync(published, 'utf8')).toBe(demoTargetsJson());
  });

  it('keeps every key unique and every href in-app', () => {
    const keys = DEMO_TARGETS.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of DEMO_TARGETS) {
      expect(t.key.startsWith('/')).toBe(true);
      expect(t.href.startsWith('/')).toBe(true);
    }
  });

  it('resolves a retired key to where the screen lives now', () => {
    expect(resolveDemoTarget('/management/branding')).toBe('/management?section=branding');
    expect(resolveDemoTarget('/nowhere')).toBeNull();
  });
});
