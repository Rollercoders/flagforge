import { nanoid } from 'nanoid';
import { Storage, Flag, ApiKey, Project, Environment } from '../types';
import * as fs from 'fs';
import * as path from 'path';

interface JsonData {
  projects: Project[];
  environments: Environment[];
  flags: Flag[];
  apiKeys: ApiKey[];
}

export class JsonStorage implements Storage {
  private data: JsonData = { projects: [], environments: [], flags: [], apiKeys: [] };

  constructor(private filePath: string) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath)) {
      this.data = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
    } else {
      this.save();
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
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
    this.data.apiKeys = this.data.apiKeys.filter(k => k.projectId !== id);
    this.data.flags = this.data.flags.filter(f => f.projectId !== id);
    this.data.environments = this.data.environments.filter(e => e.projectId !== id);
    this.data.projects = this.data.projects.filter(p => p.id !== id);
    this.save();
  }

  async createEnvironment(env: Omit<Environment, 'id' | 'createdAt'>): Promise<Environment> {
    if (this.data.environments.some(e => e.projectId === env.projectId && e.name === env.name)) {
      throw new Error(`Environment '${env.name}' already exists in this project`);
    }
    const newEnv: Environment = { id: nanoid(), projectId: env.projectId, name: env.name, createdAt: new Date().toISOString() };
    this.data.environments.push(newEnv);
    this.save();
    return newEnv;
  }

  async getEnvironmentsByProject(projectId: string): Promise<Environment[]> {
    return this.data.environments.filter(e => e.projectId === projectId);
  }

  async deleteEnvironment(id: string): Promise<void> {
    const env = this.data.environments.find(e => e.id === id);
    if (!env) return;
    this.data.flags = this.data.flags.filter(f => !(f.projectId === env.projectId && f.environment === env.name));
    this.data.apiKeys = this.data.apiKeys.filter(k => !(k.projectId === env.projectId && k.environment === env.name));
    this.data.environments = this.data.environments.filter(e => e.id !== id);
    this.save();
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    const envNames = this.data.environments
      .filter(e => e.projectId === flag.projectId)
      .map(e => e.name);
    if (envNames.length === 0) envNames.push(flag.environment);

    for (const envName of envNames) {
      if (this.data.flags.some(f => f.projectId === flag.projectId && f.key === flag.key && f.environment === envName)) {
        throw new Error(`Flag '${flag.key}' already exists in environment '${envName}'`);
      }
    }

    const now = new Date().toISOString();
    const created: Flag[] = [];
    for (const envName of envNames) {
      const newFlag: Flag = { id: nanoid(), projectId: flag.projectId, key: flag.key, name: flag.name, description: flag.description, enabled: flag.enabled, environment: envName, targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now };
      this.data.flags.push(newFlag);
      created.push(newFlag);
    }
    this.save();
    return created;
  }

  async getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> {
    return this.data.flags.find(f => f.projectId === projectId && f.key === key && f.environment === environment) ?? null;
  }

  async getAllFlags(projectId: string, environment?: string): Promise<Flag[]> {
    return this.data.flags.filter(f => f.projectId === projectId && (!environment || f.environment === environment));
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

  async createApiKey(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey> {
    const newKey: ApiKey = { id: nanoid(), ...apiKey, createdAt: new Date().toISOString() };
    this.data.apiKeys.push(newKey);
    this.save();
    return newKey;
  }

  async getApiKey(key: string): Promise<ApiKey | null> {
    return this.data.apiKeys.find(k => k.key === key) ?? null;
  }

  async getAllApiKeys(projectId?: string): Promise<ApiKey[]> {
    if (projectId) return this.data.apiKeys.filter(k => k.projectId === projectId);
    return [...this.data.apiKeys];
  }

  async deleteApiKey(id: string): Promise<void> {
    this.data.apiKeys = this.data.apiKeys.filter(k => k.id !== id);
    this.save();
  }
}
