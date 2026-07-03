import { describe, it, expect, beforeEach } from 'vitest';
import { EventEmittingStorage } from '../storage/eventEmittingStorage.js';
import { FlagChangeBus, FlagChange } from '../events/flagChangeBus.js';
import { Storage, Flag } from '../types.js';

// FakeStorage minimale: implementa i metodi toccati dai test.
class FakeStorage implements Partial<Storage> {
  createFlagCalls: unknown[] = [];
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    this.createFlagCalls.push(flag);
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
  it('createFlag emette {projectId, environment} dopo la scrittura e delega', async () => {
    const result = await storage.createFlag({ projectId: 'p1', key: 'k', name: 'N', enabled: false, environment: 'production' });
    expect(result).toHaveLength(1);           // valore di ritorno dell'inner passato attraverso
    expect(inner.createFlagCalls).toHaveLength(1); // delega avvenuta
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('updateFlag emette usando projectId/environment del flag ritornato', async () => {
    await storage.updateFlag('f1', { enabled: false });
    expect(changes).toEqual([{ projectId: 'p1', environment: 'production' }]);
  });

  it('deleteFlag emette {projectId}', async () => {
    await storage.deleteFlag('p1', 'k');
    expect(changes).toEqual([{ projectId: 'p1' }]);
  });

  it('i metodi di lettura NON emettono', async () => {
    await storage.getAllProjects();
    expect(changes).toEqual([]);
  });
});
