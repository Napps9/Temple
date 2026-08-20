# Temple brand assets

Temple-the-company's identity. The mark lives in code
(`src/components/TempleMark.tsx`); the flat files in
`assets/images/temple-brand/` are generated from it.

This is the **product/company identity** — what a logged-out visitor
sees. It is *not* the per-gym brand colour the app themes at runtime
(`useThemeColors().primary`), which every gym sets for itself. Keep the
two separate: gyms recolour their own surfaces; the Temple mark never
gets recoloured.

---

## The mark

Three offset rounded-square cards, the front one with a doorway cut out
of it. The two behind are hairlines, so the offset still reads as depth
without a shadow.

It used to be three *filled* cards — gold, steel blue, ink — each holding
a column, with the offset doing the work of a drop shadow. That was a
considered identity and the silhouette is unchanged, but it was built on
the two things the current design system removed: colour in the furniture,
and depth from shadow rather than from a hairline and a tone step. So it
was flattened rather than replaced. One ink, on light or on dark.

The doorway stops short of the card's bottom edge on purpose. Run it to
the edge and the ink around it forms an arch that reads as a lowercase
**n** — which, sitting next to a lowercase wordmark, is the one thing the
mark must not do.

## The wordmark

**temple**, lowercase, set in **Fraunces 700**. Lowercase and serif on
purpose: Temple is the thing a gym runs on, not a monument, and the old
letterspaced `TEMPLE` caps with a `TECHNOLOGY` tagline said the opposite.
There is no tagline any more.

Fraunces is loaded by the app (`@expo-google-fonts/fraunces`, the 700
cut only) and is the only serif in the product. Everything else is Geist.

## Palette

| Role | Hex | Used for |
|------|-----|----------|
| Ink | `#14161A` | the mark and wordmark on a light surface |
| Paper | `#F4F5F6` | the mark and wordmark on a dark surface |

That is the whole palette. There is no gold, no steel blue, no tagline
grey, and no `#2563EB` — that last one is only the app's *default gym*
theme colour, a runtime per-gym default, and has nothing to do with the
company logo.

---

## Using it in the app

Import the components, not the files:

```tsx
import { TempleLockup, TempleMark, TempleWordmark } from '@/components/TempleMark';

<TempleLockup size={28} />   // mark + wordmark, sized from the type
<TempleMark size={44} />     // mark alone
<TempleWordmark size={26} /> // wordmark alone
```

All three take the active scheme's ink automatically and accept a
`color` override for the rare surface that needs one (a coloured hero, a
photo scrim). Nothing needs an `on-light` / `on-dark` choice any more —
that decision moved into `useThemeColors()`.

`TempleMark` drops the two hairline cards below 28px, where they stop
being depth and start being two grey smudges.

## The flat files

For anything outside the app — an app store, a build tool, a slide, a
print job.

| File | What |
|------|------|
| `mark-on-{light,dark}.svg` | the mark, vector, prefer this |
| `mark-on-{light,dark}-512px.png` | the mark, raster |
| `lockup-on-{light,dark}.svg` | mark + wordmark, Fraunces inlined |
| `lockup-on-{light,dark}-960px.png` | mark + wordmark, raster |

`on-light` / `on-dark` names the **background** it will sit on, not the
colour of the artwork.

The app icon, favicon, splash and Android adaptive layers are generated
into `assets/images/` from the same source and are wired into
`app.json`.

## Regenerating

Every flat file above comes from one script, which shares the mark's path
data with the component:

```bash
node scripts/brand/build-marks.mjs
```

Run it after any change to `TempleMark.tsx`. It needs Chromium. If the
script and the component ever disagree, the component is right — it is
what people actually see.

## Do / don't

- **Do** keep clear space around the mark of roughly one card's width.
- **Do** let the component pick ink or paper; only pass `color` when the
  surface is neither.
- **Don't** recolour it, rotate it, stretch it, add a shadow, or rebuild
  it by hand.
- **Don't** put the wordmark in anything but Fraunces 700, lowercase.
