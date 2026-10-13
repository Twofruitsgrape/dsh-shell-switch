/**
 * dsh-shell-switch — Windows-friendly Bash/PowerShell stack switch for dsh.
 *
 * Problem: the shipped base bundle gates the shell stacks by platform, so a
 * Windows host always gets PowerShell and there is no knob to change it:
 *
 *     - id: bash-sandbox  disabled: !!js process.platform === 'win32'
 *     - id: pwsh-sandbox  disabled: !!js process.platform !== 'win32'
 *
 * Approach: `cordis.patch.yml` hands those four rows an env-driven expression,
 * and this module computes that variable (DSH_SHELL_EFFECTIVE) *before* the
 * patch is evaluated, so the decision can use the filesystem (probe for Git
 * Bash) instead of being limited to a one-line expression.
 *
 * It also makes bash resolvable: when Git Bash exists but its `bin` directory
 * is absent from PATH, the directory is prepended, so the executor's `bash`
 * lookup finds Git Bash rather than the WSL stub at WindowsApps/system32.
 *
 * Controls (all optional):
 *   DSH_SHELL=auto|bash|powershell|pwsh   default `auto`
 *   DSH_SHELL_AUTOCONFIG=0                disable PATH injection
 */

import { decideShell, prependPath } from './src/detect.mjs';

export const name = 'shell-switch';

/** Module-side effect: run before the bundle patch is interpolated. */
const decision = decideShell({
  requested: process.env.DSH_SHELL,
  bashDir: process.env.DSH_BASH_DIR,
  env: process.env,
  platform: process.platform,
});

const autoconfig = String(process.env.DSH_SHELL_AUTOCONFIG ?? '1').toLowerCase();
const autoconfigEnabled = !(autoconfig === '0' || autoconfig === 'false' || autoconfig === 'off');

let injected = null;
if (autoconfigEnabled && decision.injectDir) {
  injected = decision.injectDir;
  process.env.PATH = prependPath(decision.injectDir, process.env, process.platform);
}

// Publish the resolved stack for cordis.patch.yml to read. Using an explicit
// variable keeps the patch expression a trivial string comparison.
process.env.DSH_SHELL_EFFECTIVE = decision.shell;

export const shellDecision = decision;

export function apply(ctx) {
  const log = ctx?.logger ?? console;
  const info =
    `dsh-shell-switch: stack=${decision.shell} (${decision.reason})` +
    (decision.bashPath ? ` bash=${decision.bashPath} [${decision.bashKind}]` : '') +
    (injected ? ` PATH+=${injected}` : '');

  log.info?.(info);

  if (decision.shell === 'bash' && !decision.bashPath) {
    log.warn?.(
      'dsh-shell-switch: bash requested but no bash executable was found. ' +
        'Set DSH_BASH_DIR to a Git-Bash bin directory (e.g. C:\\Program Files\\Git\\bin), then restart.'
    );
  }
  if (decision.shell === 'powershell' && String(process.env.DSH_SHELL ?? '').toLowerCase() === 'bash') {
    log.warn?.('dsh-shell-switch: DSH_SHELL=bash but no bash found; using PowerShell.');
  }
  if (decision.shell === 'powershell' && process.env.DSH_BASH_DIR && !decision.bashPath) {
    log.warn?.(`dsh-shell-switch: DSH_BASH_DIR=${process.env.DSH_BASH_DIR} does not contain bash.exe; using PowerShell.`);
  }
  if (!autoconfigEnabled) {
    log.info?.('dsh-shell-switch: autoconfig disabled (DSH_SHELL_AUTOCONFIG=0).');
  }
}
