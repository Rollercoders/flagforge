import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { Storage, Flag, ApiKey } from '../types';
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
      CREATE TABLE IF NOT EXISTS flags (
        id TEXT PRIMARY KEY,
        key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        enabled INTEGER NOT NULL DEFAULT 0,
        environment TEXT NOT NULL,
        targeting TEXT,
        rollout TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(key, environment)
      );

      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        environment TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flags_key_env ON flags(key, environment);
      CREATE INDEX IF NOT EXISTS idx_flags_env ON flags(environment);
      CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(key);
    `);
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag> {
    if (!this.db) throw new Error('Database not initialized');

    const id = nanoid();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO flags (id, key, name, description, enabled, environment, targeting, rollout, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      flag.key,
      flag.name,
      flag.description || null,
      flag.enabled ? 1 : 0,
      flag.environment,
      flag.targeting ? JSON.stringify(flag.targeting) : null,
      flag.rollout ? JSON.stringify(flag.rollout) : null,
      now,
      now
    );

    return {
      id,
      ...flag,
      createdAt: now,
      updatedAt: now
    };
  }

  async getFlag(key: string, environment: string): Promise<Flag | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM flags WHERE key = ? AND environment = ?');
    const row = stmt.get(key, environment) as any;

    return row ? this.rowToFlag(row) : null;
  }

  async getAllFlags(environment?: string): Promise<Flag[]> {
    if (!this.db) throw new Error('Database not initialized');

    let stmt;
    let rows;

    if (environment) {
      stmt = this.db.prepare('SELECT * FROM flags WHERE environment = ? ORDER BY created_at DESC');
      rows = stmt.all(environment) as any[];
    } else {
      stmt = this.db.prepare('SELECT * FROM flags ORDER BY created_at DESC');
      rows = stmt.all() as any[];
    }

    return rows.map(row => this.rowToFlag(row));
  }

  async updateFlag(id: string, updates: Partial<Flag>): Promise<Flag> {
    if (!this.db) throw new Error('Database not initialized');

    const now = new Date().toISOString();
    const fields: string[] = [];
    const values: any[] = [];

    if (updates.name !== undefined) {
      fields.push('name = ?');
      values.push(updates.name);
    }
    if (updates.description !== undefined) {
      fields.push('description = ?');
      values.push(updates.description);
    }
    if (updates.enabled !== undefined) {
      fields.push('enabled = ?');
      values.push(updates.enabled ? 1 : 0);
    }
    if (updates.targeting !== undefined) {
      fields.push('targeting = ?');
      values.push(updates.targeting ? JSON.stringify(updates.targeting) : null);
    }
    if (updates.rollout !== undefined) {
      fields.push('rollout = ?');
      values.push(updates.rollout ? JSON.stringify(updates.rollout) : null);
    }

    fields.push('updated_at = ?');
    values.push(now);
    values.push(id);

    const stmt = this.db.prepare(`UPDATE flags SET ${fields.join(', ')} WHERE id = ?`);
    stmt.run(...values);

    const getStmt = this.db.prepare('SELECT * FROM flags WHERE id = ?');
    const row = getStmt.get(id) as any;

    if (!row) throw new Error('Flag not found');
    return this.rowToFlag(row);
  }

  async deleteFlag(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM flags WHERE id = ?');
    stmt.run(id);
  }

  async createApiKey(apiKey: Omit<ApiKey, 'id' | 'createdAt'>): Promise<ApiKey> {
    if (!this.db) throw new Error('Database not initialized');

    const id = nanoid();
    const now = new Date().toISOString();

    const stmt = this.db.prepare(`
      INSERT INTO api_keys (id, key, name, environment, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    stmt.run(id, apiKey.key, apiKey.name, apiKey.environment, now);

    return {
      id,
      ...apiKey,
      createdAt: now
    };
  }

  async getApiKey(key: string): Promise<ApiKey | null> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM api_keys WHERE key = ?');
    const row = stmt.get(key) as any;

    return row ? this.rowToApiKey(row) : null;
  }

  async getAllApiKeys(): Promise<ApiKey[]> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC');
    const rows = stmt.all() as any[];

    return rows.map(row => this.rowToApiKey(row));
  }

  async deleteApiKey(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');

    const stmt = this.db.prepare('DELETE FROM api_keys WHERE id = ?');
    stmt.run(id);
  }

  private rowToFlag(row: any): Flag {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      description: row.description,
      enabled: row.enabled === 1,
      environment: row.environment,
      targeting: row.targeting ? JSON.parse(row.targeting) : undefined,
      rollout: row.rollout ? JSON.parse(row.rollout) : undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  private rowToApiKey(row: any): ApiKey {
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      environment: row.environment,
      createdAt: row.created_at
    };
  }
}
