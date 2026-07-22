import { describe, it, expect } from 'vitest';
import { runUpdate, UpdaterDeps } from '../updater';

function makeDeps(overrides: Partial<UpdaterDeps> = {}): { deps: UpdaterDeps; out: string[] } {
  const out: string[] = [];
  const deps: UpdaterDeps = {
    currentVersion: '0.3.2',
    run: (cmd, args) => {
      if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.3.2\n', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    },
    hasCommand: () => true,
    log: (m) => out.push(m),
    ...overrides,
  };
  return { deps, out };
}

describe('runUpdate', () => {
  it('reports already up to date when npm latest equals current', () => {
    const { deps, out } = makeDeps();
    runUpdate(deps);
    expect(out.join('\n')).toMatch(/already on the latest version.*0\.3\.2/i);
  });

  it('installs and reports upgraded when a newer version exists', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(calls).toContainEqual(['npm', 'install', '-g', 'flagforge@latest']);
    expect(calls).toContainEqual(['nodenv', 'rehash']);
    expect(out.join('\n')).toMatch(/updated from 0\.3\.2 to 0\.4\.0/i);
  });

  it('skips nodenv rehash when nodenv is not on PATH', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      hasCommand: (cmd) => cmd !== 'nodenv',
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(calls.some(c => c[0] === 'nodenv')).toBe(false);
    expect(out.join('\n')).toMatch(/updated/i);
  });

  it('prints root install commands (no restart) when install fails with EACCES', () => {
    const { deps, out } = makeDeps({
      run: (cmd, args) => {
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        if (cmd === 'npm' && args[0] === 'install') {
          const err = new Error('EACCES') as NodeJS.ErrnoException;
          err.code = 'EACCES';
          return { status: 1, stdout: '', stderr: 'permission denied', error: err };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    const text = out.join('\n');
    expect(text).toMatch(/insufficient permissions/i);
    expect(text).toMatch(/npm i(nstall)? -g flagforge@latest/i);
  });

  it('reports a generic install failure without mentioning permissions', () => {
    const { deps, out } = makeDeps({
      run: (cmd, args) => {
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        if (cmd === 'npm' && args[0] === 'install') {
          return { status: 1, stdout: '', stderr: 'network error' };
        }
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    const text = out.join('\n');
    expect(text).toMatch(/update failed/i);
    expect(text).not.toMatch(/insufficient permissions/i);
  });

  it('does not downgrade when the local version is newer than the published latest', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      currentVersion: '0.5.0',
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(out.join('\n')).toMatch(/newer.*nothing to update/i);
    expect(calls.some((c) => c[0] === 'npm' && c[1] === 'install')).toBe(false);
  });

  it('proceeds with install when the published latest is newer than the local version', () => {
    const calls: string[][] = [];
    const { deps, out } = makeDeps({
      currentVersion: '0.3.2',
      run: (cmd, args) => {
        calls.push([cmd, ...args]);
        if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: '0.4.0\n', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    });
    runUpdate(deps);
    expect(calls).toContainEqual(['npm', 'install', '-g', 'flagforge@latest']);
    expect(out.join('\n')).toMatch(/updated from 0\.3\.2 to 0\.4\.0/i);
  });

  it('never prints a restart command in any branch', () => {
    for (const latest of ['0.3.2', '0.4.0']) {
      const { deps, out } = makeDeps({
        run: (cmd, args) => {
          if (cmd === 'npm' && args[0] === 'view') return { status: 0, stdout: `${latest}\n`, stderr: '' };
          return { status: 0, stdout: '', stderr: '' };
        },
      });
      runUpdate(deps);
      expect(out.join('\n')).not.toMatch(/pm2|systemctl|restart the service with/i);
    }
  });
});
