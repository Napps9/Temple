# A Contra-flavoured look for Temple

Exploration, not shipped. Nothing here is wired into the app: eight static
HTML boards rendered to PNG so the direction can be judged before any code
moves. Open `png/*.png`; everything else is the machinery.

**Second pass.** The first version was built from memory of contra.com and
got the register wrong in three specific ways — uppercase grotesque wordmark
in a rounded tile, warm cream palette, Luma-style timeline rails. This
version is built against actual screenshots of the marketing site, the
logged-in app and the Contra Labs lockup. Both versions are in git history;
only this one is on disk.

---

## What the reference actually does

1. **A bold lowercase serif wordmark next to one small solid geometric
   glyph.** Two parts, no container tile, no illustration. The serif carries
   all the warmth; nothing else in the product is serif.
2. **Monochrome chrome, cool not warm.** White surfaces on a cool near-white
   ground (`#F7F7F8`), hairline borders, near-black ink. Colour arrives from
   *content* — imagery, avatars, one iridescent orb — never from furniture.
3. **One sans for everything else.** Headings, body, numbers, labels.
4. **Selected ≠ filled.** The selected nav row is a raised white card; the
   selected filter is a soft tint. Nothing gets an ink fill just for being
   active.
5. **Small radii and pill buttons.** 12–16px on cards and controls, fully
   round on buttons and chips, tiny letterspaced caps for section labels.
6. **Full-bleed image cards.** White text over a scrim, a pill CTA, and an
   overlapping stack of the faces already involved.
7. **An iridescent orb** marks anything the machine is doing, with a soft
   pastel bloom behind the box you talk to it in.
8. **A three-column app shell**: sidebar, working column, right rail of what
   is happening now.

## Applied to Temple

| Reference move | Where it lands |
|---|---|
| Serif lowercase wordmark + solid glyph | `temple` in Fraunces beside a Portico mark |
| Cool monochrome ground | `#F1F5F9` slate → `#F7F7F8`; shadows → hairlines |
| One sans | Geist, 40px display down to an 11px caps label |
| Raised-card selected state | Day strip, sidebar nav, filter chips |
| Full-bleed cards with faces | The three paths on `/get-started` |
| Avatar stacks | Every class row — who is already in |
| The orb + bloom | The Timeline agent and its composer |
| Three-column shell | The staff area on desktop |

Two deliberate departures, both flagged on the boards:

- **The primary action keeps the gym's colour.** The reference's primary
  button is near-black; Temple sells "make it look like your gym", so the
  accent stays on the one action a page exists for. It is a single token if
  you would rather it were ink. Repeated row actions (five Book buttons in a
  list) are already ink, because five brand-coloured pills is a wash, not an
  accent.
- **Dark mode.** Every screenshot is light. The dark palette is derived, not
  observed.

## The boards

| File | What it shows |
|------|---------------|
| `png/01-identity.png` | Four mark directions, lockup on both grounds, icon sizes, palette |
| `png/02-type-controls.png` | Fraunces + Geist, the scale, every control light + dark, where the accent is allowed |
| `png/03-landing.png` | `/get-started` — the three paths as full-bleed cards |
| `png/04-member-book.png` | Member Book — day strip, filters, agenda with avatar stacks |
| `png/05-member-track.png` | Member Track — streaks, 12-week heatmap, tool tiles |
| `png/06-owner-timeline.png` | Owner Timeline — receipts, the orb, the glowing composer |
| `png/07-staff-desktop.png` | Manage/Members in the three-column shell, light and dark |
| `png/08-before-after.png` | Member Book today vs proposed, both schemes |

## Open questions

- **The mark.** Portico is recommended — it is the only one of the four that
  still reads as a building at 15px and cannot be mistaken for a letter (the
  first attempt at an arch read as a lowercase `n` beside a lowercase
  wordmark). Doorway is bolder and more generic; Pediment is the most
  abstract.
- **Lowercase wordmark.** `temple`, not `TEMPLE`. It is a real change in
  voice — warmer, less monumental.
- **The sidebar.** Moving staff from a top pill bar to a left sidebar is the
  largest structural change here and the one with real routing work behind
  it.
- **Icons.** Hand-drawn monoline set on these boards rather than Ionicons.
  A real swap means picking a shipped set.

## If it were to ship

1. `tailwind.config.js` — the cool neutral ramp as tokens; delete the three
   `boxShadow` entries.
2. `src/global.css` — the ramp per scheme.
3. `src/lib/theme.ts` — `screenBg` and icon tints onto the new ramp.
4. Load Geist + Fraunces via `expo-font`; `fontFamily.serif` for the
   wordmark only.
5. Sweep `bg-white dark:bg-gray-900 … shadow-card` to the new `card` idiom.
   The single most repeated string in the app, and the bulk of the work.
6. Surfaces highest-traffic first: Book, Timeline, Track, Manage.
7. Sidebar shell for `(staff)` on desktop — separate, larger piece.

## Rebuilding the boards

```bash
cd docs/design/contra-refresh
node build.mjs   # writes 0*.html
node shot.mjs    # screenshots them to png/ at 2x
node shot.mjs 04 # just one board
```

`system.css` is the proposed design system; `legacy.css` approximates
today's app for the before/after board. `fonts/` holds the woff2 files (all
SIL OFL) with `fonts.css` pointing at them locally, so a rebuild does not
depend on Google Fonts serving the same URLs.
