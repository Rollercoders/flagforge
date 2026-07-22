import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmittingStorage } from '../storage/eventEmittingStorage.js';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';
import { Storage, Flag } from '../types.js';

// Minimal FakeStorage: implements only the methods touched by the tests.
class FakeStorage implements Partial<Storage> {
  createFlagCalls: unknown[] = [];
  createFlagFanOut: Flag[] | null = null;
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    this.createFlagCalls.push(flag);
    if (this.createFlagFanOut) return this.createFlagFanOut;
    return [{ ...flag, id: 'f1', createdAt: 't', updatedAt: 't' }];
  }
  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    return { id, projectId: 'p1', key: 'k', name: 'N', enabled: true, environment: 'production', createdAt: 't', updatedAt: 't2', ...updates };
  }
  async deleteFlag(_projectId: string, _key: string): Promise<void> { /* noop */ }
  async getAllProjects() { return []; }
}

let inner: FakeStorage;
let bus: FlagChangeBus;
let changes: FlagChange[];
let storage: EventEmittingStorage;

beforeEach(() => {
  inner = new FakeStorage();
  bus = new FlagChangeBus();
  changes = [];
  bus.subscribe(c => changes.push(c));
  storage = new EventEmittingStorage(inner as unknown as Storage, bus);
});

describe('EventEmittingStorage', () => {
  it('createFlag emits {projectId, environment} after writing and delegates', async () => {
    const result = await storage.createFlag({ projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'production' });
    expect(result).toHaveLength(1);           // inner's return value passed through
    expect(inner.createFlagCalls).toHaveLength(1); // delegation happened
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('createFlag with multi-environment fan-out emits one event per created flag', async () => {
    inner.createFlagFanOut = [
      { id: 'f1', projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'staging', createdAt: 't', updatedAt: 't' },
      { id: 'f2', projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'production', createdAt: 't', updatedAt: 't' },
    ];
    const result = await storage.createFlag({ projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'staging' });
    expect(result).toHaveLength(2);
    expect(changes).toEqual([
      { projectId: 'p1', environment: 'staging' },
      { projectId: 'p1', environment: 'production' },
    ]);
  });

  it('updateFlag emits using projectId/environment from the returned flag', async () => {
    await storage.updateFlag('f1', { enabled: false });
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('deleteFlag emits {projectId}', async () => {
    await storage.deleteFlag('p1', 'k');
    expect(changes).toEqual([{ projectId: 'p1' }]);
  });

  it('read methods do NOT emit', async () => {
    await storage.getAllProjects();
    expect(changes).toEqual([]);
  });
});
