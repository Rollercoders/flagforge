export interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
  error?: NodeJS.ErrnoException;
}

export interface UpdaterDeps {
  currentVersion: string;
  run: (cmd: string, args: string[]) => RunResult;
  hasCommand: (cmd: string) => boolean;
  log: (msg: string) => void;
}

function isPermissionError(res: RunResult): boolean {
  if (res.error?.code === 'EACCES') return true;
  return /eacces|permission denied|EACCES/i.test(res.stderr);
}

/**
 * Simple comparison of "X.Y.Z" versions (no pre-release/build metadata).
 * Returns a negative number if a < b, positive if a > b, 0 if equal.
 * Missing or non-numeric components are treated as 0.
 */
function compareVersions(a: string, b: string): number {
  const parse = (v: string): number[] =>
    v
      .trim()
      .split('.')
      .slice(0, 3)
      .map((part) => {
        const n = parseInt(part, 10);
        return Number.isNaN(n) ? 0 : n;
      });

  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);

  if (aMajor !== bMajor) return aMajor - bMajor;
  if (aMinor !== bMinor) return aMinor - bMinor;
  return aPatch - bPatch;
}

export function runUpdate(deps: UpdaterDeps): void {
  const { currentVersion, run, hasCommand, log } = deps;

  const view = run('npm', ['view', 'flagforge', 'version']);
  if (view.status !== 0) {
    log('Unable to determine the latest version on npm.');
    if (view.stderr.trim()) log(view.stderr.trim());
    return;
  }
  const latest = view.stdout.trim();
  if (!latest) {
    log('Unable to determine the latest version on npm.');
    return;
  }

  const cmp = compareVersions(currentVersion, latest);

  if (cmp === 0) {
    log(`Already on the latest version (${currentVersion}).`);
    return;
  }

  if (cmp > 0) {
    log(`Local version (${currentVersion}) is newer than the published one (${latest}): nothing to update.`);
    return;
  }

  const install = run('npm', ['install', '-g', 'flagforge@latest']);
  if (install.status !== 0) {
    if (isPermissionError(install)) {
      log('Unable to update: insufficient permissions.');
      log('Run as root:');
      log('  npm i -g flagforge@latest');
      if (hasCommand('nodenv')) log('  nodenv rehash');
      return;
    }
    log('Update failed.');
    if (install.stderr.trim()) log(install.stderr.trim());
    return;
  }

  if (hasCommand('nodenv')) {
    run('nodenv', ['rehash']);
  } else {
    log('nodenv not detected: skipping rehash.');
  }

  log(`Updated from ${currentVersion} to ${latest}.`);
  log('Restart the service to apply the new version.');
}
