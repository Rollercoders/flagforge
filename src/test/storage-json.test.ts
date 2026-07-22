import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonStorage } from '../storage/json';
import * as fs from 'fs';
import * as path from 'path';

describe('JsonStorage', () => {
  let storage: JsonStorage;
  const testFilePath = path.join(__dirname, '../../test-data/json-test.json');

  beforeEach(async () => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    const dir = path.dirname(testFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new JsonStorage(testFilePath);
    await storage.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  describe('createEnvironment', () => {
    it('creates an environment with a ff_ key', async () => {
      const p = await storage.createProject({ name: 'App' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'production' });
      expect(env.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
    });

    it('persists key to disk', async () => {
      const p = await storage.createProject({ name: 'App2' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const storage2 = new JsonStorage(testFilePath);
      await storage2.initialize();
      const envs = await storage2.getEnvironmentsByProject(p.id);
      expect(envs[0].key).toBe(env.key);
    });

    it('throws on duplicate name within same project', async () => {
      const p = await storage.createProject({ name: 'App3' });
      await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      await expect(storage.createEnvironment({ projectId: p.id, name: 'prod' })).rejects.toThrow();
    });
  });

  describe('getEnvironmentByKey', () => {
    it('returns the matching environment', async () => {
      const p = await storage.createProject({ name: 'App4' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const found = await storage.getEnvironmentByKey(env.key);
      expect(found?.id).toBe(env.id);
    });

    it('returns null for unknown key', async () => {
      expect(await storage.getEnvironmentByKey('ff_unknown')).toBeNull();
    });
  });

  describe('regenerateEnvironmentKey', () => {
    it('returns a new ff_ key', async () => {
      const p = await storage.createProject({ name: 'App5' });
      const env = await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      const updated = await storage.regenerateEnvironmentKey(env.id);
      expect(updated.key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
      expect(updated.key).not.toBe(env.key);
    });

    it('throws for unknown envId', async () => {
      await expect(storage.regenerateEnvironmentKey('nope')).rejects.toThrow('Environment not found');
    });
  });

  describe('bootstrapAdminKey / getAdminKey', () => {
    it('getAdminKey returns null before bootstrap', async () => {
      expect(await storage.getAdminKey()).toBeNull();
    });

    it('bootstrapAdminKey creates a ff_ key', async () => {
      await storage.bootstrapAdminKey();
      const key = await storage.getAdminKey();
      expect(key).toMatch(/^ff_[a-zA-Z0-9_-]{32}$/);
    });

    it('bootstrapAdminKey is idempotent', async () => {
      await storage.bootstrapAdminKey();
      const first = await storage.getAdminKey();
      await storage.bootstrapAdminKey();
      expect(await storage.getAdminKey()).toBe(first);
    });
  });

  describe('deleteProject', () => {
    it('cascades to environments and flags', async () => {
      const p = await storage.createProject({ name: 'Del' });
      await storage.createEnvironment({ projectId: p.id, name: 'prod' });
      await storage.deleteProject(p.id);
      expect(await storage.getProject(p.id)).toBeNull();
      expect(await storage.getEnvironmentsByProject(p.id)).toHaveLength(0);
    });
  });

  describe('createFlag', () => {
    it('creates flags across all environments', async () => {
      const p = await storage.createProject({ name: 'FlagApp' });
      await storage.createEnvironment({ projectId: p.id, name: 'staging' });
      await storage.createEnvironment({ projectId: p.id, name: 'production' });
      const flags = await storage.createFlag({ projectId: p.id, key: 'f', name: 'F', enabled: false, environment: 'staging' });
      expect(flags).toHaveLength(2);
    });
  });

  describe('Typed flags', () => {
    it('round-trips a number flag', async () => {
      const project = await storage.createProject({ name: 'typed' });
      await storage.createFlag({
        projectId: project.id, key: 'limit', name: 'Limit',
        enabled: true, environment: 'production', type: 'number', value: 3, defaultValue: 1,
      });
      const flag = await storage.getFlag(project.id, 'limit', 'production');
      expect(flag?.type).toBe('number');
      expect(flag?.value).toBe(3);
      expect(flag?.defaultValue).toBe(1);
    });

    it('normalizes a flag without type to boolean on read', async () => {
      const project = await storage.createProject({ name: 'legacy' });
      await storage.createFlag({
        projectId: project.id, key: 'plain', name: 'Plain',
        enabled: true, environment: 'production',
      });
      const flag = await storage.getFlag(project.id, 'plain', 'production');
      expect(flag?.type).toBe('boolean');
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
});
