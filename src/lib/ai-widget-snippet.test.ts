import { describe, expect, it } from 'vitest';

import { buildCallWidgetSnippet } from './ai-widget-snippet';

describe('buildCallWidgetSnippet', () => {
  it('includes tel: and sms: links to the number', () => {
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: 'Forge & Fury',
    });
    expect(html).toContain('href="tel:+447700900123"');
    expect(html).toContain('href="sms:+447700900123"');
  });

  it('ships the brand ink regardless of the copying theme', () => {
    // The snippet is frozen HTML on someone else's site: it must carry the
    // light-surface brand values, never whatever `primary` resolved to in
    // the staff member's session.
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: 'Forge & Fury',
    });
    expect(html).toContain('background:#14161A');
    expect(html).toContain('border:1px solid #14161A');
  });

  it('escapes a hostile gym name so it cannot break out of the markup', () => {
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: '<script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
