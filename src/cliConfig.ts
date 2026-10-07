import { ServerConfig, resolveHost } from './server.js';

export interface WizardAnswers {
  port: number;
  host: string;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
  mcpToken?: string;
}

export function defaultStoragePath(storageType: 'sqlite' | 'json'): string {
  return storageType === 'json' ? './data/flags.json' : './data/flagforge.db';
}

export function buildConfigFromAnswers(answers: WizardAnswers): ServerConfig {
  return {
    port: answers.port,
    host: resolveHost(answers.host),
    storageType: answers.storageType,
    storagePath: answers.storagePath,
    adminPassword: answers.adminPassword ? answers.adminPassword : undefined,
    mcpToken: answers.mcpToken ? answers.mcpToken : undefined,
  };
}

export function renderEnvFile(config: ServerConfig): string {
  const lines = [`PORT=${config.port}`];
  if (config.host) {
    lines.push(`HOST=${config.host}`);
  }
  lines.push(
    `STORAGE_TYPE=${config.storageType}`,
    `STORAGE_PATH=${config.storagePath}`,
  );
  if (config.adminPassword) {
    lines.push(`ADMIN_PASSWORD=${config.adminPassword}`);
  }
  if (config.mcpToken) {
    lines.push(`MCP_TOKEN=${config.mcpToken}`);
  }
  return lines.join('\n') + '\n';
}
