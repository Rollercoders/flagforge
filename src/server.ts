import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SqliteStorage } from './storage/sqlite.js';
import { JsonStorage } from './storage/json.js';
import { Storage } from './types.js';
import { FlagEvaluator } from './evaluator.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { requireAdminSession, SessionStore } from './middleware/adminAuth.js';
import { createFlagsRouter } from './routes/flags.js';
import { createEvaluateRouter } from './routes/evaluate.js';
import { createAdminRouter } from './routes/admin.js';
import { createAuthRouter } from './routes/auth.js';
import { createProjectsRouter } from './routes/projects.js';
import { createAdminFlagsRouter } from './routes/adminFlags.js';
import { createAdminEvaluateRouter } from './routes/adminEvaluate.js';
import { createMcpRouter } from './mcp/server.js';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ServerConfig {
  port: number;
  storageType: 'sqlite' | 'json';
  storagePath: string;
  adminPassword?: string;
  mcpToken?: string;
}

/**
 * Determina se l'endpoint MCP va montato: solo se il token è presente e non vuoto
 * (dopo trim). Funzione pura, estratta per essere testabile senza avviare un listener reale.
 */
export function shouldMountMcp(token?: string): boolean {
  return typeof token === 'string' && token.trim() !== '';
}

export interface StartResult {
  adminPassword: string;
  generatedPassword: boolean;
  url: string;
}

export async function startServer(config: ServerConfig): Promise<StartResult> {
  let adminPassword = config.adminPassword;
  let generatedPassword = false;
  if (!adminPassword) {
    adminPassword = `ff_admin_${nanoid(32)}`;
    generatedPassword = true;
    console.log('\n========================================');
    console.log('  ADMIN PASSWORD GENERATED (first boot)');
    console.log(`  ${adminPassword}`);
    console.log('  Set ADMIN_PASSWORD in your .env to keep it stable.');
    console.log('========================================\n');
  }
  process.env.ADMIN_PASSWORD = adminPassword;

  const app = express();
  const sessions: SessionStore = new Map();

  setInterval(() => {
    const now = new Date();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  }, 3_600_000).unref();

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  let storage: Storage;
  if (config.storageType === 'json') {
    storage = new JsonStorage(config.storagePath);
  } else {
    storage = new SqliteStorage(config.storagePath);
  }

  await storage.initialize();
  console.log(`✓ Storage initialized (${config.storageType})`);

  await storage.bootstrapAdminKey();
  console.log('✓ UI admin key ready');

  const evaluator = new FlagEvaluator();
  const authMiddleware = createAuthMiddleware(storage);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: config.storageType });
  });

  app.use('/auth', createAuthRouter(sessions));
  app.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  app.use('/admin', requireAdminSession(sessions), createProjectsRouter(storage));
  app.use('/admin/flags', requireAdminSession(sessions), createAdminFlagsRouter(storage));
  app.use('/admin/evaluate', requireAdminSession(sessions), createAdminEvaluateRouter(storage, evaluator));
  app.use('/api/flags', authMiddleware, createFlagsRouter(storage));
  app.use('/api/evaluate', authMiddleware, createEvaluateRouter(storage, evaluator));

  const mcpToken = config.mcpToken ?? process.env.MCP_TOKEN;
  if (shouldMountMcp(mcpToken)) {
    app.use('/mcp', createMcpRouter(storage, evaluator, mcpToken as string));
    console.log('✓ MCP endpoint mounted at /mcp');
  }

  const uiDistPath = join(__dirname, '../ui/dist');
  app.use(express.static(uiDistPath));

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.get('*', (_req, res) => {
    res.sendFile(join(uiDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  const url = `http://localhost:${config.port}`;

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(config.port, () => resolve());
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        reject(new Error(`La porta ${config.port} è già in uso. Scegli un'altra porta o libera quella attuale.`));
      } else {
        reject(err);
      }
    });
  });

  console.log(`\n🚀 FlagForge is running on ${url}`);
  console.log(`   Storage: ${config.storageType}`);
  console.log(`   Path: ${config.storagePath}\n`);

  return { adminPassword, generatedPassword, url };
}
