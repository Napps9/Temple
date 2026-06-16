# Temple brand assets

Temple-the-company's logo artwork. Lives in
`assets/images/temple-brand-assets 2/`.

This is the **product/company identity** — the logo a logged-out visitor
sees. It is *not* the same thing as the per-gym brand colour the app
themes at runtime (`useThemeColors().primary`), which every gym sets for
itself. Keep the two separate: gyms recolour their own surfaces; the
Temple mark never gets recoloured.

> **Folder name:** it's literally `temple-brand-assets 2` (a space and a
> trailing `2`). Spaces work in `require()` but are easy to fumble —
> worth renaming to `temple-brand`. Ask and I'll rename it and fix any
> references in one pass.

---

## The mark

Three offset rounded-square cards stacked back-to-front, each holding a
pillar glyph (a column — the "temple"). The diagonal offset reads as
depth. Back card gold, middle card steel-blue, front card ink-or-cream
depending on the background it sits on.

## Palette

| Role | Hex | Used for |
|------|-----|----------|
| Gold | `#E8B620` | back card |
| Steel blue | `#3B6BA5` | middle card |
| Ink | `#111111` | front card + glyphs on light backgrounds |
| Cream (paper) | `#F4F2ED` | front card + glyphs on dark backgrounds |
| Tagline grey | `#5A5550` | the "TECHNOLOGY" tagline |
| Mono back | `#999690` | greyscale mark, back card |
| Mono middle | `#CCCAC5` | greyscale mark, middle card |

No green. The brand blue is the muted **`#3B6BA5`** — *not* `#2563EB`.
(`#2563EB` is only the app's *default gym* theme colour, a runtime
per-gym default; it has nothing to do with the company logo.)

## Typography

Wordmark and tagline are set in **Outfit** (Google Fonts):

- `TEMPLE` — weight 800, letter-spacing ~7
- `TECHNOLOGY` — weight 500, letter-spacing ~5, colour `#5A5550`

---

## Filename convention

```
{type}-{colour|mono}-{on-light|on-dark}[-centred]-{size}.{svg|png}
```

- **type** — `mark`, `lockup`, `app-icon`, or `favicon`
- **colour | mono** — full gold/blue/ink, or greyscale for
  single-colour contexts (embossing, one-ink print, etc.)
- **on-light | on-dark** — match this to the **background** you're
  placing it on. The front card and glyphs flip so the mark stays legible.
- **centred** — artwork optically centred in a square. Use when the mark
  stands alone (avatars, square tiles, social). Without `-centred` the
  mark is anchored to the top-left — use that in lockups or left-aligned
  rows.
- **size** — `svg` (vector — prefer it) or a raster PNG at that pixel
  width. Use the size at or above your render size; never upscale a PNG.

## What's in the folder

| Asset | Files | Notes |
|-------|-------|-------|
| **Mark** (icon only) | `mark-{colour\|mono}-{on-light\|on-dark}[-centred][-{64..1024}px]` | colour has png 64/128/256/512(/1024); **mono is SVG-only** |
| **Lockup** (mark + "TEMPLE / TECHNOLOGY") | `lockup-{on-light\|on-dark}[-{480,960}px]` | viewBox 480×120 (4:1) |
| **App icon** (full-bleed rounded tile) | `app-icon-{light\|dark}[-{180,512,1024}px]` | 180 iOS · 512 Android/PWA · 1024 store |
| **Favicon** | `favicon-{16,32}.png` | browser tabs |

---

## Which file do I use?

- **Top-of-page / nav logo** → `lockup-on-{light\|dark}` matching the background.
- **Square avatar / social / standalone icon** → `mark-…-centred`.
- **Inline, left-aligned with text** → `mark` (non-centred) or the lockup.
- **One-colour / print / etched** → any `mono`.
- **iOS / Android / PWA launcher** → `app-icon-{light\|dark}` at the platform size.
- **Browser tab** → `favicon-16` / `favicon-32`.
- **Web & React Native** → prefer the **SVG**; fall back to the
  nearest-larger PNG where SVG isn't practical.

## Using them in code

- **SVG:** render with `react-native-svg` (already a dependency), or on
  web via `require()` into an `<Image>` / `<img>`.
- **PNG:** `require('…/<file>.png')` into `<Image>`.
- The logged-out landing (`/get-started`) is always dark, so it should
  use the **`-on-dark`** lockup or mark.

## Do / don't

- **Do** keep clear space around the mark of roughly one card's width.
- **Do** pick the `on-light` / `on-dark` variant to match the surface.
- **Don't** recolour, rotate, stretch, add shadows/effects, or rebuild
  the mark. Use mono if colour won't work.
- **Don't** place the colour mark on a busy photo — use the app-icon
  tile or a mono mark instead.
