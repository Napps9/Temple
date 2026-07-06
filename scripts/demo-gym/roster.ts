// Fixed personas + deterministic randomness for the demo-gym seeder.
// Everything the plan builder randomises flows through mulberry32, so
// the same --seed always produces byte-identical output.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// RFC-4122-shaped v4 uuid drawn from the seeded RNG, so every id in a
// plan is stable for a given seed (Postgres only checks the format).
export function demoUuid(rng: Rng): string {
  const hex = '0123456789abcdef';
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += hex[8 + Math.floor(rng() * 4)];
    else out += hex[Math.floor(rng() * 16)];
  }
  return out;
}

export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.floor(rng() * items.length)];
}

export function rngInt(rng: Rng, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1));
}

export const OWNER = { first: 'Sam', last: 'Okafor' };
export const COACHES = [
  { first: 'Priya', last: 'Sharma' },
  { first: 'Callum', last: 'Reid' },
] as const;

const FIRST_NAMES = [
  'Alice', 'Ben', 'Chloe', 'Dan', 'Ella', 'Finn', 'Grace', 'Harry',
  'Isla', 'Jack', 'Katie', 'Liam', 'Mia', 'Noah', 'Olivia', 'Pete',
  'Quinn', 'Rosie', 'Sean', 'Tara', 'Umar', 'Violet', 'Will', 'Xena',
  'Yusuf', 'Zoe', 'Aaron', 'Beth', 'Carl', 'Daisy', 'Ed', 'Freya',
  'George', 'Holly', 'Ivan', 'Jess', 'Kyle', 'Lucy', 'Max', 'Nina',
  'Oscar', 'Poppy', 'Rhys', 'Sofia', 'Tom', 'Una', 'Vince', 'Wendy',
  'Xander', 'Yara', 'Zack', 'Amara', 'Bruno', 'Carmen', 'Dev', 'Elin',
  'Felix', 'Gemma', 'Hugo', 'Ines',
] as const;

const LAST_NAMES = [
  'Adams', 'Brown', 'Clarke', 'Davies', 'Evans', 'Foster', 'Green',
  'Hughes', 'Irwin', 'Jones', 'Khan', 'Lewis', 'Murray', 'Nolan',
  'Owens', 'Patel', 'Quirke', 'Roberts', 'Smith', 'Taylor', 'Usman',
  'Vaughan', 'Walsh', 'Young', 'Ahmed', 'Bishop', 'Carter', 'Dunne',
  'Ellis', 'Ford',
] as const;

// Distinct pairs by construction: first names cycle at a different
// modulus than last names.
export function memberNames(count: number): { first: string; last: string }[] {
  const out: { first: string; last: string }[] = [];
  for (let i = 0; i < count; i++) {
    out.push({ first: FIRST_NAMES[i % FIRST_NAMES.length], last: LAST_NAMES[i % LAST_NAMES.length] });
  }
  return out;
}

export const MAX_MEMBERS = FIRST_NAMES.length;

export const TESTIMONIAL_QUOTES = [
  {
    quote: 'I came for the classes and stayed for the people. Fittest I have been in a decade.',
    name: 'Rosie T.',
  },
  {
    quote: 'The coaching is what sets this place apart — every session someone is watching your form.',
    name: 'Jack M.',
  },
  {
    quote: 'Joined for Hyrox prep and knocked eleven minutes off my race time in four months.',
    name: 'Amara K.',
  },
] as const;

export const DEMO_ADDRESS = 'Unit 4, Foundry Trading Estate\nBridge Road\nLeeds LS10 1DN';
export const DEMO_HOURS_TEXT = 'Mon-Fri 6am-9pm\nSat 8am-2pm';

export const LEAD_NAMES = [
  'Megan Pryce', 'Tomasz Kowalski', 'Aisha Bello', 'Rob Jenkins',
  'Steph Curran', 'Leon Baptiste', 'Hannah Moore', 'Dylan Rees',
  'Fatima Zahra', 'Craig Donnelly',
] as const;

export const PENDING_NAMES = [
  'Paula Marsh', 'Kofi Mensah', 'Ruth Bergman', 'Stan Kowal', 'Tessa Wright',
] as const;

// Scripted DM threads: index into the coach list + a fixed exchange.
// 'in' = member → coach, 'out' = coach → member.
export const DM_SCRIPTS: { coachIndex: 0 | 1; lines: { dir: 'in' | 'out'; body: string }[] }[] = [
  {
    coachIndex: 0,
    lines: [
      { dir: 'in', body: 'Hey Priya, my shoulder was a bit sore after yesterday — should I skip the press tomorrow?' },
      { dir: 'out', body: 'Good shout flagging it. Come in anyway and we will sub in some tempo rows, no overhead work.' },
      { dir: 'in', body: 'Perfect, thanks. See you at 6.' },
      { dir: 'out', body: 'See you then. Log how it feels after, please.' },
    ],
  },
  {
    coachIndex: 1,
    lines: [
      { dir: 'in', body: 'Callum — any space left on the Saturday Hyrox sim?' },
      { dir: 'out', body: 'Two spots as of this morning. Book in the app and bring a towel, it is a sweaty one.' },
      { dir: 'in', body: 'Booked. What time should I arrive for the briefing?' },
    ],
  },
  {
    coachIndex: 0,
    lines: [
      { dir: 'out', body: 'Nice work on the squat PR today — that was a big jump. How are the legs feeling?' },
      { dir: 'in', body: 'Honestly? Like concrete. Worth it though!' },
    ],
  },
];
