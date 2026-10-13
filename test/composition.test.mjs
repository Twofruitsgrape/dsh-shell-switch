/**
 * Composition test — simulates dsh's loader resolution order:
 *
 *   1. each bundle in package.json's dsh.profile.bundles, in order
 *   2. then the profile's cordis.patch.yml
 *   3. last write per row id wins
 *
 * The base bundle ships the platform-gated shell rows; this bundle must
 * override all four of them. This test composes the real base-bundle rows
 * (as extracted from the shipped app.asar) against this bundle and asserts
 * the winning rows are the env-driven ones.
 *
 * Run: node test/composition.test.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** The shipped base bundle's shell rows (verbatim from app.asar). */
const BASE_ROWS = [
  { id: 'bash-sandbox', name: '@deepseek-ai/dsh-bash-sandbox', disabled: 'win32', config: { timeoutMs: 60000 } },
  { id: 'pwsh-sandbox', name: '@deepseek-ai/dsh-pwsh-sandbox', disabled: 'non-win32' },
  { id: 'tool-bash', name: '@deepseek-ai/dsh-tool-bash', disabled: 'win32' },
  { id: 'tool-pwsh', name: '@deepseek-ai/dsh-tool-pwsh', disabled: 'non-win32' },
];

/** Resolve a base row's platform gate the way !!js would on a given platform. */
function baseDisabled(row, platform) {
  if (row.disabled === 'win32') return platform === 'win32';
  if (row.disabled === 'non-win32') return platform !== 'win32';
  return Boolean(row.disabled);
}

/** Read this bundle's !!js expression body for a row. */
function jsBody(id) {
  const src = readFileSync(join(root, 'cordis.patch.yml'), 'utf8').split('\n');
  const start = src.findIndex((l) => l.trim() === `- id: ${id}`);
  if (start < 0) throw new Error(`row not found: ${id}`);
  for (let i = start + 1; i < start + 8 && i < src.length; i++) {
    const m = src[i].match(/^\s*disabled:\s*!!js\s+(.+)$/);
    if (m) return m[1].trim();
  }
  throw new Error(`no !!js disabled for ${id}`);
}

function evalBody(body, env) {
  return new Function('process', `return (${body})`)({ env, platform: 'win32' });
}

/**
 * Compose layers the way the loader does: later rows override earlier ones
 * by id, last write wins.
 */
function compose(layers) {
  const byId = new Map();
  for (const layer of layers) for (const row of layer) byId.set(row.id, row);
  return byId;
}

const rows = ['bash-sandbox', 'pwsh-sandbox', 'tool-bash', 'tool-pwsh'];
const bodies = Object.fromEntries(rows.map((id) => [id, jsBody(id)]));

console.log('\n== 1. Base bundle alone on Windows (the problem) ==');
{
  const composed = compose([BASE_ROWS]);
  const bashOff = baseDisabled(composed.get('bash-sandbox'), 'win32');
  const pwshOff = baseDisabled(composed.get('pwsh-sandbox'), 'win32');
  check('base disables bash on win32', bashOff === true);
  check('base enables pwsh on win32', pwshOff === false);
  console.log('  -> without this bundle: PowerShell only (confirmed root cause)');
}

console.log('\n== 2. Base + this bundle, composed per dsh order ==');
const scenarios = [
  { env: {}, want: 'bash', label: 'DSH_SHELL unset' },
  { env: { DSH_SHELL: 'bash' }, want: 'bash', label: 'DSH_SHELL=bash' },
  { env: { DSH_SHELL: 'powershell' }, want: 'powershell', label: 'DSH_SHELL=powershell' },
  { env: { DSH_SHELL: 'pwsh' }, want: 'powershell', label: 'DSH_SHELL=pwsh' },
];

for (const s of scenarios) {
  // Build this bundle's layer with !!js resolved against the env.
  const bundleLayer = rows.map((id) => ({
    id,
    disabled: evalBody(bodies[id], s.env),
  }));
  const composed = compose([BASE_ROWS, bundleLayer]);

  const bashOff = composed.get('bash-sandbox').disabled;
  const pwshOff = composed.get('pwsh-sandbox').disabled;
  const toolBashOff = composed.get('tool-bash').disabled;
  const toolPwshOff = composed.get('tool-pwsh').disabled;

  const active = !bashOff && pwshOff ? 'bash' : bashOff && !pwshOff ? 'powershell' : 'INVALID';
  check(`${s.label} -> ${s.want}`, active === s.want, `got ${active}`);
  check(`  ${s.label}: executor+tool agree (bash)`, bashOff === toolBashOff);
  check(`  ${s.label}: executor+tool agree (pwsh)`, pwshOff === toolPwshOff);
  check(`  ${s.label}: exactly one stack active`, bashOff !== pwshOff);
}

console.log('\n== 3. Override completeness ==');
{
  const bundleIds = rows;
  const baseIds = BASE_ROWS.map((r) => r.id);
  check('bundle covers every base shell row', baseIds.every((id) => bundleIds.includes(id)),
    `base=${baseIds} bundle=${bundleIds}`);
  // A stack left half-overridden would leave one row platform-gated: the two
  // members could then disagree, which fails the profile load.
  for (const [a, b] of [['bash-sandbox', 'tool-bash'], ['pwsh-sandbox', 'tool-pwsh']]) {
    check(`${a} / ${b} use identical expressions`, bodies[a] === bodies[b]);
  }
}

console.log('\n== 4. Bundle install contract ==');
{
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const patchPath = join(root, pkg.dsh.bundle.patch);
  check('bundle patch path resolves to a real file', existsSync(patchPath));
  check('two-file bundle shape (package.json + patch)', existsSync(join(root, 'package.json')) && existsSync(patchPath));
  check('patch declares no dependency on dsh-shipped packages',
    !readFileSync(patchPath, 'utf8').includes('dependencies'));
}

console.log(`\n${'='.repeat(46)}`);
console.log(`pass=${pass}  fail=${fail}`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
