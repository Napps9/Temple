// The parser eval: ~50 owner sentences through the REAL parse path — the
// same shortlist the bar computes, the same parse-setup function, the
// same fallback re-ask against the full catalogue — scored against
// expected actions, including the refusals.
//
//   npm run eval:parser                       # against local stack
//   npm run eval:parser -- --only "Marcus"    # cases whose sentence matches
//
// Against hosted: set SUPABASE_URL + SUPABASE_ANON_KEY. Either way the
// eval signs in as the demo owner (real JWT, real effective_can gate) and
// the parse-setup function needs its ANTHROPIC_API_KEY set.
//
// A failure here is information, not automatically a bug: the score
// distinguishes a wrong ACTION (serious — a sentence did the wrong
// thing), a wrong step count, and a shortlist miss that the fallback
// rescued (a latency cost, not a correctness one). Exit code is 0 unless
// a refusal trap emitted an action — that one class is never acceptable.

import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { actionsFor } from '../src/lib/actions';
import { shortlist } from '../src/lib/actions/shortlist';
import { CASES, isCannot, scoreCase, type ParsedStep } from './parser-eval/cases';

const LOCAL_URL = 'http://127.0.0.1:54321';
const SHORTLIST = 12; // timeline.tsx's constant

function fail(message: string): never {
  console.error(`parser-eval: ${message}`);
  process.exit(1);
}

function localAnonKey(): string {
  try {
    const out = execSync('supabase status -o env', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    const m = out.match(/^ANON_KEY="(.*)"$/m) ?? out.match(/^PUBLISHABLE_KEY="(.*)"$/m);
    if (!m) throw new Error('no anon key in status output');
    return m[1];
  } catch {
    return fail('could not derive the local anon key from `supabase status`. Is the stack running? Otherwise set SUPABASE_ANON_KEY.');
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      slug: { type: 'string', default: 'demo-ironworks' },
      only: { type: 'string' },
    },
  });

  const url = process.env.SUPABASE_URL ?? LOCAL_URL;
  const anon = process.env.SUPABASE_ANON_KEY ?? localAnonKey();
  const email = process.env.EVAL_EMAIL ?? `owner@${values.slug}.temple.test`;
  const password = process.env.EVAL_PASSWORD ?? 'TempleDemo1!';

  const sb = createClient(url, anon, { auth: { persistSession: false } });
  const { error: authErr } = await sb.auth.signInWithPassword({ email, password });
  if (authErr) fail(`sign-in as ${email} failed: ${authErr.message} — is the demo gym seeded?`);

  const { data: gym } = await sb.from('gyms').select('id').eq('slug', values.slug!).maybeSingle();
  if (!gym) fail(`no gym with slug "${values.slug}" visible to ${email}.`);

  const vocabulary = actionsFor(() => true, 'owner');
  console.log(`Target: ${url}\nVocabulary: ${vocabulary.length} actions\n`);

  const ask = async (text: string, actions: typeof vocabulary) => {
    const { data, error } = await sb.functions.invoke('parse-setup', {
      body: { gym_id: gym.id, step: 'change', text, actions, history: [] },
    });
    if (error) throw new Error(error.message);
    const p = ((data as { proposal?: Record<string, unknown> })?.proposal ?? {}) as Record<string, unknown>;
    const wire = Array.isArray(p.steps)
      ? (p.steps as { action?: unknown; args?: unknown }[])
      : p.action
        ? [{ action: p.action, args: p.args }]
        : [];
    const steps: ParsedStep[] = wire
      .filter((w) => typeof w.action === 'string')
      .map((w) => ({ action: w.action as string, args: (w.args ?? {}) as Record<string, unknown> }));
    const cannot = typeof p.cannot === 'string' && p.cannot.trim() ? p.cannot : null;
    return { steps, cannot };
  };

  const cases = values.only
    ? CASES.filter((c) => c.say.toLowerCase().includes(values.only!.toLowerCase()))
    : CASES;
  if (cases.length === 0) fail(`--only "${values.only}" matched no cases.`);

  let passed = 0;
  let fallbacks = 0;
  let trapBreaches = 0;
  const failures: string[] = [];

  for (const c of cases) {
    let result;
    let usedFallback = false;
    try {
      result = await ask(c.say, shortlist(c.say, vocabulary, SHORTLIST));
      if (result.steps.length === 0 && !result.cannot && vocabulary.length > SHORTLIST) {
        usedFallback = true;
        result = await ask(c.say, vocabulary);
      }
      // A refusal is re-asked against everything before it counts — the
      // same policy the bar applies, so a shortlist miss is never scored
      // as the parser refusing.
      if (result.cannot && result.steps.length === 0 && !usedFallback && !isCannot(c)) {
        usedFallback = true;
        result = await ask(c.say, vocabulary);
      }
    } catch (e) {
      failures.push(`ERROR  "${c.say}" — ${e instanceof Error ? e.message : String(e)}`);
      console.log(`  error  ${c.say}`);
      continue;
    }
    if (usedFallback) fallbacks += 1;

    const score = scoreCase(c, result.steps, result.cannot);
    if (score.pass) {
      passed += 1;
      console.log(`  pass ${usedFallback ? '*' : ' '}  ${c.say}`);
    } else {
      if (isCannot(c) && result.steps.length > 0) trapBreaches += 1;
      failures.push(`FAIL   "${c.say}" — ${score.detail}${c.note ? `  [${c.note}]` : ''}`);
      console.log(`  FAIL   ${c.say}  →  ${score.detail}`);
    }
    // Sonnet per sentence; a breath between calls keeps rate limits away.
    await new Promise((r) => setTimeout(r, 300));
  }

  console.log(`\n${passed}/${cases.length} passed, ${fallbacks} needed the full-catalogue fallback (*).`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ${f}`);
  }
  if (trapBreaches > 0) {
    console.log(`\n${trapBreaches} refusal trap(s) emitted an action. That class is never acceptable.`);
    process.exit(1);
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
