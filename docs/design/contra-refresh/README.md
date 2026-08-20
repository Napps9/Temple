# "Paper & Ink" — a Contra/Luma-flavoured look for Temple

Exploration, not shipped. Nothing in here is wired into the app: it is a
set of static HTML boards rendered to PNG so the direction can be judged
visually before any code moves.

Open `png/*.png`. Everything else is the machinery that produces them.

---

## The proposal in five lines

1. **Warm neutrals instead of cool slate.** The ground moves from
   `#F1F5F9` (slate-100) to `#F3F1EC` — the cream that is already in the
   Temple logo. Dark mode moves from `#030712` to a warm near-black.
2. **Hairlines instead of shadows.** `shadow-card` / `shadow-pop` /
   `shadow-pill` all go. Depth comes from a 1px `--line` border and a
   one-step tone change (`--surface` → `--surface-2`).
3. **A display face.** Archivo for anything that carries weight
   (page titles, card titles, numbers, the wordmark), Inter Tight for
   dense UI from 16px down. The current single system stack does both
   jobs and neither well.
4. **The gym accent stops being the wash and becomes the press.** Today
   the brand colour fills day pills, Book buttons, filter chips, active
   nav pills and stat icons at once. Proposed: ink carries structural
   emphasis, the gym's colour lands on the primary action, the "for you"
   chip and the logo tile.
5. **One mark, not three stacked cards.** The lockup keeps gold, steel
   and ink — they become the three *grounds* the single mark sits on,
   rather than three layers that have to be drawn every time.

## The boards

| File | What it shows |
|------|---------------|
| `png/01-identity.png` | Five mark directions, lockup on both grounds, app icon / favicon sizes, palette |
| `png/02-type-controls.png` | Three type directions, the resulting scale, every control in light + dark, the same system under five gym colours |
| `png/03-landing.png` | `/get-started` — the logged-out three-path deck |
| `png/04-member-book.png` | Member Book — day strip, filters, next class, the agenda as a Luma-style timeline |
| `png/05-member-track.png` | Member Track — streaks, 12-week heatmap, tool tiles, movement groups |
| `png/06-owner-timeline.png` | Owner Timeline — receipts, "Waiting on you", "With me", the composer |
| `png/07-staff-desktop.png` | Manage / Members at desktop width, light and dark |
| `png/08-before-after.png` | Member Book today vs proposed, both schemes, same data |

## Open questions the mockups deliberately leave open

- **The active nav pill is ink, not the gym's colour.** It makes every
  gym's nav legible regardless of their brand colour, but it takes the
  gym's colour off the most-looked-at control on the page. Worth a
  decision either way.
- **The mark.** Portico is recommended; Pediment is the more literal
  "temple" and the better one at large sizes if the favicon is allowed
  to be a simplified variant.
- **Icons.** These boards use a hand-drawn monoline set rather than
  Ionicons — thinner and more uniform, and closer to the reference. A
  real swap means picking a shipped icon set.

## If it were to ship

Roughly in order, and each step is independently shippable:

1. `tailwind.config.js` — add the neutral ramp as tokens, delete the
   three `boxShadow` entries.
2. `src/global.css` — the ramp's CSS variables per scheme.
3. `src/lib/theme.ts` — `screenBg` and the icon tints move onto the
   warm ramp.
4. Load Archivo + Inter Tight (`expo-font`) and point
   `fontFamily.display` at Archivo; add a `font-ui` token.
5. Sweep `bg-white dark:bg-gray-900 … shadow-card` → the new `card`
   idiom. That string is the single most repeated thing in the app, so
   it is the bulk of the work and it is mechanical.
6. Surfaces one at a time, highest traffic first: Book, Timeline,
   Track, Manage.

## Rebuilding the boards

```bash
cd docs/design/contra-refresh
node build.mjs   # writes 0*.html
node shot.mjs    # screenshots them to png/ at 2x
node shot.mjs 04 # just one board
```

`system.css` is the proposed design system, `legacy.css` approximates
today's look for the before/after board. `fonts/` holds the woff2 files
(all SIL OFL) with `fonts.css` pointing at them locally, so a rebuild
does not depend on Google Fonts still serving the same URLs.
