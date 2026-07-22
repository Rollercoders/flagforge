import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';

describe('SqliteStorage', () => {
  let storage: SqliteStorage;
  const testDbPath = path.join(__dirname, '../../test-data/sqlite-test.db');

  beforeEach(async () => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    const dir = path.dirname(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new SqliteStorage(testDbPath);
    await storage.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('createProject', () => {
    it('creates a project and returns it', async () => {
      const p = await storage.createProject({ name: 'MyApp' });
      expect(p.id).toBeDefined();
      expect(p.name).toBe('MyApp');
      expect(p.createdAt).toBeDefined();
    });

    it('throws on duplicate name', async () => {
      await storage.createProject({ name: 'Dup' });
      await expect(storage.createProject({ name: 'Dup' })).rejects.toThrow();
    });
  });

  describe('getProject', () => {
    it('returns null for unknown id', async () => {
      expect(await storage.getProject('nope')).toBeNull();
    });

    it('returns the project by id', async () => {
      const p = await storage.createProject({ name: 'X' });
      const found = await storage.getProject(p.id);
      expect(found?.name).toBe('X');
    });
  });

  describe('getAllProjects', () => {
    it('returns empty array initially', async () => {
      expect(await storage.getAllProjects()).toHaveLength(0);
    });

    it('returns all created projects', async () => {
      await storage.createProject({ name: 'A' });
      await storage.createProject({ name: 'B' });
      expect(await storage.getAllProjects()).toHaveLength(2);
    });
  });

  describe('deleteProject', () => {
    it('deletes the project and cascades to environments and flags', async () => {
      const p = await storage.createProject({ name: 'Del' });
      await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      await storage.deleteProject(p.id);
      expect(await storage.getProject(p.id)).toBeNull();
      expect(await storage.getEnvironmentsByProject(p.id)).toHaveLength(0);
    });
  });

  describe('createEnvironment', () => {
    it('creates an environment with a ff_ key', async () => {
      const p = await storage.createProject({ name: 'App' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'production' });
      expect(env.id).toBeDefined();
      expect(env.name).toBe('production');
      expect(env.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
    });

    it('generates unique keys for each environment', async () => {
      const p = await storage.createProject({ name: 'App2' });
      const e1 = await storage.createEnvironment({ projectId: p.id, name: 'staging' });
      const e2 = await storage.createEnvironment({ projectId: p.id, name: 'production' });
      expect(e1.key).not.toBe(e2.key);
    });

    it('throws on duplicate name within same project', async () => {
      const p = await storage.createProject({ name: 'App3' });
      await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      await expect(storage.createEnvironment({ projectId: p.id, name: 'prod' })).rejects.toThrow();
    });
  });

  describe('getEnvironmentsByProject', () => {
    it('returns environments with keys', async () => {
      const p = await storage.createProject({ name: 'App4' });
      await storage.createEnvironment({ projectId: p.id, name: 'staging' });
      const envs = await storage.getEnvironmentsByProject(p.id);
      expect(envs).toHaveLength(1);
      expect(envs[0].key).toMatch(/^ff_/);
    });
  });

  describe('getEnvironmentByKey', () => {
    it('returns the environment matching the key', async () => {
      const p = await storage.createProject({ name: 'App5' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const found = await storage.getEnvironmentByKey(env.key);
      expect(found?.id).toBe(env.id);
      expect(found?.projectId).toBe(p.id);
    });

    it('returns null for unknown key', async () => {
      expect(await storage.getEnvironmentByKey('ff_doesnotexist')).toBeNull();
    });
  });

  describe('regenerateEnvironmentKey', () => {
    it('generates a new ff_ key different from the old one', async () => {
      const p = await storage.createProject({ name: 'App6' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const oldKey = env.key;
      const updated = await storage.regenerateEnvironmentKey(env.id, 'client');
      expect(updated.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(updated.key).not.toBe(oldKey);
    });

    it('throws for unknown envId', async () => {
      await expect(storage.regenerateEnvironmentKey('nope', 'client')).rejects.toThrow('Environment not found');
    });
  });

  describe('deleteEnvironment', () => {
    it('removes the environment and its flags', async () => {
      const p = await storage.createProject({ name: 'App7' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'staging' });
      await storage.createFlag({ projectId: p.id, key: 'f', name: 'F', enabled: false, environment: 'staging' });
      await storage.deleteEnvironment(env.id);
      const envs = await storage.getEnvironmentsByProject(p.id);
      expect(envs.find(e => e.id === env.id)).toBeUndefined();
      expect(await storage.getFlag(p.id, 'f', 'staging')).toBeNull();
    });
  });

  describe('renameEnvironment', () => {
    it('renames and cascades to flags', async () => {
      const p = await storage.createProject({ name: 'App8' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'old' });
      await storage.createFlag({ projectId: p.id, key: 'ff', name: 'FF', enabled: false, environment: 'old' });
      const updated = await storage.renameEnvironment(env.id, 'new');
      expect(updated.name).toBe('new');
      expect(await storage.getFlag(p.id, 'ff', 'new')).not.toBeNull();
      expect(await storage.getFlag(p.id, 'ff', 'old')).toBeNull();
    });
  });

  describe('bootstrapAdminKey / getAdminKey', () => {
    it('getAdminKey returns null before bootstrap', async () => {
      expect(await storage.getAdminKey()).toBeNull();
    });

    it('bootstrapAdminKey creates a ff_ admin key', async () => {
      await storage.bootstrapAdminKey();
      const key = await storage.getAdminKey();
      expect(key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
    });

    it('bootstrapAdminKey is idempotent', async () => {
      await storage.bootstrapAdminKey();
      const first = await storage.getAdminKey();
      await storage.bootstrapAdminKey();
      const second = await storage.getAdminKey();
      expect(first).toBe(second);
    });
  });

  describe('createFlag', () => {
    it('creates a flag across all environments in the project', async () => {
      const p = await storage.createProject({ name: 'FlagApp' });
      await storage.createEnvironment({ projectId: p.id, name: 'staging' });
      await storage.createEnvironment({ projectId: p.id, name: 'production' });
      const flags = await storage.createFlag({ projectId: p.id, key: 'my-flag', name: 'My Flag', enabled: false, environment: 'staging' });
      expect(flags).toHaveLength(2);
      const envs = flags.map(f => f.environment).sort();
      expect(envs).toEqual(['production', 'staging']);
    });
  });

  describe('getFlag / updateFlag / deleteFlag', () => {
    it('round-trips a flag', async () => {
      const p = await storage.createProject({ name: 'FlagApp2' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const [flag] = await storage.createFlag({ projectId: p.id, key: 'k', name: 'K', enabled: false, environment: env.name });
      const got = await storage.getFlag(p.id, 'k', env.name);
      expect(got?.id).toBe(flag.id);
      const updated = await storage.updateFlag(flag.id, { enabled: true });
      expect(updated.enabled).toBe(true);
      await storage.deleteFlag(p.id, 'k');
      expect(await storage.getFlag(p.id, 'k', env.name)).toBeNull();
    });
  });

  describe('Typed flags', () => {
    it('persists and reads a number flag round-trip', async () => {
      const project = await storage.createProject({ name: 'typed-proj' });
      await storage.createFlag({
        projectId: project.id, key: 'max-items', name: 'Max Items',
        enabled: true, environment: 'production',
        type: 'number', value: 25, defaultValue: 10,
      });
      const flag = await storage.getFlag(project.id, 'max-items', 'production');
      expect(flag?.type).toBe('number');
      expect(flag?.value).toBe(25);
      expect(flag?.defaultValue).toBe(10);
    });

    it('preserves string vs number distinction', async () => {
      const project = await storage.createProject({ name: 'typed-proj-2' });
      await storage.createFlag({
        projectId: project.id, key: 'label', name: 'Label',
        enabled: true, environment: 'production',
        type: 'string', value: '25', defaultValue: 'x',
      });
      const flag = await storage.getFlag(project.id, 'label', 'production');
      expect(flag?.type).toBe('string');
      expect(flag?.value).toBe('25');
      expect(typeof flag?.value).toBe('string');
    });

    it('defaults legacy flags (no type) to boolean', async () => {
      const project = await storage.createProject({ name: 'legacy-proj' });
      await storage.createFlag({
        projectId: project.id, key: 'old-flag', name: 'Old',
        enabled: true, environment: 'production',
      });
      const flag = await storage.getFlag(project.id, 'old-flag', 'production');
      expect(flag?.type).toBe('boolean');
    });

    it('migrates a pre-existing file DB with the old flags schema (no type/value/default_value)', async () => {
      const legacyDbPath = path.join(__dirname, '../../test-data/sqlite-legacy-test.db');
      if (fs.existsSync(legacyDbPath)) fs.unlinkSync(legacyDbPath);
      const dir = path.dirname(legacyDbPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

      // Crea un DB con lo schema VECCHIO dei flag (senza type/value/default_value)
      // e una riga già presente, simulando un'installazione pre-esistente.
      const legacyDb = new Database(legacyDbPath);
      legacyDb.exec(`
        CREATE TABLE flags (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT '',
          key TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 0,
          environment TEXT NOT NULL,
          targeting TEXT,
          rollout TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE(project_id, key, environment)
        );
      `);
      const now = new Date().toISOString();
      legacyDb.prepare(
        'INSERT INTO flags (id, project_id, key, name, description, enabled, environment, targeting, rollout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run('legacy-id', 'legacy-project', 'legacy-flag', 'Legacy Flag', null, 1, 'production', null, null, now, now);
      legacyDb.close();

      try {
        const legacyStorage = new SqliteStorage(legacyDbPath);
        await legacyStorage.initialize();

        const flag = await legacyStorage.getFlag('legacy-project', 'legacy-flag', 'production');
        expect(flag?.type).toBe('boolean');
        expect(flag?.enabled).toBe(true);
      } finally {
        if (fs.existsSync(legacyDbPath)) fs.unlinkSync(legacyDbPath);
      }
    });

    it('updates value and defaultValue on a number flag', async () => {
      const project = await storage.createProject({ name: 'typed-update' });
      const [flag] = await storage.createFlag({
        projectId: project.id, key: 'quota', name: 'Quota',
        enabled: true, environment: 'production',
        type: 'number', value: 5, defaultValue: 1,
      });
      await storage.updateFlag(flag.id, { value: 9, defaultValue: 3 });
      const updated = await storage.getFlag(project.id, 'quota', 'production');
      expect(updated?.value).toBe(9);
      expect(updated?.defaultValue).toBe(3);
    });

    it('clears value to undefined when updateFlag is called with value null', async () => {
      const project = await storage.createProject({ name: 'typed-clear' });
      const [flag] = await storage.createFlag({
        projectId: project.id, key: 'quota-clear', name: 'Quota Clear',
        enabled: true, environment: 'production',
        type: 'number', value: 5, defaultValue: 1,
      });
      await storage.updateFlag(flag.id, { value: null } as any);
      const updated = await storage.getFlag(project.id, 'quota-clear', 'production');
      expect(updated?.value).toBeUndefined();
    });

    it('backfills a typed flag into a newly created environment', async () => {
      const project = await storage.createProject({ name: 'typed-backfill' });
      await storage.createEnvironment({ projectId: project.id, name: 'production' });
      await storage.createFlag({
        projectId: project.id, key: 'ratio', name: 'Ratio',
        enabled: true, environment: 'production',
        type: 'number', value: 7, defaultValue: 2,
      });
      await storage.createEnvironment({ projectId: project.id, name: 'staging' });
      const backfilled = await storage.getFlag(project.id, 'ratio', 'staging');
      expect(backfilled).not.toBeNull();
      expect(backfilled?.type).toBe('number');
      expect(backfilled?.value).toBe(7);
      expect(backfilled?.defaultValue).toBe(2);
    });
  });

  describe('API key roles', () => {
    it('creates an environment with both a client and a secret key', async () => {
      const project = await storage.createProject({ name: 'keys-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      expect(env.key).toMatch(/^ff_/);
      expect(env.secretKey).toMatch(/^ffs_/);
      expect(env.secretKey).not.toBe(env.key);
    });

    it('resolves a client token to role client and a secret token to role secret', async () => {
      const project = await storage.createProject({ name: 'resolve-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const asClient = await storage.getEnvironmentByAnyKey(env.key);
      const asSecret = await storage.getEnvironmentByAnyKey(env.secretKey);
      expect(asClient?.role).toBe('client');
      expect(asSecret?.role).toBe('secret');
      expect(await storage.getEnvironmentByAnyKey('ff_unknown')).toBeNull();
    });

    it('regenerates client and secret keys independently', async () => {
      const project = await storage.createProject({ name: 'regen-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      const afterClient = await storage.regenerateEnvironmentKey(env.id, 'client');
      expect(afterClient.key).not.toBe(env.key);
      expect(afterClient.secretKey).toBe(env.secretKey); // untouched
      const afterSecret = await storage.regenerateEnvironmentKey(env.id, 'secret');
      expect(afterSecret.secretKey).not.toBe(env.secretKey);
      expect(afterSecret.key).toBe(afterClient.key); // untouched
    });

    it('backfills a secret key for an environment created with the old schema', async () => {
      // create env, then null out its secret_key to simulate a pre-migration row
      const project = await storage.createProject({ name: 'legacy-proj' });
      const env = await storage.createEnvironment({ projectId: project.id, name: 'production' });
      (storage as any).db.prepare('UPDATE environments SET secret_key = NULL WHERE id = ?').run(env.id);
      await storage.backfillSecretKeys(); // idempotent backfill, also called in initialize()
      const reloaded = (await storage.getEnvironmentsByProject(project.id))[0];
      expect(reloaded.secretKey).toMatch(/^ffs_/);
    });
  });
});
