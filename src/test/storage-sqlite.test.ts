import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStorage } from '../storage/sqlite';
import * as fs from 'fs';
import * as path from 'path';

describe('SqliteStorage', () => {
  let storage: SqliteStorage;
  const testDbPath = path.join(__dirname, '../../test-data/test.db');

  beforeEach(async () => {
    const dir = path.dirname(testDbPath);
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    storage = new SqliteStorage(testDbPath);
    await storage.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(testDbPath)) fs.unlinkSync(testDbPath);
  });

  describe('Project operations', () => {
    it('should create a project', async () => {
      const project = await storage.createProject({ name: 'my-app' });
      expect(project.id).toBeDefined();
      expect(project.name).toBe('my-app');
      expect(project.createdAt).toBeDefined();
    });

    it('should get all projects', async () => {
      await storage.createProject({ name: 'app-a' });
      await new Promise(r => setTimeout(r, 1));
      await storage.createProject({ name: 'app-b' });
      const projects = await storage.getAllProjects();
      expect(projects).toHaveLength(2);
    });

    it('should get project by id', async () => {
      const created = await storage.createProject({ name: 'my-app' });
      const found = await storage.getProject(created.id);
      expect(found?.name).toBe('my-app');
    });

    it('should return null for missing project', async () => {
      const found = await storage.getProject('nonexistent');
      expect(found).toBeNull();
    });

    it('should delete a project', async () => {
      const project = await storage.createProject({ name: 'my-app' });
      await storage.deleteProject(project.id);
      const found = await storage.getProject(project.id);
      expect(found).toBeNull();
    });

    it('should reject duplicate project names', async () => {
      await storage.createProject({ name: 'my-app' });
      await expect(storage.createProject({ name: 'my-app' })).rejects.toThrow();
    });
  });

  describe('Environment operations', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await storage.createProject({ name: 'my-app' });
      projectId = project.id;
    });

    it('should create an environment', async () => {
      const env = await storage.createEnvironment({ projectId, name: 'production' });
      expect(env.id).toBeDefined();
      expect(env.projectId).toBe(projectId);
      expect(env.name).toBe('production');
    });

    it('should list environments for a project', async () => {
      await storage.createEnvironment({ projectId, name: 'production' });
      await new Promise(r => setTimeout(r, 1));
      await storage.createEnvironment({ projectId, name: 'staging' });
      const envs = await storage.getEnvironmentsByProject(projectId);
      expect(envs).toHaveLength(2);
    });

    it('should delete an environment', async () => {
      const env = await storage.createEnvironment({ projectId, name: 'staging' });
      await storage.deleteEnvironment(env.id);
      const envs = await storage.getEnvironmentsByProject(projectId);
      expect(envs).toHaveLength(0);
    });

    it('should reject duplicate env name in same project', async () => {
      await storage.createEnvironment({ projectId, name: 'production' });
      await expect(storage.createEnvironment({ projectId, name: 'production' })).rejects.toThrow();
    });
  });

  describe('Flag operations', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await storage.createProject({ name: 'my-app' });
      projectId = project.id;
      await storage.createEnvironment({ projectId, name: 'production' });
      await storage.createEnvironment({ projectId, name: 'staging' });
    });

    it('should create a flag for all environments', async () => {
      const flags = await storage.createFlag({
        projectId,
        key: 'dark-mode',
        name: 'Dark Mode',
        enabled: false,
        environment: 'production',
      });
      expect(flags).toHaveLength(2);
      const envNames = flags.map(f => f.environment).sort();
      expect(envNames).toEqual(['production', 'staging']);
      flags.forEach(f => {
        expect(f.projectId).toBe(projectId);
        expect(f.key).toBe('dark-mode');
        expect(f.enabled).toBe(false);
      });
    });

    it('should get a flag by projectId + key + environment', async () => {
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: true, environment: 'production' });
      const flag = await storage.getFlag(projectId, 'feat', 'production');
      expect(flag?.key).toBe('feat');
      expect(flag?.environment).toBe('production');
    });

    it('should return null for flag in wrong project', async () => {
      const other = await storage.createProject({ name: 'other' });
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: true, environment: 'production' });
      const flag = await storage.getFlag(other.id, 'feat', 'production');
      expect(flag).toBeNull();
    });

    it('should get all flags for a project+environment', async () => {
      await storage.createFlag({ projectId, key: 'feat-a', name: 'A', enabled: true, environment: 'production' });
      await new Promise(r => setTimeout(r, 1));
      await storage.createFlag({ projectId, key: 'feat-b', name: 'B', enabled: false, environment: 'production' });
      const flags = await storage.getAllFlags(projectId, 'production');
      expect(flags).toHaveLength(2);
    });

    it('should delete all environment rows for a flag key', async () => {
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'production' });
      await storage.deleteFlag(projectId, 'feat');
      const prod = await storage.getFlag(projectId, 'feat', 'production');
      const stg = await storage.getFlag(projectId, 'feat', 'staging');
      expect(prod).toBeNull();
      expect(stg).toBeNull();
    });

    it('should reject duplicate flag key in same project+environment', async () => {
      await storage.createFlag({ projectId, key: 'feat', name: 'Feature', enabled: false, environment: 'production' });
      await expect(
        storage.createFlag({ projectId, key: 'feat', name: 'Feature 2', enabled: false, environment: 'production' })
      ).rejects.toThrow();
    });
  });

  describe('API Key operations', () => {
    let projectId: string;

    beforeEach(async () => {
      const project = await storage.createProject({ name: 'my-app' });
      projectId = project.id;
    });

    it('should create an API key with projectId', async () => {
      const key = await storage.createApiKey({ key: 'rf_test', name: 'Test', environment: 'production', projectId });
      expect(key.projectId).toBe(projectId);
    });

    it('should list API keys filtered by projectId', async () => {
      const other = await storage.createProject({ name: 'other' });
      await storage.createApiKey({ key: 'rf_a', name: 'A', environment: 'prod', projectId });
      await storage.createApiKey({ key: 'rf_b', name: 'B', environment: 'prod', projectId: other.id });
      const keys = await storage.getAllApiKeys(projectId);
      expect(keys).toHaveLength(1);
      expect(keys[0].name).toBe('A');
    });

    it('should get API key by key string', async () => {
      await storage.createApiKey({ key: 'rf_test123', name: 'Test', environment: 'prod', projectId });
      const found = await storage.getApiKey('rf_test123');
      expect(found?.projectId).toBe(projectId);
    });
  });
});
