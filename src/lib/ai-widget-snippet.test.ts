import { describe, expect, it } from 'vitest';

import { buildCallWidgetSnippet } from './ai-widget-snippet';

describe('buildCallWidgetSnippet', () => {
  it('includes tel: and sms: links to the number', () => {
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: 'Forge & Fury',
      accentColor: '#2563EB',
    });
    expect(html).toContain('href="tel:+447700900123"');
    expect(html).toContain('href="sms:+447700900123"');
  });

  it('uses the accent color for the button styling', () => {
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: 'Forge & Fury',
      accentColor: '#2563EB',
    });
    expect(html).toContain('background:#2563EB');
  });

  it('escapes a hostile gym name so it cannot break out of the markup', () => {
    const html = buildCallWidgetSnippet({
      phoneNumber: '+447700900123',
      gymName: '<script>alert(1)</script>',
      accentColor: '#2563EB',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
