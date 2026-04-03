import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { Storage, Flag, ApiKey, Project, Environment } from '../types';
import * as fs from 'fs';
import * as path from 'path';

export class SqliteStorage implements Storage {
  private db: Database.Database | null = null;

  constructor(private dbPath: string) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS environments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id),
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(project_id, name)
      );

      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        environment TEXT NOT NULL,
        targeting TEXT,
        rollout TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, key, environment)
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL DEFAULT '',
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        environment TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flags_project_key_env ON flags(project_id, key, environment);
      CREATE INDEX IF NOT EXISTS idx_flags_project_env ON flags(project_id, environment);
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
      CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id);
      CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
    `);
  }

  async createProject(project: Omit<Project, 'id' | 'createdAt'>): Promise<Project> {
    if (!this.db) throw new Error('Database not initialized');
    const id = nanoid();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)').run(id, project.name, now);
    return { id, name: project.name, createdAt: now };
  }

  async getProject(id: string): Promise<Project | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as any;
    return row ? { id: row.id, name: row.name, createdAt: row.created_at } : null;
  }

  async getAllProjects(): Promise<Project[]> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = this.db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[];
    return rows.map(r => ({ id: r.id, name: r.name, createdAt: r.created_at }));
  }

  async deleteProject(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM api_keys WHERE project_id = ?').run(id);
    this.db.prepare('DELETE FROM flags WHERE project_id = ?').run(id);
    this.db.prepare('DELETE FROM environments WHERE project_id = ?').run(id);
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  async createEnvironment(env: Omit<Environment, 'id' | 'createdAt'>): Promise<Environment> {
    if (!this.db) throw new Error('Database not initialized');
    const id = nanoid();
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO environments (id, project_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, env.projectId, env.name, now);
    return { id, projectId: env.projectId, name: env.name, createdAt: now };
  }

  async getEnvironmentsByProject(projectId: string): Promise<Environment[]> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = this.db.prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[];
    return rows.map(r => ({ id: r.id, projectId: r.project_id, name: r.name, createdAt: r.created_at }));
  }

  async deleteEnvironment(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
    if (!row) return;
    this.db.prepare('DELETE FROM flags WHERE project_id = ? AND environment = ?').run(row.project_id, row.name);
    this.db.prepare('DELETE FROM api_keys WHERE project_id = ? AND environment = ?').run(row.project_id, row.name);
    this.db.prepare('DELETE FROM environments WHERE id = ?').run(id);
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    if (!this.db) throw new Error('Database not initialized');

    const projectId = flag.projectId || '';
    const envRows = projectId
      ? (this.db.prepare('SELECT name FROM environments WHERE project_id = ?').all(projectId) as any[])
      : [];
    const envNames = envRows.map(r => r.name as string);
    if (envNames.length === 0) envNames.push(flag.environment);

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO flags (id, project_id, key, name, description, enabled, environment, targeting, rollout, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const created: Flag[] = [];
    for (const envName of envNames) {
      const id = nanoid();
      insert.run(
        id,
        projectId,
        flag.key,
        flag.name,
        flag.description || null,
        flag.enabled ? 1 : 0,
        envName,
        flag.targeting ? JSON.stringify(flag.targeting) : null,
        flag.rollout ? JSON.stringify(flag.rollout) : null,
        now,
        now
      );
      created.push({
        id,
        projectId: flag.projectId,
        key: flag.key,
        name: flag.name,
        description: flag.description,
        enabled: flag.enabled,
        environment: envName,
        targeting: flag.targeting,
        rollout: flag.rollout,
        createdAt: now,
        updatedAt: now,
      });
    }

    return created;
  }

  async getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> {
    if (!this.db) throw new Error('Database not initialized');
    const pid = projectId || '';
    const row = this.db.prepare('SELECT * FROM flags WHERE project_id = ? AND key = ? AND environment = ?').get(pid, key, environment) as any;
    return row ? this.rowToFlag(row) : null;
  }

  async getAllFlags(projectId: string, environment?: string): Promise<Flag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const pid = projectId || '';
    let rows: any[];
    if (environment) {
      rows = this.db.prepare('SELECT * FROM flags WHERE project_id = ? AND environment = ? ORDER BY created_at DESC').all(pid, environment) as any[];
    } else {
      rows = this.db.prepare('SELECT * FROM flags WHERE project_id = ? ORDER BY created_at DESC').all(pid) as any[];
    }
    return rows.map(r => this.rowToFlag(r));
  }

  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name); }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description); }
    if (updates.enabled !== undefined) { fields.push('enabled = ?'); values.push(updates.enabled ? 1 : 0); }
    if (updates.targeting !== undefined) { fields.push('targeting = ?'); values.push(updates.targeting ? JSON.stringify(updates.targeting) : null); }
    if (updates.rollout !== undefined) { fields.push('rollout = ?'); values.push(updates.rollout ? JSON.stringify(updates.rollout) : null); }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    this.db.prepare(`UPDATE flags SET ${fields.join(', ')} WHERE id = ?`).run(...values);

    const row = this.db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Flag not found');
    return this.rowToFlag(row);
  }

  async deleteFlag(projectId: string, key: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const pid = projectId || '';
    this.db.prepare('DELETE FROM flags WHERE project_id = ? AND key = ?').run(pid, key);
  }

  async createApiKey(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey> {
    if (!this.db) throw new Error('Database not initialized');
    const id = nanoid();
    const now = new Date().toISOString();
    const projectId = apiKey.projectId ?? '';
    this.db.prepare('INSERT INTO api_keys (id, project_id, key, name, environment, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, projectId, apiKey.key, apiKey.name, apiKey.environment, now);
    return { id, projectId: apiKey.projectId, key: apiKey.key, name: apiKey.name, environment: apiKey.environment, createdAt: now };
  }

  async getApiKey(key: string): Promise<ApiKey | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM api_keys WHERE key = ?').get(key) as any;
    return row ? this.rowToApiKey(row) : null;
  }

  async getAllApiKeys(projectId?: string): Promise<ApiKey[]> {
    if (!this.db) throw new Error('Database not initialized');
    let rows: any[];
    if (projectId) {
      rows = this.db.prepare('SELECT * FROM api_keys WHERE project_id = ? ORDER BY created_at DESC').all(projectId) as any[];
    } else {
      rows = this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];
    }
    return rows.map(r => this.rowToApiKey(r));
  }

  async deleteApiKey(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);
  }

  private rowToFlag(row: any): Flag {
    return {
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      name: row.name,
      description: row.description,
      enabled: row.enabled === 1,
      environment: row.environment,
      targeting: row.targeting ? JSON.parse(row.targeting) : undefined,
      rollout: row.rollout ? JSON.parse(row.rollout) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rowToApiKey(row: any): ApiKey {
    return {
      id: row.id,
      projectId: row.project_id,
      key: row.key,
      name: row.name,
      environment: row.environment,
      createdAt: row.created_at,
    };
  }
}
