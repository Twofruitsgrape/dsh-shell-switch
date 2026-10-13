/**
 * Bash resolution for dsh-shell-switch.
 *
 * The user points the plugin at a Git-Bash location via DSH_BASH_DIR (a
 * directory containing bash, or a bash executable path). We verify it, and
 * when valid we report the directory so the host can prepend it to PATH so
 * the shell executor's `bash` lookup finds Git Bash before any WSL stub.
 *
 * Kept free of dsh imports so it can be unit-tested directly.
 */

import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';

/** Known WSL entry points: valid bash, but not Git Bash. */
const WSL_STUBS = new Set([
  'c:\\windows\\system32\\bash.exe',
  'c:\\users\\alice\\appdata\\local\\microsoft\\windowsapps\\bash.exe',
]);

function isFile(p) {
  try {
    return !!p && existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
function isDir(p) {
  try {
    return !!p && existsSync(p) && statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Normalise a DSH_BASH_DIR value into a bin directory that (should) hold
 * bash.exe / bash. Accepts either the executable or its parent directory.
 * @returns {string|null} absolute directory, or null when unreadable.
 */
export function normalizeBashDir(input) {
  if (!input || typeof input !== 'string') return null;
  const p = normalize(input.trim());
  if (isFile(p)) return dirname(p);
  if (isDir(p)) return p;
  return null;
}

/**
 * Walk PATH the way a shell executor would. Returns the first `bash` found,
 * classified as 'git-bash' | 'wsl' | 'other'.
 */
export function resolveBashFromPath(env = process.env, platform = process.platform) {
  const pathSep = platform === 'win32' ? ';' : ':';
  const pathExts = platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  const dirs = String(env.PATH ?? env.Path ?? '').split(pathSep).filter(Boolean);
  for (const d of dirs) {
    for (const ext of pathExts) {
      const candidate = ext ? join(d, 'bash' + ext) : join(d, 'bash');
      if (!isFile(candidate)) continue;
      const lower = candidate.toLowerCase();
      if (lower.includes(sep + 'git' + sep) || lower.replace(/\\/g, '/').includes('/git/')) {
        return { path: candidate, kind: 'git-bash' };
      }
      if (WSL_STUBS.has(lower)) return { path: candidate, kind: 'wsl' };
      return { path: candidate, kind: 'other' };
    }
  }
  return { path: null, kind: null };
}

/** True when `dir` actually contains a usable bash executable. */
export function bashResidesIn(dir) {
  if (!dir) return false;
  return isFile(join(dir, 'bash.exe')) || isFile(join(dir, 'bash'));
}

/** Prepend `dir` to PATH idempotently; returns the new PATH string. */
export function prependPath(dir, env = process.env, platform = process.platform) {
  if (!dir) return String(env.PATH ?? env.Path ?? '');
  const pathSep = platform === 'win32' ? ';' : ':';
  const cur = String(env.PATH ?? env.Path ?? '');
  const parts = cur.split(pathSep).filter(Boolean);
  if (parts.some((p) => normalize(p).toLowerCase() === normalize(dir).toLowerCase())) return cur;
  return [dir, ...parts].join(pathSep);
}

/**
 * Decide the effective shell stack.
 *
 * @param {object} opts
 * @param {string|undefined} opts.requested   DSH_SHELL value
 * @param {string|undefined} opts.bashDir     DSH_BASH_DIR value (user-supplied)
 * @param {object} opts.env
 * @param {string} opts.platform
 * @returns {{shell:'bash'|'powershell', bashPath:string|null, bashDir:string|null,
 *            injectDir:string|null, source:string, reason:string}}
 */
export function decideShell({ requested, bashDir, env = process.env, platform = process.platform } = {}) {
  const req = String(requested ?? 'auto').trim().toLowerCase();

  // Explicit PowerShell always wins and needs nothing resolved.
  if (req === 'powershell' || req === 'pwsh') {
    return { shell: 'powershell', bashPath: null, bashDir: null, injectDir: null, source: 'env', reason: 'explicit powershell' };
  }

  // Prefer the user-supplied directory; fall back to a PATH-resolved bash.
  const dir = normalizeBashDir(bashDir);
  let candidate = null;
  let source = null;
  if (dir && bashResidesIn(dir)) {
    candidate = join(dir, platform === 'win32' ? 'bash.exe' : 'bash');
    source = 'DSH_BASH_DIR';
  } else {
    const onPath = resolveBashFromPath(env, platform);
    if (onPath.path) {
      candidate = onPath.path;
      source = onPath.kind === 'git-bash' ? 'PATH:git-bash' : `PATH:${onPath.kind}`;
    }
  }

  if (candidate) {
    const dirForInject = dir || (candidate && bashResidesIn(dirname(candidate)) ? dirname(candidate) : null);
    const onPathAlready = dirForInject && String(env.PATH ?? '').toLowerCase().includes(normalize(dirForInject).toLowerCase());
    return {
      shell: 'bash',
      bashPath: candidate,
      bashDir: dirForInject,
      injectDir: onPathAlready ? null : dirForInject,
      source,
      reason: source === 'DSH_BASH_DIR' ? 'user directory' : source,
    };
  }

  // No bash available: keep the platform default (PowerShell on Windows).
  const reason = bashDir ? 'DSH_BASH_DIR invalid; falling back' : 'no bash found; default';
  return { shell: 'powershell', bashPath: null, bashDir: null, injectDir: null, source: 'default', reason };
}
