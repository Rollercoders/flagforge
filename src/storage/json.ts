import { nanoid } from 'nanoid';
import { Storage, Flag, Project, Environment, ApiKeyRole } from '../types.js';
import { normalizeFlagType } from '../flagValue.js';
import * as fs from 'fs';
import * as path from 'path';

interface AdminKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

interface JsonData {
  projects: Project[];
  environments: Environment[];
  flags: Flag[];
  adminKey: AdminKey | null;
}

export class JsonStorage implements Storage {
  private data: JsonData = { projects: [], environments: [], flags: [], adminKey: null };

  constructor(private filePath: string) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as JsonData;
      if (!('adminKey' in this.data)) (this.data as any).adminKey = null;
      await this.backfillSecretKeys();
    } else {
      this.save();
    }
  }

  async backfillSecretKeys(): Promise<void> {
    let changed = false;
    for (const env of this.data.environments) {
      if (!env.secretKey) {
        env.secretKey = `ffs_${nanoid(32)}`;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  private normalizeFlag(flag: Flag): Flag {
    return { ...flag, type: normalizeFlagType(flag.type) };
  }

  async createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    if (this.data.projects.some(p => p.name === project.name)) {
      throw new Error(`Project name '${project.name}' already exists`);
    }
    const newProject: Project = { id: nanoid(), name: project.name, createdAt: new Date().toISOString() };
    this.data.projects.push(newProject);
    this.save();
    return newProject;
  }

  async getProject(id: string): Promise<Project | null> {
    return this.data.projects.find(p => p.id === id) ?? null;
  }

  async getAllProjects(): Promise<Project[]> {
    return [...this.data.projects];
  }

  async deleteProject(id: string): Promise<void> {
    this.data.flags = this.data.flags.filter(f => f.projectId !== id);
    this.data.environments = this.data.environments.filter(e => e.projectId !== id);
    this.data.projects = this.data.projects.filter(p => p.id !== id);
    this.save();
  }

  async createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key' | 'secretKey'>): Promise<Environment> {
    if (this.data.environments.some(e => e.projectId === env.projectId && e.name === env.name)) {
      throw new Error(`Environment '${env.name}' already exists in this project`);
    }
    const now = new Date().toISOString();
    const newEnv: Environment = { id: nanoid(), projectId: env.projectId, name: env.name, key: `ff_${nanoid(32)}`, secretKey: `ffs_${nanoid(32)}`, createdAt: now };
    this.data.environments.push(newEnv);

    // Auto-backfill flags
    const seenKeys = new Set<string>();
    for (const flag of this.data.flags.filter(f => f.projectId === env.projectId && f.environment !== env.name)) {
      if (seenKeys.has(flag.key)) continue;
      seenKeys.add(flag.key);
      if (!this.data.flags.some(f => f.projectId === env.projectId && f.key === flag.key && f.environment === env.name)) {
        this.data.flags.push({ id: nanoid(), projectId: env.projectId, key: flag.key, name: flag.name,
          description: flag.description, enabled: false, type: normalizeFlagType(flag.type),
          value: flag.value, defaultValue: flag.defaultValue, environment: env.name,
          targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now });
      }
    }

    this.save();
    return { ...newEnv };
  }

  async getEnvironmentsByProject(projectId: string): Promise<Environment[]> {
    return this.data.environments.filter(e => e.projectId === projectId);
  }

  async getEnvironmentByKey(key: string): Promise<Environment | null> {
    return this.data.environments.find(e => e.key === key) ?? null;
  }

  async getEnvironmentByAnyKey(token: string): Promise<{ environment: Environment; role: ApiKeyRole } | null> {
    // empty tokens must never match an env with a default-empty key column
    if (!token) return null;
    const byClient = this.data.environments.find(e => e.key === token);
    if (byClient) return { environment: { ...byClient }, role: 'client' };
    const bySecret = this.data.environments.find(e => e.secretKey === token);
    if (bySecret) return { environment: { ...bySecret }, role: 'secret' };
    return null;
  }

  async regenerateEnvironmentKey(envId: string, role: ApiKeyRole): Promise<Environment> {
    const env = this.data.environments.find(e => e.id === envId);
    if (!env) throw new Error('Environment not found');
    if (role === 'client') {
      env.key = `ff_${nanoid(32)}`;
    } else {
      env.secretKey = `ffs_${nanoid(32)}`;
    }
    this.save();
    return { ...env };
  }

  async deleteEnvironment(id: string): Promise<void> {
    const env = this.data.environments.find(e => e.id === id);
    if (!env) return;
    this.data.flags = this.data.flags.filter(f => !(f.projectId === env.projectId && f.environment === env.name));
    this.data.environments = this.data.environments.filter(e => e.id !== id);
    this.save();
  }

  async renameEnvironment(id: string, name: string): Promise<Environment> {
    const env = this.data.environments.find(e => e.id === id);
    if (!env) throw new Error('Environment not found');
    if (this.data.environments.some(e => e.projectId === env.projectId && e.name === name && e.id !== id)) {
      throw new Error(`Environment name '${name}' already exists in this project`);
    }
    const oldName = env.name;
    env.name = name;
    for (const flag of this.data.flags) {
      if (flag.projectId === env.projectId && flag.environment === oldName) flag.environment = name;
    }
    this.save();
    return { ...env };
  }

  async getAdminKey(): Promise<string | null> {
    return this.data.adminKey?.key ?? null;
  }

  async bootstrapAdminKey(): Promise<void> {
    if (this.data.adminKey) return;
    this.data.adminKey = { id: nanoid(), key: `ff_${nanoid(32)}`, name: '__ui_admin__', createdAt: new Date().toISOString() };
    this.save();
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    const envNames = this.data.environments.filter(e => e.projectId === flag.projectId).map(e => e.name);
    if (envNames.length === 0) envNames.push(flag.environment);
    for (const envName of envNames) {
      if (this.data.flags.some(f => f.projectId === flag.projectId && f.key === flag.key && f.environment === envName)) {
        throw new Error(`Flag '${flag.key}' already exists in environment '${envName}'`);
      }
    }
    const now = new Date().toISOString();
    const created: Flag[] = [];
    for (const envName of envNames) {
      const newFlag: Flag = { id: nanoid(), projectId: flag.projectId, key: flag.key, name: flag.name,
        description: flag.description, enabled: flag.enabled, type: normalizeFlagType(flag.type),
        value: flag.value, defaultValue: flag.defaultValue, environment: envName,
        targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now };
      this.data.flags.push(newFlag);
      created.push(newFlag);
    }
    this.save();
    return created;
  }

  async getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> {
    const flag = this.data.flags.find(f => f.projectId === projectId && f.key === key && f.environment === environment);
    return flag ? this.normalizeFlag(flag) : null;
  }

  async getAllFlags(projectId: string, environment?: string): Promise<Flag[]> {
    return this.data.flags
      .filter(f => f.projectId === projectId && (!environment || f.environment === environment))
      .map(f => this.normalizeFlag(f));
  }

  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    const index = this.data.flags.findIndex(f => f.id === id);
    if (index === -1) throw new Error('Flag not found');
    const defined = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
    this.data.flags[index] = { ...this.data.flags[index], ...defined, updatedAt: new Date().toISOString() };
    this.save();
    return this.data.flags[index];
  }

  async deleteFlag(projectId: string, key: string): Promise<void> {
    this.data.flags = this.data.flags.filter(f => !(f.projectId === projectId && f.key === key));
    this.save();
  }
}
