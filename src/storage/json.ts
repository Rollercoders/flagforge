import { nanoid } from 'nanoid';
import { Storage, Flag, ApiKey } from '../types';
import * as fs from 'fs';
import * as path from 'path';

interface JsonData {
  flags: Flag[];
  apiKeys: ApiKey[];
}

export class JsonStorage implements Storage {
  private data: JsonData = { flags: [], apiKeys: [] };

  constructor(private filePath: string) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.filePath)) {
      const content = fs.readFileSync(this.filePath, 'utf-8');
      this.data = JSON.parse(content);
    } else {
      this.save();
    }
  }

  private save(): void {
    fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag> {
    const exists = this.data.flags.some(
      f => f.key === flag.key && f.environment === flag.environment
    );
    if (exists) throw new Error(`Flag with key '${flag.key}' already exists in environment '${flag.environment}'`);

    const id = nanoid();
    const now = new Date().toISOString();

    const newFlag: Flag = {
      id,
      ...flag,
      createdAt: now,
      updatedAt: now
    };

    this.data.flags.push(newFlag);
    this.save();

    return newFlag;
  }

  async getFlag(key: string, environment: string): Promise<Flag | null> {
    return this.data.flags.find(f => f.key === key && f.environment === environment) || null;
  }

  async getAllFlags(environment?: string): Promise<Flag[]> {
    if (environment) {
      return this.data.flags.filter(f => f.environment === environment);
    }
    return [...this.data.flags];
  }

  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    const index = this.data.flags.findIndex(f => f.id === id);
    if (index === -1) throw new Error('Flag not found');

    this.data.flags[index] = {
      ...this.data.flags[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };

    this.save();
    return this.data.flags[index];
  }

  async deleteFlag(id: string): Promise<void> {
    this.data.flags = this.data.flags.filter(f => f.id !== id);
    this.save();
  }

  async createApiKey(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey> {
    const id = nanoid();
    const now = new Date().toISOString();

    const newApiKey: ApiKey = {
      id,
      ...apiKey,
      createdAt: now
    };

    this.data.apiKeys.push(newApiKey);
    this.save();

    return newApiKey;
  }

  async getApiKey(key: string): Promise<ApiKey | null> {
    return this.data.apiKeys.find(k => k.key === key) || null;
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    return [...this.data.apiKeys];
  }

  async deleteApiKey(id: string): Promise<void> {
    this.data.apiKeys = this.data.apiKeys.filter(k => k.id !== id);
    this.save();
  }
}
