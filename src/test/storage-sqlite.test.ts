import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';
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
      const updated = await storage.regenerateEnvironmentKey(env.id);
      expect(updated.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(updated.key).not.toBe(oldKey);
    });

    it('throws for unknown envId', async () => {
      await expect(storage.regenerateEnvironmentKey('nope')).rejects.toThrow('Environment not found');
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
});
