// One origin that is both the app and its backend.
//
// The point of this file is that Temple's Supabase URL is baked in at
// build time (src/lib/supabase.ts reads process.env.EXPO_PUBLIC_SUPABASE_URL),
// so pointing the build at this server is enough — nothing is patched in
// the browser, and the app runs exactly the code that ships.
//
// It answers the slice of PostgREST and GoTrue that Temple actually calls:
// a table read, an RPC, and the auth endpoints supabase-js pings on boot.
// Filters are ignored on purpose. A screenshot wants the fixture rows on
// screen, not a re-implementation of PostgREST's grammar — and pretending
// to honour `eq` while ignoring `or` would be worse than honouring none.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SESSION, TABLES, RPCS } from './fixtures.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.SHOT_EXPORT_DIR || '/tmp/shot-export';
const PORT = Number(process.env.SHOT_PORT || 8100);

const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.ico': 'image/x-icon',
  '.map': 'application/json',
};

function json(res, body, status = 200) {
  const text = JSON.stringify(body);
  // A real total in content-range: supabase-js reads `count: 'exact'`
  // out of this header, and a `*` total parses to NaN — which is how the
  // Journal tile said "NaN logged sessions".
  const total = Array.isArray(body) ? body.length : body === null ? 0 : 1;
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-expose-headers': 'content-range',
    'content-range': `0-${Math.max(0, total - 1)}/${total}`,
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

// `.single()` and `.maybeSingle()` ask for one object rather than a list
// via Accept. Returning an array to those calls makes supabase-js throw,
// so the shape has to follow the header.
function shape(rows, req) {
  const accept = req.headers.accept || '';
  if (!accept.includes('pgrst.object')) return rows;
  return rows.length > 0 ? rows[0] : null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const path = decodeURIComponent(url.pathname);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    });
    return res.end();
  }

  // ---------------------------------------------------------------- auth
  if (path.startsWith('/auth/v1/')) {
    if (path.endsWith('/user')) return json(res, SESSION.user);
    if (path.endsWith('/logout')) return json(res, {});
    // token?grant_type=password | refresh_token — both hand back the one
    // session, so a refresh on a long screenshot run cannot log us out.
    return json(res, SESSION);
  }

  // ----------------------------------------------------------------- rpc
  if (path.startsWith('/rest/v1/rpc/')) {
    const fn = path.slice('/rest/v1/rpc/'.length);
    await readBody(req);
    const known = Object.prototype.hasOwnProperty.call(RPCS, fn);
    if (!known) console.log(`  rpc  ${fn} -> [] (no fixture)`);
    const value = known ? RPCS[fn] : [];
    // A scalar fixture answers as a scalar: PostgREST returns bare JSON
    // for a scalar-returning function, and an array where a number
    // belongs turns into NaN downstream.
    if (!Array.isArray(value)) return json(res, value);
    return json(res, shape(value, req));
  }

  // --------------------------------------------------------------- table
  if (path.startsWith('/rest/v1/')) {
    const table = path.slice('/rest/v1/'.length);
    if (req.method !== 'GET') {
      const body = await readBody(req);
      // Writes echo back, so an optimistic UI settles instead of erroring.
      return json(res, shape(Array.isArray(body) ? body : [body ?? {}], req));
    }
    const rows = TABLES[table];
    if (!rows) console.log(`  rest ${table} -> [] (no fixture)`);
    // Honour limit even though filters stay ignored: maybeSingle() sends a
    // plain list request and ERRORS client-side on >1 row, so a fixture
    // table with several rows breaks every `.limit(1).maybeSingle()` read
    // unless the cap is applied.
    const limit = Number(url.searchParams.get('limit'));
    const capped =
      Number.isFinite(limit) && limit > 0 ? (rows ?? []).slice(0, limit) : (rows ?? []);
    return json(res, shape(capped, req));
  }

  // -------------------------------------------------------------- static
  let file = join(ROOT, path);
  if (!extname(path)) {
    const html = join(ROOT, path === '/' ? 'index.html' : `${path}.html`);
    file = existsSync(html) ? html : join(ROOT, 'index.html');
  }
  try {
    const buf = await readFile(file);
    res.writeHead(200, {
      'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    });
    res.end(buf);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, () => {
  console.log(`harness on http://localhost:${PORT} serving ${ROOT}`);
});
