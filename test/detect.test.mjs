/**
 * Tests for src/detect.mjs — bash resolution used by dsh-shell-switch.
 * Run: node test/detect.test.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  normalizeBashDir,
  resolveBashFromPath,
  bashResidesIn,
  prependPath,
  decideShell,
} from '../src/detect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, 'fixtures');
const GITBIN = join(FX, 'gitbin');          // contains bash.exe (DSH_BASH_DIR target)
const GITREAL = join(FX, 'pf', 'Git', 'bin'); // mirrors C:\Program Files\Git\bin
const EMPTY = join(FX, 'empty');             // empty dir
const BARE_EXE = join(GITBIN, 'bash.exe');   // the executable itself
const NOPE = join(FX, 'nonexistent');        // absent path
const CLEAN = 'C:\\NonexistentDir';          // PATH with no bash (isolated from host)

let pass = 0;
let fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}

console.log('\n== normalizeBashDir ==');
check('dir containing bash.exe', normalizeBashDir(GITBIN) === GITBIN, normalizeBashDir(GITBIN));
check('bare executable path', normalizeBashDir(BARE_EXE) === GITBIN, normalizeBashDir(BARE_EXE));
check('nonexistent dir -> null', normalizeBashDir(join(FX, 'nope')) === null);
check('empty string -> null', normalizeBashDir('') === null);
check('undefined -> null', normalizeBashDir(undefined) === null);

console.log('\n== bashResidesIn ==');
check('true for gitbin', bashResidesIn(GITBIN) === true);
check('false for empty', bashResidesIn(EMPTY) === false);

console.log('\n== resolveBashFromPath ==');
{
  const onGit = resolveBashFromPath({ PATH: `${GITREAL};${CLEAN}` }, 'win32');
  check('finds git-bash first', onGit.kind === 'git-bash' && onGit.path.toLowerCase().endsWith('bash.exe'), JSON.stringify(onGit));
  const onWsl = resolveBashFromPath({ PATH: `C:\\Windows\\system32;C:\\Users\\ALICE\\AppData\\Local\\Microsoft\\WindowsApps` }, 'win32');
  check('classifies WSL stub as wsl', onWsl.kind === 'wsl', JSON.stringify(onWsl));
  const none = resolveBashFromPath({ PATH: CLEAN }, 'win32');
  check('no bash -> null', none.path === null);
}

console.log('\n== prependPath ==');
{
  const p = prependPath(GITBIN, { PATH: 'C:\\Windows\\system32' }, 'win32');
  check('prepends and is first', p.split(';')[0] === GITBIN, p);
  const p2 = prependPath(GITBIN, { PATH: `${GITBIN};C:\\Windows` }, 'win32');
  check('idempotent when already present', p2 === `${GITBIN};C:\\Windows`, p2);
  check('null dir returns original', prependPath(null, { PATH: 'X' }, 'win32') === 'X');
}

console.log('\n== decideShell ==');
{
  // 1. Windows + valid DSH_BASH_DIR -> bash, inject dir
  const a = decideShell({ requested: 'auto', bashDir: GITBIN, env: { PATH: 'C:\\W\\system32' }, platform: 'win32' });
  check('valid DSH_BASH_DIR -> bash', a.shell === 'bash', JSON.stringify(a));
  check('reports source DSH_BASH_DIR', a.source === 'DSH_BASH_DIR', a.source);
  check('injectDir = the dir (not on PATH)', a.injectDir === GITBIN, String(a.injectDir));
  check('bashPath points at bash.exe', a.bashPath.toLowerCase().endsWith('bash.exe'));

  // 2. Windows + bare executable given -> bash via parent dir
  const b = decideShell({ requested: 'auto', bashDir: BARE_EXE, env: { PATH: '' }, platform: 'win32' });
  check('bare exe path -> bash', b.shell === 'bash' && b.bashDir === GITBIN, JSON.stringify(b));

  // 3. Windows + invalid DSH_BASH_DIR -> safe fallback to powershell
  const c = decideShell({ requested: 'auto', bashDir: join(FX, 'nope'), env: { PATH: '' }, platform: 'win32' });
  check('invalid DSH_BASH_DIR -> powershell', c.shell === 'powershell', JSON.stringify(c));
  check('fallback reason mentions DSH_BASH_DIR', /DSH_BASH_DIR/.test(c.reason), c.reason);

  // 4. Windows + no dir set, none on PATH -> powershell (platform default)
  const d = decideShell({ requested: 'auto', bashDir: undefined, env: { PATH: CLEAN }, platform: 'win32' });
  check('no bash anywhere -> powershell (safe default)', d.shell === 'powershell', JSON.stringify(d));

  // 5. Windows + Git\bin already on PATH -> bash via auto, no injection needed
  const e = decideShell({ requested: 'auto', bashDir: undefined, env: { PATH: `${GITREAL};${CLEAN}` }, platform: 'win32' });
  check('git-bash on PATH -> bash', e.shell === 'bash' && e.source === 'PATH:git-bash', JSON.stringify(e));
  check('no injection when already on PATH', e.injectDir === null);

  // 6. explicit powershell wins, needs nothing resolved
  const f = decideShell({ requested: 'powershell', bashDir: GITBIN, env: { PATH: '' }, platform: 'win32' });
  check('DSH_SHELL=powershell -> powershell', f.shell === 'powershell' && f.bashPath === null);

  // 7. explicit pwsh alias
  const g = decideShell({ requested: 'pwsh', bashDir: GITBIN, env: { PATH: '' }, platform: 'win32' });
  check('DSH_SHELL=pwsh -> powershell', g.shell === 'powershell');

  // 8. explicit bash with no bash available -> powershell (graceful)
  const h = decideShell({ requested: 'bash', bashDir: undefined, env: { PATH: '' }, platform: 'win32' });
  check('DSH_SHELL=bash but none -> powershell (not broken)', h.shell === 'powershell', JSON.stringify(h));

  // 9. POSIX: bashDir points at a valid dir -> bash (PATH isolation avoided)
  const i = decideShell({ requested: 'auto', bashDir: GITBIN, env: { PATH: CLEAN }, platform: 'linux' });
  check('linux auto -> bash', i.shell === 'bash', JSON.stringify(i));
}

console.log(`\n${'='.repeat(46)}`);
console.log(`pass=${pass}  fail=${fail}`);
console.log('='.repeat(46));
process.exit(fail ? 1 : 0);
