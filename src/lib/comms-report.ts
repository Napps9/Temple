// How a send went, in sentences (0229).
//
// Pure so the wording is testable on its own: the numbers arrive from
// comms_campaign_stats and every claim made about them is made here.
//
// The one rule the whole module exists to hold: never state a rate the
// data cannot support. A campaign whose delivery reports never arrived
// knows what left and nothing else, and saying "0 arrived" about it would
// be a lie told in the shape of a fact.

export type SendStats = {
  recipients: number;
  sent: number;
  delivered: number;
  successful: number;
  simulated: number;
  failed: number;
  bounced: number;
  complained: number;
  opened: number;
  clicked: number;
  unsubscribed: number;
  skipped: number;
  tracked: boolean;
};

export type SendReport = { title: string; lines: string[] };

// Why a member cannot be emailed (0230). The two reasons want different
// advice, which is the whole reason they are separate values rather than
// one "suppressed" flag: a bounce is usually a mistake worth correcting,
// and a spam complaint is a decision worth respecting.
export type UnreachableReason = 'hard_bounce' | 'complaint';

export function unreachableLabel(reason: UnreachableReason): string {
  return reason === 'complaint' ? 'Marked spam' : 'Email dead';
}

export function unreachableNote(reason: UnreachableReason, name: string): string {
  const first = name.trim().split(/\s+/)[0] || 'This member';
  return reason === 'complaint'
    ? `${first} marked one of your emails as spam, so nothing is sent to them any more. That one is worth leaving alone — message them in Temple if you need to reach them.`
    : `Email to ${first} bounced permanently, so it is held back from every send. Phone them or message them in Temple. If the address was a typo, clearing it under Communications → Settings puts them back on the list.`;
}

function pct(n: number, of: number): number {
  return of > 0 ? Math.round((n / of) * 100) : 0;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

export function sendReport(subject: string, s: SendStats): SendReport {
  const name = subject.trim() || 'That send';

  if (s.sent > 0 && s.simulated === s.sent) {
    return {
      title: `“${name}” was a practice run.`,
      lines: [
        'Nothing actually left the building — verify a sending domain and the next one goes out for real.',
      ],
    };
  }

  if (s.sent === 0) {
    return {
      title: `“${name}” reached nobody.`,
      lines:
        s.failed > 0
          ? [`All ${s.failed} were refused before they left.`]
          : ['Nothing went out.'],
    };
  }

  // Engagement is read against what arrived where we know it, and against
  // what left where we do not — a bad address should not count as a
  // person who ignored you.
  const base = s.tracked && s.successful > 0 ? s.successful : s.sent;
  const lines: string[] = [];

  lines.push(
    `${s.opened} opened it (${pct(s.opened, base)}%) and ${s.clicked} clicked through (${pct(s.clicked, base)}%).`,
  );

  if (!s.tracked) {
    lines.push(
      'No delivery reports came back for this one, so I can tell you what went out and not how much of it arrived.',
    );
  }
  if (s.bounced > 0) {
    lines.push(
      `${s.bounced} bounced — ${plural(s.bounced, 'that address is', 'those addresses are')} held back from future sends.`,
    );
  }
  if (s.complained > 0) {
    lines.push(
      `${s.complained} ${plural(s.complained, 'person', 'people')} marked it as spam.`,
    );
  }
  if (s.unsubscribed > 0) {
    lines.push(
      `${s.unsubscribed} ${plural(s.unsubscribed, 'person', 'people')} unsubscribed.`,
    );
  }
  if (s.failed > 0) {
    lines.push(`${s.failed} never left — the provider refused ${plural(s.failed, 'it', 'them')}.`);
  }
  if (s.skipped > 0) {
    lines.push(`${s.skipped} were skipped because the send was stopped.`);
  }

  return {
    title: s.tracked
      ? `“${name}”: ${s.sent} sent, ${s.successful} arrived.`
      : `“${name}”: ${s.sent} sent.`,
    lines,
  };
}
