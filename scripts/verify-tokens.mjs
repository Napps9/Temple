// Checks that the classes a change relies on actually compiled.
//
//   node scripts/verify-tokens.mjs <export-dir> <class> [class...]
//
// This exists because neither `tsc` nor `vitest` can see a design token.
// A class NativeWind does not recognise compiles to nothing: the build is
// green, the tests pass, and the thing renders unstyled in production.
// The only check that catches it is reading the emitted stylesheet.
//
// Escaping is the whole subtlety, and it has already produced one false
// alarm: Tailwind writes `hover:bg-raised/60` as
// `.hover\:bg-raised\/60:hover{...}`, so a pattern that expects `{`
// straight after the class name reports a perfectly good class missing.
// The variant's pseudo-selector, and dark mode's `:is(.dark *)`, sit
// between the two.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, ...classes] = process.argv.slice(2);
if (!dir || !classes.length) {
  console.error('usage: node scripts/verify-tokens.mjs <export-dir> <class>...');
  process.exit(2);
}

const cssDir = join(dir, '_expo/static/css');
const css = readdirSync(cssDir)
  .filter((f) => f.endsWith('.css'))
  .map((f) => readFileSync(join(cssDir, f), 'utf8'))
  .join('\n');

// Tailwind escapes the characters that are not valid in a CSS identifier
// by putting a real backslash in front of them, so `dark:bg-raised-dk/60`
// becomes the selector `.dark\:bg-raised-dk\/60`. Searching for that as a
// plain string, then reading forward to the declaration block, avoids
// having to reason about a backslash through two layers of escaping.
const selector = (c) => '.' + c.replace(/[:/.[\]%!#(),+*~=<>'"|^&$@]/g, (ch) => '\\' + ch);

let bad = 0;
for (const c of classes) {
  const sel = selector(c);
  let found = null;
  for (let i = css.indexOf(sel); i !== -1; i = css.indexOf(sel, i + 1)) {
    // Reject a prefix match: `.bg-raised` must not answer for
    // `.bg-raised-dk`. The character after the name has to end it.
    const after = css[i + sel.length];
    if (/[\w-]/.test(after)) continue;
    const open = css.indexOf('{', i);
    const close = css.indexOf('}', open);
    // A `{` further away than the selector list is a different rule.
    if (open === -1 || css.slice(i, open).includes('}')) continue;
    found = css.slice(open + 1, close);
    break;
  }
  console.log(`${found ? '  ok ' : 'MISS '} ${c.padEnd(34)} ${found ? found.slice(0, 56) : ''}`);
  if (!found) bad++;
}
process.exit(bad ? 1 : 0);
