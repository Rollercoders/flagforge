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

export function runUpdate(deps: UpdaterDeps): void {
  const { currentVersion, run, hasCommand, log } = deps;

  const view = run('npm', ['view', 'flagforge', 'version']);
  if (view.status !== 0) {
    log('Impossibile determinare l’ultima versione su npm.');
    if (view.stderr.trim()) log(view.stderr.trim());
    return;
  }
  const latest = view.stdout.trim();
  if (!latest) {
    log('Impossibile determinare l’ultima versione su npm.');
    return;
  }

  if (latest === currentVersion) {
    log(`Già all’ultima versione (${currentVersion}).`);
    return;
  }

  const install = run('npm', ['install', '-g', 'flagforge@latest']);
  if (install.status !== 0) {
    if (isPermissionError(install)) {
      log('Impossibile aggiornare: permessi insufficienti.');
      log('Esegui come root:');
      log('  npm i -g flagforge@latest');
      if (hasCommand('nodenv')) log('  nodenv rehash');
      return;
    }
    log('Aggiornamento fallito.');
    if (install.stderr.trim()) log(install.stderr.trim());
    return;
  }

  if (hasCommand('nodenv')) {
    run('nodenv', ['rehash']);
  } else {
    log('nodenv non rilevato: salto il rehash.');
  }

  log(`Aggiornato da ${currentVersion} a ${latest}.`);
  log('Riavvia il servizio per applicare la nuova versione.');
}
