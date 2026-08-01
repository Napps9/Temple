// What a send actually did, said once each.
//
// The report used to draw seven stat tiles unconditionally, four of them
// percentages. At one recipient that reads "SUCCESSFUL 100%" and "OPENED
// 100%" — which are not rates, they are a way of spelling "1", with the
// honest number ("1 of 1 arrived") demoted to the subtitle underneath.
// And the four zeros an untroubled send produces are four tiles carrying
// no information, which is how a reader learns to stop looking.
//
// Three rules, and they are the whole module:
//
//   1. THE VALUE IS A COUNT. A percentage is a supporting detail, never
//      the headline. A count is true at every size of gym; a rate needs a
//      denominator big enough to have earned the precision it implies.
//
//   2. A RATE APPEARS ONLY WHEN IT SAYS MORE THAN THE FRACTION DOES.
//      Below ten recipients "3 of 8" is both shorter and more honest than
//      "38%", which invents a resolution the sample has not got.
//
//   3. NOTHING WENT WRONG IS NOT A NUMBER. Bounced, unsubscribed and
//      held-back tiles appear when they are non-zero and are absent
//      otherwise — they earn their place by having something to say.
//      This is the one rule with a real cost: an owner cannot confirm at
//      a glance that bounces were zero rather than unmeasured. The
//      unmeasured case is why, and it is handled separately and loudly:
//      `unmeasured` collapses the whole card to one sentence rather than
//      printing six em-dashes that each look like a zero.

export type ReportFigure = {
  value: string;
  label: string;
  detail?: string;
};

export type ReportTile = {
  label: string;
  value: string;
  detail?: string;
  tone?: 'default' | 'red' | 'muted';
};

export type CampaignReport = {
  hero: ReportFigure;
  tiles: ReportTile[];
};

export type CampaignStats = {
  recipients: number;
  sent: number;
  successful: number;
  simulated: number;
  failed: number;
  skipped: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  tracked: boolean;
};

// Below this the fraction is the clearer statement. Ten is where a single
// person stops moving the percentage by more than ten points, which is
// the point at which a rate starts describing the audience rather than
// the arithmetic.
export const RATE_AT = 10;

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

// "of 86 sent · 84%" or just "of 8 sent". The rate rides along as a
// detail when the denominator can carry it, and never as the value.
function outOf(n: number, total: number, noun: string): string {
  const base = `of ${total} ${noun}`;
  if (total < RATE_AT || total === 0) return base;
  return `${base} · ${Math.round((n / total) * 100)}%`;
}

export function campaignReport(s: CampaignStats): CampaignReport {
  const tiles: ReportTile[] = [];

  // Simulated sends never reached a provider, so every downstream number
  // is about nothing. Say that once instead of six times.
  const fullySimulated = s.sent > 0 && s.simulated === s.sent;
  if (fullySimulated) {
    return {
      hero: {
        value: String(s.sent),
        label: plural(s.sent, 'test send', 'test sends'),
        detail: 'Nothing left the building — no email provider was configured.',
      },
      tiles: [],
    };
  }

  // Arrival is the headline when it is known. When it is not, the honest
  // headline is what left, and the card says why the rest is missing
  // rather than showing dashes where numbers go.
  const hero: ReportFigure = s.tracked
    ? {
        value: String(s.successful),
        label: 'arrived',
        detail: outOf(s.successful, s.sent, 'sent'),
      }
    : {
        value: String(s.sent),
        label: plural(s.sent, 'email sent', 'emails sent'),
        detail: 'Whether they arrived is not being measured.',
      };

  // Opens and clicks are read against what arrived, not what left, so a
  // bad address does not quietly count as a person who ignored you.
  const base = s.tracked && s.successful > 0 ? s.successful : s.sent;
  const reach = s.tracked && s.successful > 0 ? 'arrived' : 'sent';

  tiles.push({
    label: 'Opened',
    value: String(s.opened),
    detail: outOf(s.opened, base, reach),
    tone: s.opened === 0 ? 'muted' : 'default',
  });

  tiles.push({
    label: 'Clicked',
    value: String(s.clicked),
    detail: outOf(s.clicked, base, reach),
    tone: s.clicked === 0 ? 'muted' : 'default',
  });

  // Everything below here appears only when it has something to say.
  //
  // These come off their own columns rather than off `recipients - sent`.
  // The difference is not one thing: it is `failed` plus `skipped` plus
  // whatever is still in flight, and a derived tile would have counted
  // the same recipient twice beside the explicit ones. Addresses that
  // have bounced before never appear here at all — 0229 subtracts the
  // suppression list when the audience is built, so they are not
  // recipients of this send in the first place.
  if (s.bounced > 0) {
    tiles.push({
      label: 'Bounced',
      value: String(s.bounced),
      detail: plural(s.bounced, 'now suppressed', 'now suppressed'),
      tone: 'red',
    });
  }

  if (s.complained > 0) {
    tiles.push({
      label: 'Marked as spam',
      value: String(s.complained),
      detail: 'now suppressed',
      tone: 'red',
    });
  }

  if (s.unsubscribed > 0) {
    tiles.push({
      label: 'Unsubscribed',
      value: String(s.unsubscribed),
      detail: 'after this send',
      tone: 'red',
    });
  }

  if (s.failed > 0) {
    tiles.push({
      label: 'Never sent',
      value: String(s.failed),
      detail: 'rejected at the door',
      tone: 'red',
    });
  }

  // Not a failure — an owner pressed stop mid-send, which is a feature.
  // Muted rather than red for exactly that reason.
  if (s.skipped > 0) {
    tiles.push({
      label: 'Held back',
      value: String(s.skipped),
      detail: 'the send was stopped',
      tone: 'muted',
    });
  }

  return { hero, tiles };
}
