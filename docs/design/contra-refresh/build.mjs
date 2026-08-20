// Builds every board. Run: node build.mjs && node shot.mjs
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { identityBoard, typeBoard, pagePatternsBoard, modalSystemBoard } from './b-foundation.mjs';
import { authBoard, bookBoard, planStoreBoard, trackBoard, healthBoard, inboxBoard, accountBoard } from './b-member.mjs';
import { timelineBoard, classesBoard, programmingBoard, membersBoard, moneyBoard, commsBoard, desktopBoard } from './b-staff.mjs';
import { statesBoard, beforeAfterBoard } from './b-states.mjs';
import { aiMarkBoard } from './b-aimark.mjs';
import { shippedModalsBoard } from './b-shipped.mjs';
import { decisionsBoard } from './b-decisions.mjs';
import { partsBoard } from './b-parts.mjs';
import { railBoard } from './b-rail.mjs';
import { leadsBoard } from './b-leads.mjs';
import { headsBoard } from './b-heads.mjs';
import { labelsBoard } from './b-labels.mjs';
import { oneRailBoard } from './b-onerail.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  ['01-identity', identityBoard],
  ['02-type-controls', typeBoard],
  ['03-page-patterns', pagePatternsBoard],
  ['04-modal-system', modalSystemBoard],
  ['05-ai-mark', aiMarkBoard],
  ['06-auth', authBoard],
  ['07-member-book', bookBoard],
  ['08-member-money', planStoreBoard],
  ['09-member-track', trackBoard],
  ['10-member-health', healthBoard],
  ['11-member-inbox', inboxBoard],
  ['12-member-account', accountBoard],
  ['13-staff-timeline', timelineBoard],
  ['14-staff-classes', classesBoard],
  ['15-staff-programming', programmingBoard],
  ['16-staff-members', membersBoard],
  ['17-staff-money', moneyBoard],
  ['18-staff-comms', commsBoard],
  ['19-staff-desktop', desktopBoard],
  ['20-states', statesBoard],
  ['21-before-after', beforeAfterBoard],
  ['22-modals-shipped', shippedModalsBoard],
  ['23-decisions', decisionsBoard],
  ['24-shared-parts', partsBoard],
  ['25-staff-rail', railBoard],
  ['26-lead-settings', leadsBoard],
  ['27-page-heads', headsBoard],
  ['28-one-label', labelsBoard],
  ['29-one-rail', oneRailBoard],
];

// Drop anything a previous numbering left behind.
const keep = new Set(PAGES.map(([n]) => `${n}.html`));
for (const f of readdirSync(HERE)) {
  if (/^\d\d-.*\.html$/.test(f) && !keep.has(f)) unlinkSync(join(HERE, f));
}

for (const [name, fn] of PAGES) {
  writeFileSync(join(HERE, `${name}.html`), fn());
  console.log('wrote', name);
}
