import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { Storage, Flag, Project, Environment, ApiKeyRole } from '../types.js';
import { normalizeFlagType } from '../flagValue.js';
import * as fs from 'fs';
import * as path from 'path';

export class SqliteStorage implements Storage {
  private db: Database.Database | null = null;

  constructor(private dbPath: string) {}

  async initialize(): Promise<void> {
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
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
        key TEXT UNIQUE NOT NULL DEFAULT '',
        secret_key TEXT DEFAULT '',
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
        type TEXT NOT NULL DEFAULT 'boolean',
        value TEXT,
        default_value TEXT,
        environment TEXT NOT NULL,
        targeting TEXT,
        rollout TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, key, environment)
      );

      CREATE TABLE IF NOT EXISTS admin_keys (
        id TEXT PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flags_project_key_env ON flags(project_id, key, environment);
      CREATE INDEX IF NOT EXISTS idx_flags_project_env ON flags(project_id, environment);
      CREATE INDEX IF NOT EXISTS idx_environments_project ON environments(project_id);
      CREATE INDEX IF NOT EXISTS idx_environments_key ON environments(key);
    `);

    // Migrazione idempotente: aggiunge le colonne dei flag tipizzati se mancano.
    for (const stmt of [
      "ALTER TABLE flags ADD COLUMN type TEXT NOT NULL DEFAULT 'boolean'",
      'ALTER TABLE flags ADD COLUMN value TEXT',
      'ALTER TABLE flags ADD COLUMN default_value TEXT',
    ]) {
      try {
        this.db.exec(stmt);
      } catch {
        // colonna già presente: no-op
      }
    }

    // Idempotent migration: add the secret_key column if missing, then backfill.
    try {
      this.db.exec("ALTER TABLE environments ADD COLUMN secret_key TEXT DEFAULT ''");
    } catch {
      /* already present */
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS idx_environments_secret_key ON environments(secret_key)');
    await this.backfillSecretKeys();
  }

  async backfillSecretKeys(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = this.db.prepare("SELECT id FROM environments WHERE secret_key IS NULL OR secret_key = ''").all() as any[];
    for (const r of rows) {
      this.db.prepare('UPDATE environments SET secret_key = ? WHERE id = ?').run(`ffs_${nanoid(32)}`, r.id);
    }
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
    const db = this.db;
    db.transaction(() => {
      db.prepare('DELETE FROM flags WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM environments WHERE project_id = ?').run(id);
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    })();
  }

  async createEnvironment(env: Omit<Environment, 'id' | 'createdAt' | 'key' | 'secretKey'>): Promise<Environment> {
    if (!this.db) throw new Error('Database not initialized');
    const id = nanoid();
    const key = `ff_${nanoid(32)}`;
    const secretKey = `ffs_${nanoid(32)}`;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO environments (id, project_id, name, key, secret_key, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(id, env.projectId, env.name, key, secretKey, now);

    // Auto-backfill: copy existing flag keys into the new environment
    const existingFlags = this.db.prepare(
      'SELECT key, name, description, type, value, default_value, targeting, rollout FROM flags WHERE project_id = ? AND environment != ? GROUP BY key'
    ).all(env.projectId, env.name) as any[];
    for (const flag of existingFlags) {
      const flagId = nanoid();
      this.db.prepare(
        'INSERT OR IGNORE INTO flags (id, project_id, key, name, description, enabled, type, value, default_value, environment, targeting, rollout, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(flagId, env.projectId, flag.key, flag.name, flag.description ?? null, 0,
        flag.type ?? 'boolean', flag.value ?? null, flag.default_value ?? null,
        env.name, flag.targeting ?? null, flag.rollout ?? null, now, now);
    }

    return { id, projectId: env.projectId, name: env.name, key, secretKey, createdAt: now };
  }

  async getEnvironmentsByProject(projectId: string): Promise<Environment[]> {
    if (!this.db) throw new Error('Database not initialized');
    const rows = this.db.prepare('SELECT * FROM environments WHERE project_id = ? ORDER BY created_at ASC').all(projectId) as any[];
    return rows.map(r => this.rowToEnvironment(r));
  }

  async getEnvironmentByKey(key: string): Promise<Environment | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM environments WHERE key = ?').get(key) as any;
    return row ? this.rowToEnvironment(row) : null;
  }

  async regenerateEnvironmentKey(envId: string, role: ApiKeyRole): Promise<Environment> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(envId) as any;
    if (!row) throw new Error('Environment not found');
    if (role === 'client') {
      const newKey = `ff_${nanoid(32)}`;
      this.db.prepare('UPDATE environments SET key = ? WHERE id = ?').run(newKey, envId);
      return this.rowToEnvironment({ ...row, key: newKey });
    }
    const newSecret = `ffs_${nanoid(32)}`;
    this.db.prepare('UPDATE environments SET secret_key = ? WHERE id = ?').run(newSecret, envId);
    return this.rowToEnvironment({ ...row, secret_key: newSecret });
  }

  async getEnvironmentByAnyKey(token: string): Promise<{ environment: Environment; role: ApiKeyRole } | null> {
    if (!this.db) throw new Error('Database not initialized');
    const byClient = this.db.prepare('SELECT * FROM environments WHERE key = ?').get(token) as any;
    if (byClient) return { environment: this.rowToEnvironment(byClient), role: 'client' };
    const bySecret = this.db.prepare('SELECT * FROM environments WHERE secret_key = ?').get(token) as any;
    if (bySecret) return { environment: this.rowToEnvironment(bySecret), role: 'secret' };
    return null;
  }

  async deleteEnvironment(id: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
    if (!row) return;
    this.db.prepare('DELETE FROM flags WHERE project_id = ? AND environment = ?').run(row.project_id, row.name);
    this.db.prepare('DELETE FROM environments WHERE id = ?').run(id);
  }

  async renameEnvironment(id: string, name: string): Promise<Environment> {
    if (!this.db) throw new Error('Database not initialized');
    const db = this.db;
    const row = db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Environment not found');
    const oldName: string = row.name;
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare('UPDATE environments SET name = ? WHERE id = ?').run(name, id);
      db.prepare('UPDATE flags SET environment = ?, updated_at = ? WHERE project_id = ? AND environment = ?').run(name, now, row.project_id, oldName);
    })();
    const updated = db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as any;
    return this.rowToEnvironment(updated);
  }

  async getAdminKey(): Promise<string | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT key FROM admin_keys LIMIT 1').get() as any;
    return row ? row.key : null;
  }

  async bootstrapAdminKey(): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    const existing = this.db.prepare('SELECT id FROM admin_keys LIMIT 1').get();
    if (existing) return;
    const id = nanoid();
    const key = `ff_${nanoid(32)}`;
    const now = new Date().toISOString();
    this.db.prepare('INSERT INTO admin_keys (id, key, name, created_at) VALUES (?, ?, ?, ?)').run(id, key, '__ui_admin__', now);
  }

  async createFlag(flag: Omit<Flag, 'id' | 'createdAt' | 'updatedAt'>): Promise<Flag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const projectId = flag.projectId || '';
    const envRows = projectId
      ? (this.db.prepare('SELECT name FROM environments WHERE project_id = ?').all(projectId) as any[])
      : [];
    const envNames = envRows.map(r => r.name as string);
    if (envNames.length === 0) envNames.push(flag.environment);

    const type = normalizeFlagType(flag.type);
    const valueJson = flag.value !== undefined ? JSON.stringify(flag.value) : null;
    const defaultValueJson = flag.defaultValue !== undefined ? JSON.stringify(flag.defaultValue) : null;

    const now = new Date().toISOString();
    const insert = this.db.prepare(`
      INSERT INTO flags (id, project_id, key, name, description, enabled, type, value, default_value, environment, targeting, rollout, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const created: Flag[] = [];
    for (const envName of envNames) {
      const id = nanoid();
      insert.run(id, projectId, flag.key, flag.name, flag.description || null, flag.enabled ? 1 : 0,
        type, valueJson, defaultValueJson, envName,
        flag.targeting ? JSON.stringify(flag.targeting) : null, flag.rollout ? JSON.stringify(flag.rollout) : null, now, now);
      created.push({ id, projectId: flag.projectId, key: flag.key, name: flag.name, description: flag.description,
        enabled: flag.enabled, type, value: flag.value, defaultValue: flag.defaultValue, environment: envName,
        targeting: flag.targeting, rollout: flag.rollout, createdAt: now, updatedAt: now });
    }
    return created;
  }

  async getFlag(projectId: string, key: string, environment: string): Promise<Flag | null> {
    if (!this.db) throw new Error('Database not initialized');
    const row = this.db.prepare('SELECT * FROM flags WHERE project_id = ? AND key = ? AND environment = ?').get(projectId || '', key, environment) as any;
    return row ? this.rowToFlag(row) : null;
  }

  async getAllFlags(projectId: string, environment?: string): Promise<Flag[]> {
    if (!this.db) throw new Error('Database not initialized');
    const pid = projectId || '';
    const rows = environment
      ? this.db.prepare('SELECT * FROM flags WHERE project_id = ? AND environment = ? ORDER BY created_at DESC').all(pid, environment) as any[]
      : this.db.prepare('SELECT * FROM flags WHERE project_id = ? ORDER BY created_at DESC').all(pid) as any[];
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
    if (updates.value !== undefined) { fields.push('value = ?'); values.push(updates.value === null ? null : JSON.stringify(updates.value)); }
    if (updates.defaultValue !== undefined) { fields.push('default_value = ?'); values.push(updates.defaultValue === null ? null : JSON.stringify(updates.defaultValue)); }
    fields.push('updated_at = ?');
    values.push(now, id);
    this.db.prepare(`UPDATE flags SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const row = this.db.prepare('SELECT * FROM flags WHERE id = ?').get(id) as any;
    if (!row) throw new Error('Flag not found');
    return this.rowToFlag(row);
  }

  async deleteFlag(projectId: string, key: string): Promise<void> {
    if (!this.db) throw new Error('Database not initialized');
    this.db.prepare('DELETE FROM flags WHERE project_id = ? AND key = ?').run(projectId || '', key);
  }

  private rowToEnvironment(row: any): Environment {
    return { id: row.id, projectId: row.project_id, name: row.name, key: row.key, secretKey: row.secret_key ?? '', createdAt: row.created_at };
  }

  private rowToFlag(row: any): Flag {
    return {
      id: row.id, projectId: row.project_id, key: row.key, name: row.name, description: row.description,
      enabled: row.enabled === 1, type: normalizeFlagType(row.type), environment: row.environment,
      value: row.value != null ? JSON.parse(row.value) : undefined,
      defaultValue: row.default_value != null ? JSON.parse(row.default_value) : undefined,
      targeting: row.targeting ? JSON.parse(row.targeting) : undefined,
      rollout: row.rollout ? JSON.parse(row.rollout) : undefined,
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
}
