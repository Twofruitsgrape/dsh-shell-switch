/**
 * Integration test for the real load order:
 *
 *   dsh loads the bundle module (index.js)  ->  it sets DSH_SHELL_EFFECTIVE
 *   and (optionally) prepends the bash dir to PATH
 *   THEN the loader interpolates cordis.patch.yml  ->  rows read DSH_SHELL_EFFECTIVE
 *
 * We spawn a clean child per scenario so process.env / PATH isolation is real
 * (not mocked), import index.js, then re-evaluate the patch expressions against
 * the child's resulting environment. This proves the two halves agree end to end.
 *
 * Run: node test/integration.test.mjs
 */

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const GITBIN = join(root, 'test', 'fixtures', 'gitbin');

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

/** The patch expressions, as raw strings, for re-evaluation. */
function patchBodies() {
  const src = readFileSync(join(root, 'cordis.patch.yml'), 'utf8').split('\n');
  const find = (id) => {
    const i = src.findIndex((l) => new RegExp(`^\\s*-?\\s*id:\\s*${id}\\s*$`).test(l));
    for (let j = i + 1; j < i + 8; j++) {
      const m = src[j].match(/^\s*disabled:\s*!!js\s+(.+?)\r?$/);
      if (m) return m[1].trim();
    }
    throw new Error('no body for ' + id);
  };
  return { bash: find('bash-sandbox'), pwsh: find('pwsh-sandbox') };
}

/** Run one scenario in a clean node child, return {effective, pathHead, active}. */
function runScenario(env) {
  const bodies = patchBodies();
  const child = spawnSync(process.execPath, ['-e', `
    import('./index.js').then(async (m) => {
      const eff = process.env.DSH_SHELL_EFFECTIVE;
      const pathHead = (process.env.PATH || '').split(process.platform === 'win32' ? ';' : ':')[0];
      // Re-evaluate the patch expressions against this child's final env.
      const bashOff = new Function('process', 'return (' + ${JSON.stringify(bodies.bash)} + ')')({ env: process.env });
      const pwshOff = new Function('process', 'return (' + ${JSON.stringify(bodies.pwsh)} + ')')({ env: process.env });
      const active = pwshOff && !bashOff ? 'bash' : bashOff && !pwshOff ? 'powershell' : 'INVALID';
      console.log(JSON.stringify({ effective: eff, pathHead, active }));
    }).catch((e) => { console.error('IMPORT FAIL', e); process.exit(2); });
  `], {
    cwd: root,
    env: { ...env, PATH: env.PATH ?? 'C:\\NonexistentDir', NODE_PATH: undefined },
    encoding: 'utf8',
  });
  if (child.status !== 0) throw new Error('child failed: ' + child.stderr);
  return JSON.parse(child.stdout.trim().split('\n').pop());
}

const scenarios = [
  {
    label: 'DSH_BASH_DIR -> valid bash',
    env: { DSH_BASH_DIR: GITBIN },
    want: 'bash',
    wantInjected: GITBIN.replace(/\\/g, '\\'),
  },
  {
    label: 'DSH_SHELL=powershell forces back',
    env: { DSH_SHELL: 'powershell', DSH_BASH_DIR: GITBIN },
    want: 'powershell',
    wantInjected: null,
  },
  {
    label: 'no bash configured -> safe powershell',
    env: {},
    want: 'powershell',
    wantInjected: null,
  },
  {
    label: 'DSH_SHELL=bash + valid dir',
    env: { DSH_SHELL: 'bash', DSH_BASH_DIR: GITBIN },
    want: 'bash',
    wantInjected: GITBIN,
  },
];

console.log('\n== Integration: index.js side effects + patch expressions ==');
for (const s of scenarios) {
  const r = runScenario(s.env);
  check(`${s.label}: active=${s.want}`, r.active === s.want, `got ${r.active}`);
  check(`${s.label}: DSH_SHELL_EFFECTIVE=${s.want}`, r.effective === s.want, `got ${r.effective}`);
  if (s.wantInjected) {
    check(`${s.label}: PATH prepended with bash dir`, normalize(r.pathHead) === normalize(s.wantInjected),
      `head=${r.pathHead}`);
  } else {
    check(`${s.label}: PATH untouched`, r.pathHead === 'C:\\NonexistentDir', `head=${r.pathHead}`);
  }
}

function normalize(p) { return String(p).replace(/\\/g, '/').toLowerCase(); }

console.log(`\n${'='.repeat(46)}`);
console.log(`pass=${pass}  fail=${fail}`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
