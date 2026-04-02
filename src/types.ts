export interface Flag {
  id: string;
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

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  environment: string;
  createdAt: string;
}

export interface FlagEvaluationContext {
  userId?: string;
  attributes?: Record<string, string>;
}

export interface Storage {
  initialize(): Promise<void>;

  // Flags
  createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag>;
  getFlag(key: string, environment: string): Promise<Flag | null>;
  getAllFlags(environment?: string): Promise<Flag[]>;
  updateFlag(id: string, updates: Partial<Flag>): Promise<Flag>;
  deleteFlag(id: string): Promise<void>;

  // API Keys
  createApiKey(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey>;
  getApiKey(key: string): Promise<ApiKey | null>;
  getAllApiKeys(): Promise<ApiKey[]>;
  deleteApiKey(id: string): Promise<void>;
}
