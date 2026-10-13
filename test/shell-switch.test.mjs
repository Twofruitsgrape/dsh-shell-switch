/**
 * dsh-shell-switch test suite.
 *
 * Verifies that cordis.patch.yml flips the four shell rows as a coherent pair,
 * using the same evaluation model dsh's loader uses for `!!js` expressions:
 * the expression is evaluated with `process` in scope, so it can read
 * process.env at profile-composition time.
 *
 * Run: node test/shell-switch.test.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const patchPath = join(here, '..', 'cordis.patch.yml');

let pass = 0;
let fail = 0;

function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`);
  }
}

/** Evaluate a dsh `!!js` expression body with `process` bound, as the loader does. */
function evalJsBody(body, env) {
  const sandboxProcess = { env, platform: 'win32' };
  return new Function('process', `return (${body})`)(sandboxProcess);
}

/** js-yaml cannot eval !!js, so strip the tag and keep the raw expression body.
 *  Supports a flat list, an `insert:` block, or `- insert:` (a list item whose
 *  value is an insert block) — the last matches how dsh-comsol ships. */
function loadPatch() {
  const src = readFileSync(patchPath, 'utf8');
  const stripped = src.replace(/!!js\s+/g, '');
  const doc = yaml.load(stripped);
  const top = Array.isArray(doc) ? doc : doc && Array.isArray(doc.insert) ? doc.insert : [];
  const rows = [];
  for (const item of top) {
    if (item && Array.isArray(item.insert)) rows.push(...item.insert);
    else if (item) rows.push(item);
  }
  return rows;
}

/** Pull the raw `!!js` expression body for a given row id out of the source. */
function rawJsBody(id, field = 'disabled') {
  const src = readFileSync(patchPath, 'utf8');
  const lines = src.split('\n');
  const rowRe = new RegExp(`^\\s*-?\\s*id:\\s*${id}\\s*$`); // works inside insert: blocks too
  const rowStart = lines.findIndex((l) => rowRe.test(l));
  if (rowStart < 0) throw new Error(`row not found: ${id}`);
  for (let i = rowStart + 1; i < rowStart + 8 && i < lines.length; i++) {
    // Tolerate CRLF: Git may check the patch out with CRLF endings on Windows.
    const m = lines[i].match(new RegExp(`^\\s*${field}:\\s*!!js\\s+(.+?)\\r?$`));
    if (m) return m[1].trim();
  }
  throw new Error(`!!js ${field} not found for row: ${id}`);
}

const ROWS = {
  'pwsh-sandbox': 'pwshDisabled',
  'tool-pwsh': 'pwshDisabled',
  'bash-sandbox': 'bashDisabled',
  'tool-bash': 'bashDisabled',
};

const bashExpr = rawJsBody('bash-sandbox');
const toolBashExpr = rawJsBody('tool-bash');
const pwshExpr = rawJsBody('pwsh-sandbox');
const toolPwshExpr = rawJsBody('tool-pwsh');

console.log('\n== 1. Patch structure ==');
const doc = loadPatch();
check('patch loads as a YAML array', Array.isArray(doc));
const ids = doc.map((e) => e.id);
for (const id of Object.keys(ROWS)) {
  check(`row present: ${id}`, ids.includes(id), `ids=${JSON.stringify(ids)}`);
}
check(
  'both bash rows name the bash packages',
  doc.find((e) => e.id === 'bash-sandbox').name === '@deepseek-ai/dsh-bash-sandbox' &&
    doc.find((e) => e.id === 'tool-bash').name === '@deepseek-ai/dsh-tool-bash'
);
check(
  'both pwsh rows name the pwsh packages',
  doc.find((e) => e.id === 'pwsh-sandbox').name === '@deepseek-ai/dsh-pwsh-sandbox' &&
    doc.find((e) => e.id === 'tool-pwsh').name === '@deepseek-ai/dsh-tool-pwsh'
);

console.log('\n== 2. Stack coherence (each stack flips as a pair) ==');
check('bash-sandbox and tool-bash share one expression', bashExpr === toolBashExpr);
check('pwsh-sandbox and tool-pwsh share one expression', pwshExpr === toolPwshExpr);
check('the two stacks use complementary expressions', bashExpr !== pwshExpr);

console.log('\n== 3. Patch expression behaviour (reads DSH_SHELL_EFFECTIVE) ==');
// The bundle module (index.js) resolves DSH_SHELL / DSH_BASH_DIR and publishes
// the final choice as DSH_SHELL_EFFECTIVE. This section verifies the patch
// expressions read that variable correctly.
const bashBody = rawJsBody('bash-sandbox');
const pwshBody = rawJsBody('pwsh-sandbox');

const scenarios = [
  { env: { DSH_SHELL_EFFECTIVE: 'bash' }, want: 'bash', label: 'EFFECTIVE=bash -> bash' },
  { env: { DSH_SHELL_EFFECTIVE: 'BASH' }, want: 'bash', label: 'EFFECTIVE=BASH -> bash (case-insensitive)' },
  { env: { DSH_SHELL_EFFECTIVE: 'powershell' }, want: 'powershell', label: 'EFFECTIVE=powershell -> powershell' },
  { env: { DSH_SHELL_EFFECTIVE: 'PWSH' }, want: 'powershell', label: 'EFFECTIVE=PWSH -> powershell' },
  { env: {}, want: 'powershell', label: 'EFFECTIVE unset -> powershell (safe default)' },
];

for (const s of scenarios) {
  const bashOff = evalJsBody(bashBody, s.env);
  const pwshOff = evalJsBody(pwshBody, s.env);
  const active = pwshOff && !bashOff ? 'bash' : bashOff && !pwshOff ? 'powershell' : 'INVALID';
  check(s.label, active === s.want, `got ${active} (bashOff=${bashOff}, pwshOff=${pwshOff})`);
  // The critical invariant: never both, never neither. A partial switch fails
  // the profile load, so both-off and both-on are hard errors.
  check(`  exactly one stack active for ${JSON.stringify(s.env)}`, bashOff !== pwshOff);
}

console.log('\n== 4. package.json bundle contract ==');
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
check('declares dsh.bundle.patch', pkg?.dsh?.bundle?.patch === './cordis.patch.yml');
check('bundle patch file exists', Boolean(readFileSync(patchPath, 'utf8')));
check('type is module', pkg.type === 'module');

console.log(`\n${'='.repeat(46)}`);
console.log(`pass=${pass}  fail=${fail}`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
