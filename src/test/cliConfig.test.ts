import { describe, it, expect } from 'vitest';
import { defaultStoragePath, buildConfigFromAnswers, renderEnvFile } from '../cliConfig';

describe('defaultStoragePath', () => {
  it('returns sqlite db path for sqlite', () => {
    expect(defaultStoragePath('sqlite')).toBe('./data/flagforge.db');
  });
  it('returns json path for json', () => {
    expect(defaultStoragePath('json')).toBe('./data/flags.json');
  });
});

describe('buildConfigFromAnswers', () => {
  it('maps answers to ServerConfig', () => {
    const cfg = buildConfigFromAnswers({
      port: 8080,
      storageType: 'json',
      storagePath: './data/flags.json',
      adminPassword: 'secret',
    });
    expect(cfg).toEqual({
      port: 8080,
      storageType: 'json',
      storagePath: './data/flags.json',
      adminPassword: 'secret',
    });
  });

  it('omits adminPassword when empty string', () => {
    const cfg = buildConfigFromAnswers({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
      adminPassword: '',
    });
    expect(cfg.adminPassword).toBeUndefined();
  });
});

describe('renderEnvFile', () => {
  it('renders env without admin password line when absent', () => {
    const env = renderEnvFile({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
    });
    expect(env).toContain('PORT=6789');
    expect(env).toContain('STORAGE_TYPE=sqlite');
    expect(env).toContain('STORAGE_PATH=./data/flagforge.db');
    expect(env).not.toContain('ADMIN_PASSWORD');
  });

  it('renders admin password line when present', () => {
    const env = renderEnvFile({
      port: 6789,
      storageType: 'sqlite',
      storagePath: './data/flagforge.db',
      adminPassword: 'ff_admin_x',
    });
    expect(env).toContain('ADMIN_PASSWORD=ff_admin_x');
  });
});

describe('renderEnvFile with mcpToken', () => {
  it('includes MCP_TOKEN when present', () => {
    const env = renderEnvFile({ port: 6789, storageType: 'sqlite', storagePath: './data/flagforge.db', mcpToken: 'ff_mcp_abc' });
    expect(env).toContain('MCP_TOKEN=ff_mcp_abc');
  });
  it('omits MCP_TOKEN when absent', () => {
    const env = renderEnvFile({ port: 6789, storageType: 'sqlite', storagePath: './data/flagforge.db' });
    expect(env).not.toContain('MCP_TOKEN');
  });
  it('buildConfigFromAnswers propagates mcpToken', () => {
    const cfg = buildConfigFromAnswers({ port: 1, storageType: 'json', storagePath: 'x', mcpToken: 't' });
    expect(cfg.mcpToken).toBe('t');
  });
});
