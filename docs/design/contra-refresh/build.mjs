// Builds every board. Run: node build.mjs && node shot.mjs
import { writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { identityBoard, typeBoard, pagePatternsBoard, modalSystemBoard } from './b-foundation.mjs';
import { authBoard, bookBoard, planStoreBoard, trackBoard, healthBoard, inboxBoard, accountBoard } from './b-member.mjs';
import { timelineBoard, classesBoard, programmingBoard, membersBoard, moneyBoard, commsBoard, desktopBoard } from './b-staff.mjs';
import { statesBoard, beforeAfterBoard } from './b-states.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

const PAGES = [
  ['01-identity', identityBoard],
  ['02-type-controls', typeBoard],
  ['03-page-patterns', pagePatternsBoard],
  ['04-modal-system', modalSystemBoard],
  ['05-auth', authBoard],
  ['06-member-book', bookBoard],
  ['07-member-money', planStoreBoard],
  ['08-member-track', trackBoard],
  ['09-member-health', healthBoard],
  ['10-member-inbox', inboxBoard],
  ['11-member-account', accountBoard],
  ['12-staff-timeline', timelineBoard],
  ['13-staff-classes', classesBoard],
  ['14-staff-programming', programmingBoard],
  ['15-staff-members', membersBoard],
  ['16-staff-money', moneyBoard],
  ['17-staff-comms', commsBoard],
  ['18-staff-desktop', desktopBoard],
  ['19-states', statesBoard],
  ['20-before-after', beforeAfterBoard],
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
