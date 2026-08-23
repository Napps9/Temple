# Temple brand assets

Temple-the-company's identity. The mark lives in code
(`src/components/TempleMark.tsx`); the flat files in
`assets/images/temple-brand/` are generated from it.

This is the **product identity**, and since gyms stopped recolouring
Temple it is the only identity the app has. There was a per-gym brand —
six hexes and two logos, driving the nav mark, every primary button and
the PWA icon. That is gone: a gym is identified by its name.

---

## The mark

The **three offset cards**, in one ink: the front card holds the doorway
column as a knockout, and the two cards behind it are hairline ghosts.

This is the original Temple silhouette in the form it took when the mark
first lost its colour — the gold and steel-blue cards became strokes,
the column became a hole — and it is back by the owner's call, replacing
the portico that briefly stood in for it. The doorway is a knockout
rather than a filled shape because the mark sits on surface and on
ground, and a hole is the only version that is right on both.

Below ~20px the ghost cards stop being depth and start being noise —
their stroke lands under half a pixel — so a favicon-sized mark is the
front card alone. The component applies this cut automatically
(`GHOSTS_ABOVE`), and the generated favicons follow it.

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
| Accent | `#C2410C` light / `#F0783C` dark | the one action per page |

The mark is ink or paper and never the accent. Two accent values rather
than one because a burnt orange carrying a white label on `#F7F7F8` is
too dark to read against `#0A0B0D`; both clear the 3:1 UI floor on their
own ground, which `src/lib/contrast.test.ts` asserts.

There is no gold, no steel blue, no tagline grey, and no `#2563EB` —
that last was the old default *gym* colour and never had anything to do
with Temple.

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

- **Do** keep clear space around the mark of roughly one column's width.
- **Do** let the component pick ink or paper; only pass `color` when the
  surface is neither.
- **Don't** recolour it, rotate it, stretch it, add a shadow, or rebuild
  it by hand.
- **Don't** put the wordmark in anything but Fraunces 700, lowercase.
