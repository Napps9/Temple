// Classify programmed workout sections with AI — movements, estimated
// duration, load level. The dimensions Boxmate makes coaches tag by
// hand, read straight from what the coach already wrote.
//
// Called by the Analysis page's Programming Balance block. Receives
// the window's distinct sections (format/category/title/body — coach-
// authored workout text, no PII) plus the movement vocabulary, and
// returns one tag per section, aligned to request order:
//
//   { tags: [{ movement_keys, duration_minutes, load_level,
//              confidence } | null], source: 'ai'|'cache'|'mixed'|'fallback' }
//
// Cache-first: each section's canonical fingerprint (kept in lock-step
// with sectionFingerprint in src/lib/programming-ai-tags.ts) is
// SHA-256'd and looked up in programming_ai_tags before anything goes
// to the model. The cache is keyed per gym, deliberately not shared
// across tenants — the vocab arrives from the client, so a cross-gym
// cache would let one gym's staff seed tags another gym then reads.
//
// Falls back to all-null tags when ANTHROPIC_API_KEY is unset or the
// API errors — the client's regex duration inference still runs, so
// the Analysis page renders either way.
//
// Required env (SUPABASE_* are injected by the platform):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
// Optional env (live inference; falls back without):
//   ANTHROPIC_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';

type SectionInput = {
  section_format: string;
  section_category: string;
  title: string;
  body: string;
};

type VocabEntry = { key: string; name: string };

type LoadLevel = 'heavy' | 'moderate' | 'light' | 'bodyweight';

type TagOut = {
  movement_keys: string[];
  duration_minutes: number | null;
  load_level: LoadLevel | null;
  confidence: 'high' | 'medium' | 'low';
};

const MODEL = 'claude-haiku-4-5-20251001';
const MAX_SECTIONS = 600;
const MODEL_CHUNK = 20;
const CACHE_CHUNK = 100;
// Input size bounds. Real programmed sections are a few hundred bytes
// and the movement catalog is ~50 entries — these caps only bite on
// abuse, where an owner-level caller could otherwise multiply model
// spend with megabyte bodies or a bloated vocab enum (the vocab is
// embedded in every chunk's tool schema).
const MAX_TITLE_CHARS = 300;
const MAX_BODY_CHARS = 4000;
const MAX_VOCAB_ENTRIES = 200;
const MAX_VOCAB_CHARS = 80;
// Per-gym daily brake on model calls: a real gym classifies each
// distinct section once and then rides the cache, so a gym minting
// thousands of never-seen sections a day is not analytics traffic.
// Beyond the budget the misses simply return null (client falls back
// to its regex) instead of reaching the model.
const DAILY_SECTION_BUDGET = 2000;
const LOAD_LEVELS: readonly LoadLevel[] = [
  'heavy',
  'moderate',
  'light',
  'bodyweight',
];

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'content-type': 'application/json' },
  });
}

// Mirrors sectionFingerprint in src/lib/programming-ai-tags.ts —
// the client dedupes and correlates on the same string. The version
// prefix is server-only (correlation with the client is positional):
// bump it when the classification vocabulary changes meaning, so
// cached tags minted against the old vocab get re-read instead of
// served forever. v2 = vocabulary widened to the Hyrox catalog.
const CACHE_VERSION = 'v2';

function fingerprint(s: SectionInput): string {
  const norm = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ');
  return `${CACHE_VERSION}\n${s.section_format}\n${norm(s.title)}\n${norm(s.body)}`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(s),
  );
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function sanitiseTag(raw: {
  movement_keys?: unknown;
  duration_minutes?: unknown;
  load_level?: unknown;
  confidence?: unknown;
}, vocabKeys: Set<string>): TagOut {
  const keys = Array.isArray(raw.movement_keys)
    ? raw.movement_keys.filter(
        (k): k is string => typeof k === 'string' && vocabKeys.has(k),
      )
    : [];
  const dur =
    typeof raw.duration_minutes === 'number' &&
    Number.isFinite(raw.duration_minutes) &&
    raw.duration_minutes >= 1 &&
    raw.duration_minutes <= 600
      ? Math.round(raw.duration_minutes)
      : null;
  const load = LOAD_LEVELS.includes(raw.load_level as LoadLevel)
    ? (raw.load_level as LoadLevel)
    : null;
  const confidence =
    raw.confidence === 'high' || raw.confidence === 'medium'
      ? raw.confidence
      : 'low';
  return {
    movement_keys: keys,
    duration_minutes: dur,
    load_level: load,
    confidence,
  };
}

const SYSTEM_PROMPT =
  'You classify programmed CrossFit / functional-fitness workout sections ' +
  'for a gym analytics dashboard. For each section you get its format ' +
  '(for_time, amrap, emom, strength_sets, ...), category, title and the ' +
  "coach's written body text. Emit, per section:\n" +
  '- movement_keys: every movement from the provided vocabulary that the ' +
  'section actually programmes. Resolve abbreviations and shorthand (C&J, ' +
  'T2B, HSPU, "squat cleans"). Only vocabulary keys; empty when none apply.\n' +
  '- duration_minutes: the section\'s working duration in minutes. Use an ' +
  'explicit clock when written (a 20 min AMRAP is 20; an EMOM 12 is 12; a ' +
  'time cap is the cap). Otherwise estimate from the programmed volume how ' +
  'long a typical class athlete needs. null only when there is genuinely ' +
  'nothing to go on.\n' +
  '- load_level: how the external loading reads. heavy = near-maximal work ' +
  '(heavy singles/doubles, percentages around 80%+ , "build to a heavy..."); ' +
  'moderate = meaningful but sub-maximal load (cycled barbell in metcons, ' +
  'moderate dumbbells/kettlebells); light = deliberately light for speed, ' +
  'technique or high reps; bodyweight = no meaningful external load. null ' +
  'when loading is not a meaningful axis (mobility, breathing, briefings).\n' +
  '- confidence: high/medium/low for the overall read.\n' +
  'Be conservative: these numbers drive a coach-facing analytics page, and ' +
  'a wrong tag is worse than a null one.';

async function callClaude(
  apiKey: string,
  sections: SectionInput[],
  vocab: VocabEntry[],
): Promise<Map<number, TagOut> | null> {
  const vocabKeys = new Set(vocab.map((v) => v.key));
  const toolSchema = {
    type: 'object',
    properties: {
      tags: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer' },
            movement_keys: {
              type: 'array',
              items: { type: 'string', enum: [...vocabKeys] },
            },
            duration_minutes: { type: ['integer', 'null'] },
            load_level: {
              type: ['string', 'null'],
              enum: [...LOAD_LEVELS, null],
            },
            confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          },
          required: [
            'index',
            'movement_keys',
            'duration_minutes',
            'load_level',
            'confidence',
          ],
        },
      },
    },
    required: ['tags'],
  };

  const userPayload = {
    sections: sections.map((s, index) => ({
      index,
      format: s.section_format,
      category: s.section_category,
      title: s.title,
      body: s.body,
    })),
    vocabulary: vocab,
  };

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        tools: [
          {
            name: 'emit_tags',
            description: 'Emit one tag object per input section.',
            input_schema: toolSchema,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_tags' },
        messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
      }),
    });
    if (!res.ok) return null;
    const body = await res.json();
    const toolUse = (body.content ?? []).find(
      (b: { type: string }) => b.type === 'tool_use',
    );
    if (!toolUse) return null;
    const parsed = toolUse.input as {
      tags?: { index?: unknown }[];
    };
    if (!Array.isArray(parsed.tags)) return null;
    const out = new Map<number, TagOut>();
    for (const t of parsed.tags) {
      if (typeof t?.index !== 'number') continue;
      if (t.index < 0 || t.index >= sections.length) continue;
      out.set(t.index, sanitiseTag(t, vocabKeys));
    }
    return out;
  } catch {
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');
  const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ error: 'Function is not configured' }, 500);
  }

  let body: {
    gym_id?: unknown;
    sections?: unknown;
    vocab?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Expected a JSON body' }, 400);
  }
  if (typeof body.gym_id !== 'string') {
    return json({ error: 'gym_id is required' }, 400);
  }
  const gymId = body.gym_id;
  const sections: SectionInput[] = (
    Array.isArray(body.sections) ? body.sections : []
  )
    .filter(
      (s): s is SectionInput =>
        !!s &&
        typeof (s as SectionInput).section_format === 'string' &&
        typeof (s as SectionInput).section_category === 'string' &&
        typeof (s as SectionInput).title === 'string' &&
        typeof (s as SectionInput).body === 'string',
    )
    .slice(0, MAX_SECTIONS)
    // Truncation happens before hashing, so an oversized body still
    // caches consistently; response alignment is positional, so the
    // client's own fingerprints are unaffected.
    .map((s) => ({
      section_format: s.section_format.slice(0, 40),
      section_category: s.section_category.slice(0, 40),
      title: s.title.slice(0, MAX_TITLE_CHARS),
      body: s.body.slice(0, MAX_BODY_CHARS),
    }));
  const vocab: VocabEntry[] = (Array.isArray(body.vocab) ? body.vocab : [])
    .filter(
      (v): v is VocabEntry =>
        !!v &&
        typeof (v as VocabEntry).key === 'string' &&
        typeof (v as VocabEntry).name === 'string' &&
        (v as VocabEntry).key.length <= MAX_VOCAB_CHARS &&
        (v as VocabEntry).name.length <= MAX_VOCAB_CHARS,
    )
    .slice(0, MAX_VOCAB_ENTRIES);
  if (sections.length === 0 || vocab.length === 0) {
    return json({ error: 'sections and vocab are required' }, 400);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const service = createClient(SUPABASE_URL, SERVICE_KEY);
  const caller = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });

  // Same gate as the Programming Balance block itself.
  const { data: allowed, error: aErr } = await caller.rpc('effective_can', {
    p_gym_id: gymId,
    p_capability: 'can_see_workout_logs',
  });
  if (aErr || allowed !== true) return json({ error: 'Not authorised' }, 403);

  const hashes = await Promise.all(
    sections.map((s) => sha256Hex(fingerprint(s))),
  );

  // Cache read, chunked to keep the .in() query string sane.
  const cached = new Map<string, TagOut>();
  for (let i = 0; i < hashes.length; i += CACHE_CHUNK) {
    const chunk = [...new Set(hashes.slice(i, i + CACHE_CHUNK))];
    const { data } = await service
      .from('programming_ai_tags')
      .select('content_hash, movement_keys, duration_minutes, load_level, confidence')
      .eq('gym_id', gymId)
      .in('content_hash', chunk);
    // Cached rows go through the same sanitiser as fresh model output
    // — a row written under an older vocabulary (or by anything other
    // than this function) must not hand the client keys outside the
    // request's vocab.
    const vocabKeys = new Set(vocab.map((v) => v.key));
    for (const row of data ?? []) {
      cached.set(
        row.content_hash as string,
        sanitiseTag(
          {
            movement_keys: row.movement_keys,
            duration_minutes: row.duration_minutes,
            load_level: row.load_level,
            confidence: row.confidence,
          },
          vocabKeys,
        ),
      );
    }
  }

  // Model pass over the misses (first occurrence of each hash only).
  const missIndices: number[] = [];
  const seenMiss = new Set<string>();
  hashes.forEach((h, i) => {
    if (cached.has(h) || seenMiss.has(h)) return;
    seenMiss.add(h);
    missIndices.push(i);
  });

  const hadCacheHits = cached.size > 0;

  // Daily model-budget check — rows written in the last 24h stand in
  // for "sections this gym sent to the model today".
  let underBudget = true;
  if (missIndices.length > 0) {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await service
      .from('programming_ai_tags')
      .select('content_hash', { count: 'exact', head: true })
      .eq('gym_id', gymId)
      .gte('created_at', since);
    underBudget = (count ?? 0) < DAILY_SECTION_BUDGET;
  }

  let anyAi = false;
  if (ANTHROPIC_API_KEY && underBudget && missIndices.length > 0) {
    for (let i = 0; i < missIndices.length; i += MODEL_CHUNK) {
      const chunkIdx = missIndices.slice(i, i + MODEL_CHUNK);
      const result = await callClaude(
        ANTHROPIC_API_KEY,
        chunkIdx.map((j) => sections[j]),
        vocab,
      );
      if (!result) continue;
      const rows: Record<string, unknown>[] = [];
      result.forEach((tag, local) => {
        const globalIdx = chunkIdx[local];
        if (globalIdx === undefined) return;
        const hash = hashes[globalIdx];
        cached.set(hash, tag);
        anyAi = true;
        rows.push({
          gym_id: gymId,
          content_hash: hash,
          movement_keys: tag.movement_keys,
          duration_minutes: tag.duration_minutes,
          load_level: tag.load_level,
          confidence: tag.confidence,
          model: MODEL,
        });
      });
      if (rows.length > 0) {
        await service
          .from('programming_ai_tags')
          .upsert(rows, { onConflict: 'gym_id,content_hash' });
      }
    }
  }

  const tags = hashes.map((h) => cached.get(h) ?? null);
  const source = !tags.some((t) => t !== null)
    ? 'fallback'
    : anyAi && hadCacheHits
      ? 'mixed'
      : anyAi
        ? 'ai'
        : 'cache';
  return json({ tags, source });
});
