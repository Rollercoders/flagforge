import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { JsonStorage } from '../storage/json';
import * as fs from 'fs';
import * as path from 'path';

describe('JsonStorage', () => {
  let storage: JsonStorage;
  const testFilePath = path.join(__dirname, '../../test-data/test-flags.json');

  beforeEach(async () => {
    // Clean up test file
    const dir = path.dirname(testFilePath);
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    storage = new JsonStorage(testFilePath);
    await storage.initialize();
  });

  afterEach(() => {
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  describe('Flag operations', () => {
    it('should create a flag', async () => {
      const flag = await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        description: 'A test flag',
        enabled: true,
        environment: 'test'
      });

      expect(flag).toBeDefined();
      expect(flag.id).toBeDefined();
      expect(flag.key).toBe('test-flag');
      expect(flag.name).toBe('Test Flag');
      expect(flag.enabled).toBe(true);
      expect(flag.environment).toBe('test');
      expect(flag.createdAt).toBeDefined();
      expect(flag.updatedAt).toBeDefined();
    });

    it('should persist data to file', async () => {
      await storage.createFlag({
        key: 'persist-test',
        name: 'Persist Test',
        enabled: true,
        environment: 'test'
      });

      const fileContent = fs.readFileSync(testFilePath, 'utf-8');
      const data = JSON.parse(fileContent);

      expect(data.flags).toHaveLength(1);
      expect(data.flags[0].key).toBe('persist-test');
    });

    it('should get a flag by key and environment', async () => {
      await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'production'
      });

      const flag = await storage.getFlag('test-flag', 'production');

      expect(flag).toBeDefined();
      expect(flag?.key).toBe('test-flag');
      expect(flag?.environment).toBe('production');
    });

    it('should return null for non-existent flag', async () => {
      const flag = await storage.getFlag('non-existent', 'production');

      expect(flag).toBeNull();
    });

    it('should get all flags', async () => {
      await storage.createFlag({
        key: 'flag-1',
        name: 'Flag 1',
        enabled: true,
        environment: 'test'
      });

      await storage.createFlag({
        key: 'flag-2',
        name: 'Flag 2',
        enabled: false,
        environment: 'test'
      });

      const flags = await storage.getAllFlags();

      expect(flags).toHaveLength(2);
    });

    it('should get flags filtered by environment', async () => {
      await storage.createFlag({
        key: 'flag-1',
        name: 'Flag 1',
        enabled: true,
        environment: 'production'
      });

      await storage.createFlag({
        key: 'flag-2',
        name: 'Flag 2',
        enabled: true,
        environment: 'staging'
      });

      const prodFlags = await storage.getAllFlags('production');
      const stagingFlags = await storage.getAllFlags('staging');

      expect(prodFlags).toHaveLength(1);
      expect(prodFlags[0].key).toBe('flag-1');
      expect(stagingFlags).toHaveLength(1);
      expect(stagingFlags[0].key).toBe('flag-2');
    });

    it('should update a flag', async () => {
      const flag = await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: false,
        environment: 'test'
      });

      // Wait 1ms to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 1));

      const updated = await storage.updateFlag(flag.id, {
        enabled: true,
        name: 'Updated Flag'
      });

      expect(updated.enabled).toBe(true);
      expect(updated.name).toBe('Updated Flag');
      expect(updated.updatedAt).not.toBe(flag.updatedAt);
    });

    it('should delete a flag', async () => {
      const flag = await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'test'
      });

      await storage.deleteFlag(flag.id);

      const retrieved = await storage.getFlag('test-flag', 'test');
      expect(retrieved).toBeNull();
    });

    it('should store and retrieve targeting rules', async () => {
      const flag = await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'test',
        targeting: {
          userIds: ['user-1', 'user-2'],
          attributes: {
            plan: ['premium', 'enterprise']
          }
        }
      });

      const retrieved = await storage.getFlag('test-flag', 'test');

      expect(retrieved?.targeting).toBeDefined();
      expect(retrieved?.targeting?.userIds).toEqual(['user-1', 'user-2']);
      expect(retrieved?.targeting?.attributes?.plan).toEqual(['premium', 'enterprise']);
    });

    it('should store and retrieve rollout configuration', async () => {
      const flag = await storage.createFlag({
        key: 'test-flag',
        name: 'Test Flag',
        enabled: true,
        environment: 'test',
        rollout: {
          percentage: 50
        }
      });

      const retrieved = await storage.getFlag('test-flag', 'test');

      expect(retrieved?.rollout).toBeDefined();
      expect(retrieved?.rollout?.percentage).toBe(50);
    });

    it('should allow same key in different environments', async () => {
      await storage.createFlag({
        key: 'same-key',
        name: 'Prod Flag',
        enabled: true,
        environment: 'production'
      });

      await storage.createFlag({
        key: 'same-key',
        name: 'Staging Flag',
        enabled: false,
        environment: 'staging'
      });

      const prodFlag = await storage.getFlag('same-key', 'production');
      const stagingFlag = await storage.getFlag('same-key', 'staging');

      expect(prodFlag?.name).toBe('Prod Flag');
      expect(stagingFlag?.name).toBe('Staging Flag');
    });

    it('should enforce unique constraint on key+environment', async () => {
      await storage.createFlag({
        key: 'duplicate',
        name: 'First',
        enabled: true,
        environment: 'test'
      });

      await expect(
        storage.createFlag({
          key: 'duplicate',
          name: 'Second',
          enabled: true,
          environment: 'test'
        })
      ).rejects.toThrow();
    });

    it('should load existing data on initialization', async () => {
      // Create initial storage and add a flag
      await storage.createFlag({
        key: 'existing-flag',
        name: 'Existing Flag',
        enabled: true,
        environment: 'test'
      });

      // Create new storage instance pointing to same file
      const storage2 = new JsonStorage(testFilePath);
      await storage2.initialize();

      const flag = await storage2.getFlag('existing-flag', 'test');

      expect(flag).toBeDefined();
      expect(flag?.key).toBe('existing-flag');
    });
  });

  describe('API Key operations', () => {
    it('should create an API key', async () => {
      const apiKey = await storage.createApiKey({
        key: 'test-key-123',
        name: 'Test Key',
        environment: 'production'
      });

      expect(apiKey).toBeDefined();
      expect(apiKey.id).toBeDefined();
      expect(apiKey.key).toBe('test-key-123');
      expect(apiKey.name).toBe('Test Key');
      expect(apiKey.environment).toBe('production');
      expect(apiKey.createdAt).toBeDefined();
    });

    it('should persist API keys to file', async () => {
      await storage.createApiKey({
        key: 'persist-key',
        name: 'Persist Key',
        environment: 'test'
      });

      const fileContent = fs.readFileSync(testFilePath, 'utf-8');
      const data = JSON.parse(fileContent);

      expect(data.apiKeys).toHaveLength(1);
      expect(data.apiKeys[0].key).toBe('persist-key');
    });

    it('should get an API key by key', async () => {
      await storage.createApiKey({
        key: 'test-key-456',
        name: 'Test Key',
        environment: 'staging'
      });

      const apiKey = await storage.getApiKey('test-key-456');

      expect(apiKey).toBeDefined();
      expect(apiKey?.key).toBe('test-key-456');
      expect(apiKey?.environment).toBe('staging');
    });

    it('should return null for non-existent API key', async () => {
      const apiKey = await storage.getApiKey('non-existent-key');

      expect(apiKey).toBeNull();
    });

    it('should get all API keys', async () => {
      await storage.createApiKey({
        key: 'key-1',
        name: 'Key 1',
        environment: 'production'
      });

      await storage.createApiKey({
        key: 'key-2',
        name: 'Key 2',
        environment: 'staging'
      });

      const keys = await storage.getAllApiKeys();

      expect(keys).toHaveLength(2);
    });

    it('should delete an API key', async () => {
      const apiKey = await storage.createApiKey({
        key: 'delete-me',
        name: 'Delete Me',
        environment: 'test'
      });

      await storage.deleteApiKey(apiKey.id);

      const retrieved = await storage.getApiKey('delete-me');
      expect(retrieved).toBeNull();
    });
  });
});
