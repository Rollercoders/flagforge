import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonStorage } from '../storage/json';
import * as fs from 'fs';
import * as path from 'path';

describe('JsonStorage', () => {
  let storage: JsonStorage;
  const testFilePath = path.join(__dirname, '../../test-data/test.json');

  beforeEach(async () => {
    const dir = path.dirname(testFilePath);
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new JsonStorage(testFilePath);
    await storage.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
  });

  describe('Project operations', () => {
    it('should create a project', async () => {
      const p = await storage.createProject({ name: 'my-app' });
      expect(p.id).toBeDefined();
      expect(p.name).toBe('my-app');
    });

    it('should get all projects', async () => {
      await storage.createProject({ name: 'a' });
      await storage.createProject({ name: 'b' });
      expect(await storage.getAllProjects()).toHaveLength(2);
    });

    it('should delete a project', async () => {
      const p = await storage.createProject({ name: 'x' });
      await storage.deleteProject(p.id);
      expect(await storage.getProject(p.id)).toBeNull();
    });

    it('should reject duplicate names', async () => {
      await storage.createProject({ name: 'dup' });
      await expect(storage.createProject({ name: 'dup' })).rejects.toThrow();
    });
  });

  describe('Environment operations', () => {
    let projectId: string;

    beforeEach(async () => {
      projectId = (await storage.createProject({ name: 'my-app' })).id;
    });

    it('should create an environment', async () => {
      const env = await storage.createEnvironment({ projectId, name: 'prod' });
      expect(env.projectId).toBe(projectId);
      expect(env.name).toBe('prod');
    });

    it('should list environments for project', async () => {
      await storage.createEnvironment({ projectId, name: 'prod' });
      await storage.createEnvironment({ projectId, name: 'staging' });
      expect(await storage.getEnvironmentsByProject(projectId)).toHaveLength(2);
    });

    it('should delete an environment', async () => {
      const env = await storage.createEnvironment({ projectId, name: 'staging' });
      await storage.deleteEnvironment(env.id);
      expect(await storage.getEnvironmentsByProject(projectId)).toHaveLength(0);
    });

    it('should reject duplicate env name in same project', async () => {
      await storage.createEnvironment({ projectId, name: 'prod' });
      await expect(storage.createEnvironment({ projectId, name: 'prod' })).rejects.toThrow();
    });
  });

  describe('Flag operations', () => {
    let projectId: string;

    beforeEach(async () => {
      projectId = (await storage.createProject({ name: 'my-app' })).id;
      await storage.createEnvironment({ projectId, name: 'prod' });
      await storage.createEnvironment({ projectId, name: 'staging' });
    });

    it('should create a flag for all environments', async () => {
      const flags = await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'prod' });
      expect(flags).toHaveLength(2);
      expect(flags.map(f => f.environment).sort()).toEqual(['prod', 'staging']);
    });

    it('should get a flag', async () => {
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: true, environment: 'prod' });
      const flag = await storage.getFlag(projectId, 'feat', 'prod');
      expect(flag?.key).toBe('feat');
    });

    it('should delete all env rows for a flag key', async () => {
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'prod' });
      await storage.deleteFlag(projectId, 'feat');
      expect(await storage.getFlag(projectId, 'feat', 'prod')).toBeNull();
      expect(await storage.getFlag(projectId, 'feat', 'staging')).toBeNull();
    });
  });

  describe('API Key operations', () => {
    let projectId: string;

    beforeEach(async () => {
      projectId = (await storage.createProject({ name: 'my-app' })).id;
    });

    it('should create key with projectId', async () => {
      const k = await storage.createApiKey({ key: 'rf_x', name: 'X', environment: 'prod', projectId });
      expect(k.projectId).toBe(projectId);
    });

    it('should filter keys by projectId', async () => {
      const other = (await storage.createProject({ name: 'other' })).id;
      await storage.createApiKey({ key: 'rf_a', name: 'A', environment: 'prod', projectId });
      await storage.createApiKey({ key: 'rf_b', name: 'B', environment: 'prod', projectId: other });
      const keys = await storage.getAllApiKeys(projectId);
      expect(keys).toHaveLength(1);
    });
  });
});
