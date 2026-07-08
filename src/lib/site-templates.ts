// Named starting points for a gym's website — the same registry role
// brand-themes.ts plays for themes, and paired 1:1 with those themes.
// Each template follows the researched multi-page gym-site structure:
// a Home page that pitches, proves and converts (hero → about →
// testimonials → location → contact), plus dedicated Schedule, Team
// and Pricing pages for the three things that carry real,
// information-dense live data and benefit from room of their own
// rather than being buried partway down a single long page.
// schedule/pricing/team populate themselves from the gym's real data
// regardless of which page they're on.
//
// Two deliberate gaps: testimonials ship with zero quotes and
// location with an empty address, so the existing publish-blocking
// warnings become the owner's launch checklist — fabricated member
// quotes or a missing address can never go live. Heroes default to
// typographic (layout 'background', no image): a big headline over
// the theme colour reads as designed on its own, and the same layout
// also supports a background photo once one's set (see
// site-auto-images.ts, which fills the hero image and a gallery from
// the gym's own class types at site-creation time) — the 'side'
// layout looks broken without a photo, so templates never use it.

import type { ThemeId } from './brand-themes';
import {
  createBlock,
  emptyPage,
  type AboutBlock,
  type ContactBlock,
  type HeroBlock,
  type LocationBlock,
  type PricingBlock,
  type ScheduleBlock,
  type SiteDocument,
  type TeamBlock,
  type TestimonialsBlock,
} from './site-blocks';

export type SiteTemplateId = 'strength' | 'combat' | 'studio' | 'coaching';

export type SiteTemplate = {
  id: SiteTemplateId;
  name: string;
  description: string;
  themeId: ThemeId;
  build: (gymName?: string) => SiteDocument;
};

type TemplateCopy = {
  hero: {
    headline: (name: string) => string;
    headlineFallback: string;
    subheadline: string;
    ctaLabel: string;
    ctaTarget: 'join' | 'contact';
  };
  about: { heading: string; body: string };
  scheduleHeading: string;
  teamHeading: string;
  pricingHeading: string;
  testimonialsHeading: string;
  locationHeading: string;
  contact: { heading: string; subheading: string };
};

// Structural defaults (ids, hiddenPlanIds, layouts…) stay owned by
// createBlock — the single source of truth the coercers mirror — so
// every built document round-trips through coerceDocument unchanged.
function buildFromCopy(themeId: ThemeId, copy: TemplateCopy, gymName?: string): SiteDocument {
  const name = gymName?.trim();

  const hero = createBlock('hero') as HeroBlock;
  hero.headline = name ? copy.hero.headline(name) : copy.hero.headlineFallback;
  hero.subheadline = copy.hero.subheadline;
  hero.ctaLabel = copy.hero.ctaLabel;
  hero.ctaTarget = copy.hero.ctaTarget;

  const about = createBlock('about') as AboutBlock;
  about.heading = copy.about.heading;
  about.body = copy.about.body;

  const schedule = createBlock('schedule') as ScheduleBlock;
  schedule.heading = copy.scheduleHeading;

  const team = createBlock('team') as TeamBlock;
  team.heading = copy.teamHeading;

  const pricing = createBlock('pricing') as PricingBlock;
  pricing.heading = copy.pricingHeading;

  const testimonials = createBlock('testimonials') as TestimonialsBlock;
  testimonials.heading = copy.testimonialsHeading;

  const location = createBlock('location') as LocationBlock;
  location.heading = copy.locationHeading;

  const contact = createBlock('contact') as ContactBlock;
  contact.heading = copy.contact.heading;
  contact.subheading = copy.contact.subheading;

  return {
    version: 2,
    settings: { themeId },
    pages: [
      { ...emptyPage('Home', ''), blocks: [hero, about, testimonials, location, contact] },
      { ...emptyPage('Schedule', 'schedule'), blocks: [schedule] },
      { ...emptyPage('Team', 'team'), blocks: [team] },
      { ...emptyPage('Pricing', 'pricing'), blocks: [pricing] },
    ],
  };
}

const STRENGTH_COPY: TemplateCopy = {
  hero: {
    headline: (name) => `Stronger starts at ${name}`,
    headlineFallback: 'Stronger starts here',
    subheadline:
      'Coached strength and conditioning for every level — turn up, work hard, get results. Your first class is free.',
    ctaLabel: 'Book a free class',
    ctaTarget: 'join',
  },
  about: {
    heading: 'Why we built this gym',
    body: "We built this gym for people who want to train properly: coached sessions, smart programming and a standard you can't help but rise to. Whether you're brand new to the barbell or chasing a new PB, every session is scaled to where you are and built to move you forward. Come in for a free class and see what training with intent feels like.",
  },
  scheduleHeading: 'Train with us this week',
  teamHeading: 'Your coaches',
  pricingHeading: 'Simple, honest pricing',
  testimonialsHeading: 'Member results',
  locationHeading: 'Find the gym',
  contact: {
    heading: 'Ready to get to work?',
    subheading: "Tell us about your goals and we'll get you booked in for your first free session.",
  },
};

const COMBAT_COPY: TemplateCopy = {
  hero: {
    headline: (name) => `Train like a fighter at ${name}`,
    headlineFallback: 'Train like a fighter',
    subheadline:
      'Real coaching, real discipline and a first class that costs you nothing but effort. Beginners welcome — egos left at the door.',
    ctaLabel: 'Start with a free class',
    ctaTarget: 'join',
  },
  about: {
    heading: 'Respect the craft',
    body: "Fight training builds more than fitness — it builds discipline, composure and a confidence that follows you out of the gym. Our coaches hold a high standard and teach proper technique from day one, whether you're here to compete or just to train like you mean it. Every fighter in this gym started with a first class.",
  },
  scheduleHeading: 'This week on the mats',
  teamHeading: 'Your coaches',
  pricingHeading: 'Membership, no hidden fees',
  testimonialsHeading: 'From our fighters',
  locationHeading: 'Find the gym',
  contact: {
    heading: 'Ready to step in?',
    subheading:
      "Tell us a bit about yourself — total beginners welcome. We'll get back to you and find you the right first class.",
  },
};

const STUDIO_COPY: TemplateCopy = {
  hero: {
    headline: (name) => `Move well, feel better at ${name}`,
    headlineFallback: 'Move well, feel better',
    subheadline:
      "Small classes, welcoming faces and space to breathe — however long it's been, you'll fit right in. Your first class is on us.",
    ctaLabel: 'Book your first class',
    ctaTarget: 'join',
  },
  about: {
    heading: 'Our story',
    body: "We opened this studio to be the kind of place we always looked for: expert teaching without the intimidation, movement that leaves you feeling better than when you arrived, and a community that learns each other's names. Classes stay small so you're never just a face in the crowd — come as you are, start where you are.",
  },
  scheduleHeading: 'This week at the studio',
  teamHeading: 'Meet your instructors',
  pricingHeading: 'Memberships & passes',
  testimonialsHeading: 'Kind words',
  locationHeading: 'Visit us',
  contact: {
    heading: "We'd love to meet you",
    subheading:
      "Questions about classes, memberships or where to begin? Send us a note and we'll help you find your first class.",
  },
};

// The one consult-first funnel: its CTA scrolls to the contact form
// (#contact) instead of the join page — PT enquiries start with a
// conversation, not a class booking.
const COACHING_COPY: TemplateCopy = {
  hero: {
    headline: (name) => `Coaching built around you — welcome to ${name}`,
    headlineFallback: 'Coaching built around you',
    subheadline:
      "Qualified coaches, a plan written for your body and your life, and support that doesn't stop when the session ends. Start with a free consultation — no pressure, no hard sell.",
    ctaLabel: 'Book a free consult',
    ctaTarget: 'contact',
  },
  about: {
    heading: "Who you'll be working with",
    body: "Good coaching starts with listening. Before we write a single session, we take the time to understand your history, your goals and how training has to fit around real life. Our coaches are qualified, experienced and honest about what it takes — whether you're returning from injury, starting from scratch or chasing a specific number, we'll meet you where you are and build from there.",
  },
  scheduleHeading: 'Weekly sessions',
  teamHeading: 'Your coaching team',
  pricingHeading: 'Coaching options',
  testimonialsHeading: 'Client stories',
  locationHeading: 'Where we train',
  contact: {
    heading: 'Start with a conversation',
    subheading:
      "Tell us where you're at and what you'd like to change. We'll come back with honest advice and a suggested next step.",
  },
};

export const SITE_TEMPLATES: Record<SiteTemplateId, SiteTemplate> = {
  strength: {
    id: 'strength',
    name: 'Strength & Conditioning',
    description: 'Direct, results-first copy for strength, CrossFit and functional fitness gyms.',
    themeId: 'forged',
    build: (gymName) => buildFromCopy('forged', STRENGTH_COPY, gymName),
  },
  combat: {
    id: 'combat',
    name: 'Fight & Combat',
    description: 'Disciplined, intense copy for boxing, MMA and martial arts gyms.',
    themeId: 'ringside',
    build: (gymName) => buildFromCopy('ringside', COMBAT_COPY, gymName),
  },
  studio: {
    id: 'studio',
    name: 'Boutique Studio',
    description: 'Calm, welcoming copy for yoga, Pilates and boutique studios.',
    themeId: 'daybreak',
    build: (gymName) => buildFromCopy('daybreak', STUDIO_COPY, gymName),
  },
  coaching: {
    id: 'coaching',
    name: 'Coaching & PT',
    description: 'Personal, trust-first copy for personal trainers and coaching studios.',
    themeId: 'baseline',
    build: (gymName) => buildFromCopy('baseline', COACHING_COPY, gymName),
  },
};

export const SITE_TEMPLATE_LIST: SiteTemplate[] = Object.values(SITE_TEMPLATES);

export function isSiteTemplateId(v: unknown): v is SiteTemplateId {
  return typeof v === 'string' && v in SITE_TEMPLATES;
}

// Pre-fills the stock-photo picker's search per archetype. Keyed by
// theme (documents store only settings.themeId, and themes pair 1:1
// with templates). "weightlifting" not "CrossFit" — trademarked.
export const DEFAULT_STOCK_QUERIES: Record<ThemeId, string> = {
  forged: 'weightlifting gym',
  ringside: 'boxing training',
  daybreak: 'yoga studio',
  baseline: 'personal trainer',
};
