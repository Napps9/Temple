import { describe, expect, it } from 'vitest';

import { isStaffRoute, normaliseRoute, shouldRecord } from './route-usage';

// The privacy rule is this function. Everything else about the table is a
// consequence of it holding: if an id ever reaches the column, a measure
// with no profile_id has quietly become a record of which member somebody
// looked at, which is the one thing it was built not to be.
describe('an id never reaches the column', () => {
  it('collapses a uuid segment', () => {
    expect(normaliseRoute('/management/members/6b1f9e0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b')).toBe(
      '/management/members/[id]',
    );
  });

  it('collapses a numeric segment', () => {
    expect(normaliseRoute('/management/communications/4821')).toBe(
      '/management/communications/[id]',
    );
  });

  // A Stripe object, a storage key, a token that ended up in a path.
  it('collapses anything long and opaque', () => {
    expect(normaliseRoute('/management/leads/conversation/cs_live_a1B2c3D4e5F6g7H8i9J0k1L2')).toBe(
      '/management/leads/conversation/[id]',
    );
  });

  it('leaves a real route alone, lowercased', () => {
    expect(normaliseRoute('/management/Communications/settings')).toBe(
      '/management/communications/settings',
    );
    expect(normaliseRoute('/timeline')).toBe('/timeline');
  });

  it('drops the query string and the fragment, which carry anything at all', () => {
    expect(normaliseRoute('/management/members?filter=marcus&tab=2')).toBe(
      '/management/members',
    );
    expect(normaliseRoute('/timeline#note')).toBe('/timeline');
  });

  it('tolerates the shapes a router actually emits', () => {
    expect(normaliseRoute('/')).toBe('/');
    expect(normaliseRoute('//management//members//')).toBe('/management/members');
  });

  it('caps a path that has no business being this long', () => {
    const long = `/management/${'x'.repeat(200)}`;
    expect(normaliseRoute(long).length).toBeLessThanOrEqual(120);
  });
});

// Members are not what the burndown is about, and counting their screens
// would be collecting something nobody asked a question about.
describe('only the staff side is counted', () => {
  it('counts the staff surfaces', () => {
    for (const r of [
      '/timeline',
      '/classes',
      '/programming',
      '/analysis',
      '/setup',
      '/management',
      '/management/members/[id]',
    ]) {
      expect(isStaffRoute(r)).toBe(true);
    }
  });

  it('counts nothing on the member side, or off it', () => {
    for (const r of ['/book', '/track', '/track/injuries', '/inbox', '/sign-in', '/welcome']) {
      expect(isStaffRoute(r)).toBe(false);
    }
  });

  // /programming exists under both groups at the same URL. The member
  // view is a different screen behind the same path, so this over-counts
  // rather than under-counts — stated because a measure should be honest
  // about the direction it is wrong in.
  it('cannot tell the two /programming screens apart', () => {
    expect(isStaffRoute('/programming')).toBe(true);
  });
});

describe('what gets sent', () => {
  it('sends a staff route the first time', () => {
    expect(shouldRecord('/management/members', null)).toBe('/management/members');
  });

  // A layout that re-renders on every navigation commit is the shape that
  // once dispatched fifty nested navigations in this app. Sending only on
  // change is what keeps a re-render from becoming a write.
  it('does not send the same route twice in a row', () => {
    expect(shouldRecord('/management/members', '/management/members')).toBeNull();
  });

  it('sends again once the route actually changes', () => {
    expect(shouldRecord('/timeline', '/management/members')).toBe('/timeline');
  });

  it('sends the normalised route, not the raw one', () => {
    expect(
      shouldRecord('/management/members/6b1f9e0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b', null),
    ).toBe('/management/members/[id]');
  });

  it('sends nothing at all from the member app', () => {
    expect(shouldRecord('/track/injuries', null)).toBeNull();
  });

  // Two different members' profiles are the same route, so opening one
  // after another sends once. That is the measure working, not a bug.
  it('treats two members’ profiles as one route', () => {
    const first = shouldRecord('/management/members/6b1f9e0a-2c3d-4e5f-8a9b-0c1d2e3f4a5b', null);
    expect(shouldRecord('/management/members/11111111-2222-3333-4444-555555555555', first)).toBeNull();
  });
});
