export interface Project {
  id: string;
  name: string;
  createdAt: string;
}

export interface Environment {
  id: string;
  projectId: string;
  name: string;
  key: string;
  createdAt: string;
}

export interface Flag {
  id: string;
  projectId: string;
  key: string;
  name: string;
  description?: string;
  enabled: boolean;
  environment: string;
  targeting?: Targeting;
  rollout?: Rollout;
  createdAt: string;
  updatedAt: string;
}

export interface Targeting {
  userIds?: string[];
  attributes?: Record<string, string[]>;
}

export interface Rollout {
  percentage: number;
}

export interface FlagEvaluationContext {
  userId?: string;
  attributes?: Record<string, string>;
}

export interface Storage {
  initialize(): Promise<void>;

  // Projects
  createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project>;
  getProject(id: string): Promise<Project | null>;
  getAllProjects(): Promise<Project[]>;
  deleteProject(id: string): Promise<void>;

  // Environments
  createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key'>): Promise<Environment>;
  getEnvironmentsByProject(projectId: string): Promise<Environment[]>;
  deleteEnvironment(id: string): Promise<void>;
  renameEnvironment(id: string, name: string): Promise<Environment>;
  regenerateEnvironmentKey(envId: string): Promise<Environment>;
  getEnvironmentByKey(key: string): Promise<Environment | null>;

  // Flags
  createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]>;
  getFlag(projectId: string, key: string, environment: string): Promise<Flag | null>;
  getAllFlags(projectId: string, environment?: string): Promise<Flag[]>;
  updateFlag(id: string, updates: Partial<Flag>): Promise<Flag>;
  deleteFlag(projectId: string, key: string): Promise<void>;

  // Admin key (UI authentication)
  getAdminKey(): Promise<string | null>;
  bootstrapAdminKey(): Promise<void>;
}
