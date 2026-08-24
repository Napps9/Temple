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

The **star**, in the brand magenta (`#E04898`) — the four-point
silhouette the AI wears, promoted to the logo by the owner's call,
because the AI front desk is the thing Temple leads with. Colour is
what separates the two jobs the silhouette does: **magenta means
Temple** (the mark, the favicon, the app icon), **ink means "a machine
wrote this"** (`AIMark`, the agent's byline in threads and bylines).
Never swap those.

The mark is the favicon (transparent ground — the magenta reads on a
light tab strip and a dark one) and the app icon (on an ink tile).

The three-offset-cards silhouette this replaces is retired as the logo
but survives as a **design motif**: the get-started deck's stacked
cards and the athlete screen's hairline ghost plates still echo it.

## The wordmark and lockup

**temple**, lowercase, set in **Fraunces 700**. Lowercase and serif on
purpose: Temple is the thing a gym runs on, not a monument, and the old
letterspaced `TEMPLE` caps with a `TECHNOLOGY` tagline said the opposite.
There is no tagline any more.

The **lockup** is the word with the star tucked against the final
letter's shoulder (up and right of the last `e`). The star keeps the
brand magenta whatever ink the word takes.

Fraunces is loaded by the app (`@expo-google-fonts/fraunces`, the 700
cut only) and is the only serif in the product. Everything else is Geist.

## Palette

| Role | Hex | Used for |
|------|-----|----------|
| Ink | `#14161A` | the wordmark and text on a light surface |
| Paper | `#F4F5F6` | the wordmark and text on a dark surface |
| Brand | `#E04898` | the star, the favicon, selected/active states |
| Dawn | `#E04898 → #EA5D7C → #D37254` light-set / `#E04898 → #EE5E7E → #F08260` vivid-set | gradient fills and brand moments |

Where the colour goes in the product (`BRAND` and `DAWN` in
`src/lib/theme.ts`):

- **Selected and active states** are the flat brand magenta — the
  active nav row (`bg-brand/10` + a magenta icon), the selected day in
  the calendar strip, the today letter.
- **The one primary action per page** wears the dawn gradient with a
  white label (`Button` variant `primary`, the calendar's Add class
  pill). Repeated actions stay ink/plain — eight gradient pills is a
  loud list, not eight invitations.
- **Initials avatars** wear the dawn gradient with a white initial.
- **Brand moments** keep it: logged-out headlines (`BrandHeadline`),
  the email top rule, and the hero cards (`BrandGradientHero`), whose
  content is ink.

Two dawn stop sets, chosen by what sits on them: the **vivid set**
carries INK content (heroes, dark-ground headlines); the **light set**
is the same dawn deepened until WHITE content clears the 3:1 floor on
every stop (buttons, avatars, light-ground headlines).
`src/lib/contrast.test.ts` asserts every pairing.

Everyday colour beyond that comes from content, not chrome: gyms colour
their own class types, tags and campaign emails.

There is no burnt orange, no gold, no steel blue, no tagline grey, and
no `#2563EB` — that last was the old default *gym* colour and never had
anything to do with Temple.

---

## Using it in the app

Import the components, not the files:

```tsx
import { TempleLockup, TempleMark, TempleWordmark } from '@/components/TempleMark';

<TempleLockup size={28} />   // wordmark + star, sized from the type
<TempleMark size={44} />     // the star alone, brand magenta
<TempleWordmark size={26} /> // wordmark alone
```

The wordmark takes the active scheme's ink automatically; the star is
always the brand magenta. All three accept a `color` override for the
rare surface that needs one (a photo scrim, a gradient hero).

## The flat files

For anything outside the app — an app store, a build tool, a slide, a
print job.

| File | What |
|------|------|
| `mark-on-{light,dark}.svg` | the star, vector, prefer this |
| `mark-on-{light,dark}-512px.png` | the star, raster |
| `lockup-on-{light,dark}.svg` | wordmark + star, Fraunces inlined |
| `lockup-on-{light,dark}-960px.png` | wordmark + star, raster |

`on-light` / `on-dark` names the **background** it will sit on, not the
colour of the artwork — the star itself is identical in both; only the
wordmark's ink flips.

The app icon, favicon, splash and Android adaptive layers are generated
into `assets/images/` from the same source and are wired into
`app.json`. The email lockup PNGs in `public/email/` come from the same
script.

## Regenerating

Every flat file above comes from one script, which shares the star's
path data with the component:

```bash
node scripts/brand/build-marks.mjs
```

Run it after any change to `TempleMark.tsx` or `AIMark.tsx`'s `STAR`.
It needs Chromium. If the script and the component ever disagree, the
component is right — it is what people actually see.

## Do / don't

- **Do** keep clear space around the star of roughly one point's width.
- **Do** keep the star magenta in brand positions and ink in AI-byline
  positions — the colour is the meaning.
- **Don't** recolour it otherwise, rotate it, stretch it, add a shadow,
  or rebuild it by hand.
- **Don't** put the wordmark in anything but Fraunces 700, lowercase.
