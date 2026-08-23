# A Contra-flavoured look for Temple

Twenty-six static HTML boards rendered to PNG. Boards 01-21 are the
proposal, drawn so the direction could be judged before any code moved;
22-26 are the record of what has since shipped. Open `png/*.png`;
everything else is the machinery. Where a board and the app disagree, the
app is right — see **Shipping it** at the bottom for what is live.

**Third pass.** The first version was built from memory of contra.com and
got the register wrong. The second was rebuilt against real screenshots.
This one applies it to every surface — and, more importantly, replaces
"redesign each screen" with a set of patterns each screen is an instance
of.

---

## The spine: eight page shapes, one modal

Temple has ~95 routes and 26 modal components. They are not 95 designs.

**Eight page patterns** (`png/03-page-patterns.png`), each assembled from
the same six parts in the same order — bar · page head · filters · section
label · rows or cards · foot:

| # | Pattern | The rule | Surfaces |
|---|---------|----------|----------|
| 1 | Feed | Receipts are ruled lines; only a decision gets a card. Composer at the foot. | Timeline, Inbox, Lead conversation |
| 2 | Agenda | Time in a gutter, one card per thing. Never an hourly grid on a phone. | Book, Classes, Bookings, Attendance, Programming |
| 3 | Directory | Search, filters, one row shape. Rows on a ground when tappable; rows in one ruled card when it is a table. | Members, Leads, Plans, Products, Movements, Roster, Team, Tasks |
| 4 | Record | Identity block, tabs, facts, related lists. Actions in the header. | Member profile, Movement, Workout, Plan, Campaign, Product |
| 5 | Dashboard | Numbers first, split by hairlines, then the list that explains them. | Manage insights, Analysis, Coach earnings, Attendance, Track |
| 6 | Settings | One card per decision, each with its own save. | Gym settings, Branding, Account, Comms, Website, Store |
| 7 | Form | One job, top to bottom. Back replaces the nav; the action sticks to the foot. | Sign in, Create gym, PAR-Q, Waiver, Injury check, Invite, Onboarding |
| 8 | Workspace | A canvas and an inspector. Desktop-first; the inspector is a sheet on a phone. | Programming editor, Website editor, Campaign composer |

**One modal** (`png/04-modal-system.png`): a **sheet on a phone, a dialog
on a desktop**. Same title, same body, same actions, same order — only the
container changes. Four sizes (confirm · form · detail · takeover), and a
written rule for the destructive case: the title is the question, the body
is the consequence, red appears once, and the safe option is named
("Keep the class", never "Cancel" in a cancel dialog).

Plus **four states every pattern owes you** (`png/20-states.png`): nothing
yet, nothing matches, loading, and failed — four genuinely different
screens, not one spinner.

And **one glyph for the machine** (`png/05-ai-mark.png`): the iridescent
orb was lifted almost verbatim from the reference, so it is replaced by the
four-point sparkle — the one glyph nobody has to be taught. It is not
distinctive, and it is not meant to be: what makes it Temple's is that it
is solid among thirty monoline icons, and that it takes a rounded-square
tile where every person in the product is a circle. Ink on light, paper on
dark, never the gym's colour. Six alternatives are on the board, including
a subtly recut sparkle that is one line to switch to.

## The visual system

- **Cool monochrome.** White surfaces on `#F7F7F8`, hairline `#E9E9EE`
  borders, `#14161A` ink. Shadows only on things that float.
- **Two faces.** Fraunces for the lowercase `temple` wordmark — one place
  only. Geist for the entire product.
- **Selected is never an ink fill.** A raised white card or a soft tint.
- **Colour comes from content.** The accent is allowed on exactly four
  things: the one primary action per page, class-type dots, a member's
  own data, and the gym's photography. Repeated row actions (five Book
  buttons) are ink. It used to be five — the logo tile was the fifth, and
  it was the gym's colour rather than Temple's; gyms no longer recolour
  the chrome, so the accent is `#C2410C` / `#F0783C` for everyone.
- **One mark for the machine.** Anything the agent did carries the sparkle
  and nothing else — one glyph across the product instead of five amber
  banners. It is the only solid-filled icon among ~30 monoline ones, and in
  avatar slots it takes a rounded-square tile because every person in the
  product is a circle. Shape and weight do the work that the glyph itself,
  being the industry's, cannot.

## The boards

| File | What it shows |
|------|---------------|
| `01-identity` | Four mark directions, lockup, icon sizes, palette |
| `02-type-controls` | Fraunces + Geist, the scale, every control light + dark |
| `03-page-patterns` | **The eight shapes, the rule for each, the surfaces that use them** |
| `04-modal-system` | **Sheet vs dialog, four sizes, the destructive confirm in full** |
| `05-ai-mark` | **Seven candidates for the machine's glyph, in every context it appears** |
| `06-auth` | Landing, sign in, start a gym, accept an invite |
| `07-member-book` | Book (light + dark), Programming, My bookings |
| `08-member-money` | Membership, Store, buying, Purchases |
| `09-member-track` | Track, a movement, Journal, recording |
| `10-member-health` | Consent, PAR-Q, waiver signing, injury check-in |
| `11-member-inbox` | Inbox, a notice, a thread, empty |
| `12-member-account` | Account, leaving, family, email preferences |
| `13-staff-timeline` | Today, your rules, a past day |
| `14-staff-classes` | Classes, new class, the roster, cancelling |
| `15-staff-programming` | The week, a session, Analysis |
| `16-staff-members` | Members, a member, inviting, tags |
| `17-staff-money` | Plans, Billing, Coach earnings, Refund |
| `18-staff-comms` | Communications, a campaign, Leads, a conversation |
| `19-staff-desktop` | The three-column shell, Members and Settings, light + dark |
| `20-states` | **Nothing yet · nothing matches · loading · failed** |
| `21-before-after` | Member Book today vs proposed |
| `22-modals-shipped` | **Record** — the ten modals that moved onto Sheet |
| `23-decisions` | **Record** — the four decisions, as answered |
| `24-shared-parts` | **Record** — the chip, the four states, the icon tints |
| `25-staff-rail` | **Record** — the sidebar at 768 and up |
| `26-lead-settings` | **Record** — the first staff surface on the page parts |

## Deliberate departures from the reference

- **Dark mode is derived, not observed** — every screenshot of the
  reference is light. (An earlier departure — "the primary action keeps
  the gym's colour" — was reversed: gyms no longer recolour Temple, and
  the accent is Temple's burnt orange for everyone.)

## Answered (board 23)

- **The mark** — Portico. Straight lines, no enclosing shape, one ink; it
  still reads as a building at 15px and cannot be mistaken for a letter,
  which matters beside a lowercase wordmark.
- **Lowercase `temple`** — yes, in Fraunces 700. No tagline.
- **The sidebar** — yes, at 768 and up. It turned out to be chrome, not
  routing: the tab router underneath is untouched.
- **The accent** — rows are ink, the page's one action carries Temple's
  accent. `Button` gained a `plain` variant for the repeated case.

Still open:

- **Icons.** Hand-drawn monoline set on these boards, not Ionicons.

## Shipping it — where this has got to

1. ~~`tailwind.config.js` — the cool ramp as tokens.~~ **Done.** The old
   `card` / `pop` / `pill` shadows are gone — two shadows remain.
2. ~~`src/lib/theme.ts` — the ramp per scheme.~~ **Done**, including the
   runtime twins for Ionicon tints and SVG fills.
3. ~~Load Geist + Fraunces via `expo-font`.~~ **Done.** React Native has
   no font inheritance and does not synthesise weights, so it needed two
   things rather than a config line: `components/Text.tsx` wraps Text and
   TextInput (188 files import it instead of react-native's), and every
   font-weight utility in `tailwind.config.js` carries its own file.
4. ~~Build the page parts as components.~~ **Done**: `PageHead`,
   `SectionLabel`, `ListRow`/`RuledList`, `SettingCard`, `AIMark`, `Check`.
5. ~~One modal that renders a sheet under 768 and a dialog above it.~~
   **Done** — `Sheet` + `SheetAction`, breakpoint in `lib/breakpoint.ts`.
   All 22 bespoke ones are retired (boards 22 and 26), including the four
   nested Modals inside `RecordWorkoutModal` and the three inside
   `SiteEditor`. Two are deliberately not sheets: `ImageGalleryModal` is
   a full-bleed pinch-and-pan viewer with its own gesture root, and
   `DurationField`'s picker is a popover anchored to its field.
   Board 04's other half — a modal never opens another modal — is done
   for the biggest offender: Record a workout's four nested sheets are
   steps of one sheet (board 33). `Sheet` gained `onBack` for it.
6. The app shell: ground colour and the nav rail. **Done.**
7. **The neutral ramp, everywhere.** **Done to zero**, from 5,604.
   The same is now true of the radii: 351 stray rounded-* utilities
   swept onto the two-radius system, with only the four chat-bubble
   tails keeping their deliberate shape.
8. **The shared components.** **Done**: ChipButton (54 importers),
   BackLink (54), Input (47), EmptyState — which grew the four states
   board 20 defines — plus Avatar, StatTile and CardHeading. The four
   icon tints were a second ramp and are gone; 193 call sites take ink,
   ink-2 or ink-3.
9. **The staff rail.** **Done** — `SideNav` at 1024 and up, chrome only.
   The account menu came out of TopNav so the two navs cannot drift.
   It shipped at 768 and was wrong twice (board 29): the Manage hub and
   the Leads section already had a sidebar of their own at 1024, so a
   desktop window drew two nav columns; and the rail takes 246px before
   the page sees any of it, so at a 768 window the column was 522px
   while every `md:` class inside it fired. There is now one vertical
   nav, it waits for 1024, and `breakpoint.ts` carries both widths plus
   `staffContentWidth()` for the two split views that need the column
   rather than the window.
10. Surfaces, staff first, restructured onto their page pattern and
    consolidated where two screens serve one job. **Started**: Lead
    settings is on the page parts, and the AI Agent tab folded into it —
    four tabs to three, moved as a component so the per-card saves were
    not touched. Then the page head: 41 screens were hand-rolling a
    24px title block and now call `PageHead` (board 27), which also
    settled the padding question — the parts draw none, because every
    screen's ScrollView already carries `px-4`. Then the label (board
    28): one small-caps token instead of 112 hand-written ones at four
    sizes and four weights, with `Input`'s own label — a fifth idiom —
    brought onto it. Then the accent rule finished (board 30): 61
    controls said "picked" by filling with the gym's colour, so on a
    form every answer competed with the one button that did something.
    Then the loading state (board 31): nine list-level spinners became
    skeletons of the rows they stand in for, so the page no longer jumps
    when the data lands, and eight full-screen boot spinners at four
    different colours share one. Then the first consolidation (board
    32): Communications was seven routes for three jobs and is four —
    the automations list and the topics editor are sections, and
    creating a campaign is a button rather than a screen that inserts a
    row and redirects. Then `ListRow` got its first six callers.

    Two consolidations the plan called for are deliberately **not**
    done, because they do not survive reading the code. Member import is
    three importers with genuinely different mechanics (Stripe OAuth +
    plan mapping, a members CSV with column mapping, a workouts CSV with
    movement matching) that already share a doorway; one route switching
    between them is a re-parenting with real risk and no visible gain.
    `track/` is one hub, three record routes and four distinct jobs —
    review my history, compare with the gym, browse movements, manage
    injuries — and merging those makes the hub worse rather than
    smaller.

    The door question was answered: `ListRow` grew a `wrap` prop, a
    `foot` slot and an `IconTile` export, and the doors use it.

    A UX pass then reworked the platform around three outcomes —
    obvious to a first-time user, navigable without prior knowledge,
    key actions in three taps: every nav pill carries its visible
    label at phone width; Tasks, Coach pay and Invite got real doors
    and the search manifest got its four lost surfaces; lead lines
    open their conversation (one tap, was five); booking from the
    class row is one tap with an undo, recording pre-fills from
    today's programming (three taps, was seven), and a coach's day
    leads the Timeline; one `SearchField` replaced eight hand-rolled
    shapes; and view state stopped resetting on remount everywhere
    (tabs, drafts, filters, ranges, expanded cards — module-scope,
    session-only).

    Next, in honesty rather than urgency: `ListRow` now carries the
    movements and bookings directories too, and the other five keep
    their own markup for cause (strike-through task rows, roster fact
    tables, the compound approve/remove member card, plan editor
    cards, calendar cards); `SettingCard` has its first production
    callers (the leaderboard toggles and the privacy card);
    `setup.tsx` keeps its conversational structure (its radii and
    colours now conform; a page-parts rewrite remains unjudged). The
    member-side boards 07-12/21 have landed in full: first the
    no-schema deltas (the member-voiced leave dialog, the
    recommendation as a row chip, honest day dots and a day heading,
    week-grouped bookings with the cancel-policy line, Track's group
    labels, the DM thread's role subtitle and named composer,
    gym-named email preferences, the waiver and injury retention
    lines, Written by attribution on programming), then the
    schema-bearing set: the one-feed inbox with its decision cards,
    the announcement page with staff-only reach counts (0253), store
    aisles with the grid, sheet and bag (0254), the membership
    three-stat row with comps and packs under "Also on your account",
    Account's "Your gyms" and Article-15 "Download everything"
    (0255), the PAR-Q stepper, the journal directory, and the
    movement record's Best hero with tabs. The four items parked as
    proposals then landed too, each on the schema it was waiting
    for: the Payment-method action (stripe-billing-portal opens
    Stripe's hosted card form; the dunning notice's Update card is
    the same exit), store variants and sizes (0256 — per-variant
    stock through checkout, settlement, refund and the sheet's size
    chips), the notice's "What changed for you" block (0257 — an
    announcement links its closure, the close-gym flow posts it,
    the reader sees their own cancelled classes), and the journal's
    training partners (0258 — the avatar stack rides the
    leaderboard consent). Alongside them, the Temple mark left the
    top bar and rail: the gym's name is the identity, and on a
    phone the pills take the row the logo used to rent. The icons
    question is still open, softened by the labels now beside
    every nav glyph.

## Rebuilding

```bash
cd docs/design/contra-refresh
node build.mjs   # writes 01..34.html
node shot.mjs    # screenshots them to png/ at 2x
node shot.mjs 05 # just one board
```

`kit.mjs` holds every shared part — including `AI_CHOICE`, the single
constant that swaps the machine's glyph across all sixteen places it
appears. `b-foundation`, `b-aimark`, `b-member`, `b-staff` and `b-states` hold the
proposal boards; `b-shipped`, `b-decisions`, `b-parts`, `b-rail`,
`b-leads`, `b-heads`, `b-labels`, `b-onerail`, `b-accent`, `b-loading`, `b-email`, `b-steps` and `b-shipped-all` hold the record ones, which are drawn from the code rather than
ahead of it — several of them cover screens behind auth that the exported
bundle cannot photograph. `system.css` is the proposed design
system, `legacy.css` approximates today's app for the before/after.
`fonts/` holds the woff2 files (all SIL OFL) so a rebuild does not depend
on Google Fonts serving the same URLs.
