import { ServerConfig } from './server.js';

export interface WizardAnswers {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
}

export function defaultStoragePath(storageType: 'sqlite' | 'json'): string {
  return storageType === 'json' ? './data/flags.json' : './data/flagforge.db';
}

export function buildConfigFromAnswers(answers: WizardAnswers): ServerConfig {
  return {
    port: answers.port,
    storageType: answers.storageType,
    storagePath: answers.storagePath,
    adminPassword: answers.adminPassword ? answers.adminPassword : undefined,
  };
}

export function renderEnvFile(config: ServerConfig): string {
  const lines = [
    `PORT=${config.port}`,
    `STORAGE_TYPE=${config.storageType}`,
    `STORAGE_PATH=${config.storagePath}`,
  ];
  if (config.adminPassword) {
    lines.push(`ADMIN_PASSWORD=${config.adminPassword}`);
  }
  return lines.join('\n') + '\n';
}
