# The screenshot harness

Renders the real app, signed in, against a fake backend — so what gets
reviewed is the thing that shipped, not a drawing of it.

Every design board before this was hand-built HTML from reading the code.
They were close enough to reason with and wrong in ways nobody could see:
the real nav pills carry icons, the real Manage hub has a date-range
picker and a finance block no board showed, and the first real render
surfaced a NaN% the boards could never have contained.

## How it works

The Supabase URL is baked into the bundle at build time
(`src/lib/supabase.ts`), so `build.mjs` exports the web build with
`EXPO_PUBLIC_SUPABASE_URL=http://localhost:8100` — and `server.mjs` *is*
that URL: one origin serving the static export, GoTrue (`/auth/v1/*`) and
PostgREST (`/rest/v1/*`) from `fixtures.mjs`. Nothing is patched in the
browser; the app runs unmodified.

`shoot.mjs` signs in through the real form — seeding the session into
localStorage does not survive auth-js, which validates the access token
as a JWT and silently drops anything it did not write — then walks the
routes in light and dark at phone (414) and rail (1280) widths.

```bash
npm run shots            # build + serve + shoot everything
node scripts/screenshot/shoot.mjs manage   # one route, server already up
```

Output lands in `scripts/screenshot/out/` (gitignored).

## Sharp edges

- **`--clear` is load-bearing** in build.mjs: `EXPO_PUBLIC_*` is inlined
  at transform time, so Metro's cache happily serves a module with the
  previous build's URL baked in. The failure is silent — the app just
  talks to the wrong backend.
- Filters on `/rest/v1/<table>` are ignored on purpose. Screens get the
  fixture rows; the fake does not re-implement PostgREST's grammar, and
  `.single()`/`.maybeSingle()` are honoured via the Accept header, which
  is the one shape difference that makes supabase-js throw.
- Embedded joins (`gyms!gym_id ( name )`) are not resolved — put the
  nested object on the fixture row.
- An unknown table or RPC answers `[]` and logs, so a screen renders its
  empty state rather than hanging. The log line is the to-do list for new
  fixtures.
