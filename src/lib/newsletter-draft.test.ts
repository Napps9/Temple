import { describe, expect, it } from 'vitest';

import { newsletterDocument, sanitiseNewsletter } from './newsletter-draft';

const BRAND = {
  primaryColor: '#2563EB',
  secondaryColor: '#0F172A',
  textColor: '#0F172A',
};

describe('sanitiseNewsletter', () => {
  it('keeps a valid draft and clamps lengths', () => {
    const draft = sanitiseNewsletter({
      subject: '  Christmas at the gym  ',
      sections: [
        { heading: 'Holiday hours', body: 'We close 24–27 Dec and reopen with a bang on the 28th.' },
        { heading: 'x', body: 'too-short-heading section is dropped' },
        { heading: 'Barbell club', body: 'short' },
      ],
    });
    expect(draft).toEqual({
      subject: 'Christmas at the gym',
      sections: [
        {
          heading: 'Holiday hours',
          body: 'We close 24–27 Dec and reopen with a bang on the 28th.',
        },
      ],
    });
  });

  it('rejects drafts with no usable sections or subject', () => {
    expect(sanitiseNewsletter({ subject: 'Hi', sections: [] })).toBeNull();
    expect(sanitiseNewsletter({ sections: [{ heading: 'A', body: 'B' }] })).toBeNull();
    expect(sanitiseNewsletter(null)).toBeNull();
  });
});

describe('newsletterDocument', () => {
  it('builds logo + heading/text pairs in order', () => {
    const doc = newsletterDocument(
      BRAND,
      { gymName: 'Forge', logoUrl: 'https://x/logo.png' },
      {
        subject: 'News',
        sections: [
          { heading: 'Holiday hours', body: 'We close 24–27 Dec.' },
          { heading: 'Barbell club', body: 'Tuesdays 7pm, all welcome.' },
        ],
      },
    );
    expect(doc.blocks.map((b) => b.type)).toEqual([
      'image',
      'heading',
      'text',
      'heading',
      'text',
    ]);
    expect((doc.blocks[1] as { text: string }).text).toBe('Holiday hours');
    expect((doc.blocks[4] as { text: string }).text).toBe(
      'Tuesdays 7pm, all welcome.',
    );
  });

  it('skips the logo block when the gym has none', () => {
    const doc = newsletterDocument(BRAND, { gymName: 'Forge', logoUrl: null }, {
      subject: 'News',
      sections: [{ heading: 'One thing', body: 'Just the one thing this week.' }],
    });
    expect(doc.blocks.map((b) => b.type)).toEqual(['heading', 'text']);
  });
});
