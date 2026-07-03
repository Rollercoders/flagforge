import { Storage, Project, Environment, Flag } from '../types.js';
import { FlagChangeBus } from '../events/flagChangeBus.js';

export class EventEmittingStorage implements Storage {
  constructor(private inner: Storage, private bus: FlagChangeBus) {}

  initialize(): Promise<void> { return this.inner.initialize(); }

  // Projects
  createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> { return this.inner.createProject(project); }
  getProject(id: string): Promise<Project | null> { return this.inner.getProject(id); }
  getAllProjects(): Promise<Project[]> { return this.inner.getAllProjects(); }
  deleteProject(id: string): Promise<void> { return this.inner.deleteProject(id); }

  // Environments
  createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key'>): Promise<Environment> { return this.inner.createEnvironment(env); }
  getEnvironmentsByProject(projectId: string): Promise<Environment[]> { return this.inner.getEnvironmentsByProject(projectId); }
  deleteEnvironment(id: string): Promise<void> { return this.inner.deleteEnvironment(id); }
  renameEnvironment(id: string, name: string): Promise<Environment> { return this.inner.renameEnvironment(id, name); }
  regenerateEnvironmentKey(envId: string): Promise<Environment> { return this.inner.regenerateEnvironmentKey(envId); }
  getEnvironmentByKey(key: string): Promise<Environment | null> { return this.inner.getEnvironmentByKey(key); }

  // Flags — emit dopo mutazione
  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    const result = await this.inner.createFlag(flag);
    for (const created of result) {
      this.bus.emit({ projectId: created.projectId, environment: created.environment });
    }
    return result;
  }
  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    const updated = await this.inner.updateFlag(id, updates);
    this.bus.emit({ projectId: updated.projectId, environment: updated.environment });
    return updated;
  }
  async deleteFlag(projectId: string, key: string): Promise<void> {
    await this.inner.deleteFlag(projectId, key);
    this.bus.emit({ projectId });
  }
  getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> { return this.inner.getFlag(projectId, key, environment); }
  getAllFlags(projectId: string, environment?: string): Promise<Flag[]> { return this.inner.getAllFlags(projectId, environment); }

  // Admin key
  getAdminKey(): Promise<string | null> { return this.inner.getAdminKey(); }
  bootstrapAdminKey(): Promise<void> { return this.inner.bootstrapAdminKey(); }
}
