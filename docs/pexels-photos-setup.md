# Stock photos setup (Pexels API)

Puts a "Search stock photos" button beside every image upload in the
site editor (hero, about, gallery), so a gym can fill their site with
real photography without owning any. Searches open pre-filled with a
query matched to the site's template archetype (e.g. a Ringside site
starts on "boxing training").

## One-time platform setup

1. Sign in at [pexels.com/api](https://www.pexels.com/api/) and request
   an API key — approval is instant and free.
2. Free-tier limits: **200 requests/hour, 20,000/month**, shared across
   the whole platform (every gym's searches count against the same
   key). The picker is built lean around this — 24 results per search,
   explicit search submit (no per-keystroke calls), one photo
   downloaded per pick.

## Supabase edge-function secrets

Set next to `RESEND_API_KEY` / `VERCEL_API_TOKEN`
(Supabase → Edge Functions → Secrets):

| Secret | Value |
| --- | --- |
| `PEXELS_API_KEY` | the key from pexels.com/api |

Until it's set, the picker opens but every search answers "Stock photos
aren't configured yet" — uploads are unaffected, nothing breaks.

## How it flows

1. Staff → site editor → any image field → **Search stock photos**.
2. The `stock-photos` edge function (`can_manage_website`-gated)
   proxies the search to Pexels — the API key never reaches the client.
3. Picking a photo sends only its numeric Pexels id back; the function
   re-fetches that photo from Pexels, downloads Pexels' own `large2x`
   rendition (1880px — hero-quality at a fraction of the original's
   size), and copies it into the gym's folder in `gym-website-assets`
   (`<gym_id>/pexels-<photo_id>-<timestamp>.jpg`).
4. The published site serves the copy from our bucket — it never
   depends on Pexels being up, and the photo id in the filename is the
   audit trail back to the source.

## License and API-guideline compliance

Pexels photos are free for commercial use; published gym sites need no
attribution. The API guidelines' requirements are built into the
picker: a prominent "Photos provided by Pexels" link, a per-photo
photographer credit linking their Pexels profile, and no mass
downloading (exactly one photo is fetched per pick). Rate-limit 429s
from Pexels surface in the picker as a friendly "busy right now — try
again in a few minutes" message.
