import { describe, expect, it } from 'vitest';

import { documentTitle, sectionTitle } from './document-title';

describe('document title', () => {
  it('names a section from the first path segment', () => {
    expect(sectionTitle('/timeline')).toBe('Timeline');
    expect(sectionTitle('/management/members/abc')).toBe('Manage');
    expect(sectionTitle('/join/demo-ironworks')).toBe('Join');
  });

  it('is just Temple for the root and unknown paths', () => {
    expect(documentTitle('/', null)).toBe('Temple');
    expect(documentTitle('/nowhere', null)).toBe('Temple');
  });

  it("prefers the page's own heading, but only for its own path", () => {
    const claim = { pathname: '/management/diagnostics', title: 'Diagnostics' };
    expect(documentTitle('/management/diagnostics', claim)).toBe('Diagnostics · Temple');
    expect(documentTitle('/management', claim)).toBe('Manage · Temple');
  });
});
