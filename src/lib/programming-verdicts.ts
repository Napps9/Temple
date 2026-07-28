// Verdict tiles for the Programming analysis page — the three
// at-a-glance answers to "is the month balanced?" that sit above the
// detail cards. Pure functions over the aggregations the cards
// already compute, so a tile can never disagree with the card below
// it. A verdict is `ok` inside a healthy band and flagged (amber)
// outside it; null means there is no data worth a verdict at all.
//
// The bands are coaching judgement, not physiology, and every one is
// judged on the same number the tile displays — a band edge that
// rounds across the line must not show green with an amber-looking
// value. Push:pull is balanced while the displayed dominant side is
// at most 1.2 : 1; a single time domain owning more than half the
// conditioning is concentration; heavy work between 20–40% of the
// externally-loaded pieces (bodyweight deliberately excluded from
// the denominator) is a sustainable dose. Every caption carries the
// underlying counts — on the flagged branches especially, where thin
// data matters most.

export type Verdict = {
  value: string;
  caption: string;
  ok: boolean;
};

// Max displayed dominant ratio ("1.2 : 1") that still reads balanced.
const PUSH_PULL_MAX_DOMINANCE = 1.2;
const DOMAIN_DOMINANCE_PCT = 50;
const HEAVY_MIN_PCT = 20;
const HEAVY_MAX_PCT = 40;

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function show1(n: number): string {
  const r = round1(n);
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// "1.2 : 1" with the dominant side normalised against 1 — push always
// in the first slot.
export function formatRatio(push: number, pull: number): string {
  if (pull === 0) return `${push} : 0`;
  if (push === 0) return `0 : ${pull}`;
  if (push >= pull) return `${show1(push / pull)} : 1`;
  return `1 : ${show1(pull / push)}`;
}

export function pushPullVerdict(balance: {
  push: number;
  pull: number;
}): Verdict | null {
  const { push, pull } = balance;
  if (push + pull === 0) return null;
  const dominant =
    push === 0 || pull === 0
      ? Infinity
      : Math.max(push, pull) / Math.min(push, pull);
  const ok = round1(dominant) <= PUSH_PULL_MAX_DOMINANCE;
  const drift = push > pull ? 'push-heavy' : 'pull-heavy';
  return {
    value: formatRatio(push, pull),
    caption: `${ok ? 'in balance' : drift} · ${push} push / ${pull} pull`,
    ok,
  };
}

export function topTimeDomainVerdict(
  mix: { key: string; label: string; short?: string; count: number; pct: number }[],
): Verdict | null {
  const total = mix.reduce((n, m) => n + m.count, 0);
  if (total === 0) return null;
  let top = mix[0];
  for (const m of mix) {
    if (m.count > top.count) top = m;
  }
  // Judged on the displayed (rounded) share so the tile can't show
  // "50%" in amber.
  const ok = top.pct <= DOMAIN_DOMINANCE_PCT;
  const pieces = total === 1 ? 'piece' : 'pieces';
  return {
    value: top.short ?? top.label,
    caption: ok
      ? `${top.pct}% of ${total} conditioning ${pieces}`
      : `${top.pct}% of ${total} — one domain dominates`,
    ok,
  };
}

export function heavyShareVerdict(
  mix: { level: string; count: number; pct: number }[],
): Verdict | null {
  // "Loaded pieces" means externally loaded — a gymnastics month full
  // of bodyweight work shouldn't drag the heavy share to zero.
  const loaded = mix.filter((m) => m.level !== 'bodyweight');
  const total = loaded.reduce((n, m) => n + m.count, 0);
  if (total === 0) return null;
  const count = loaded.find((m) => m.level === 'heavy')?.count ?? 0;
  const pct = Math.round((count / total) * 100);
  const ok = pct >= HEAVY_MIN_PCT && pct <= HEAVY_MAX_PCT;
  const caption = ok
    ? `${count} of ${total} loaded pieces`
    : pct > HEAVY_MAX_PCT
      ? `${count} of ${total} — drifting heavy`
      : `${count} of ${total} — little heavy work`;
  return { value: `${pct}%`, caption, ok };
}
