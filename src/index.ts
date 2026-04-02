import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { appendFileSync } from 'fs';
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
import { nanoid } from 'nanoid';

dotenv.config();

const PORT = process.env.PORT || 3000;
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'sqlite';
const STORAGE_PATH = process.env.STORAGE_PATH || './data/rollerflags.db';

const __dirname = dirname(fileURLToPath(import.meta.url));

function bootstrapAdminPassword(): void {
  if (process.env.ADMIN_PASSWORD) return;

  const password = `rf_admin_${nanoid(32)}`;
  process.env.ADMIN_PASSWORD = password;

  const envPath = join(process.cwd(), '.env');
  const line = `\nADMIN_PASSWORD=${password}\n`;
  try {
    appendFileSync(envPath, line, 'utf8');
  } catch (_err) {
    console.warn('Warning: could not persist ADMIN_PASSWORD to .env — store it manually:', password);
  }

  console.log('\n========================================');
  console.log('  ADMIN PASSWORD GENERATED (first boot)');
  console.log(`  ${password}`);
  console.log('  Saved to .env — keep it safe!');
  console.log('========================================\n');
}

async function bootstrapUiAdminKey(storage: Storage): Promise<void> {
  const allKeys = await storage.getAllApiKeys();
  const exists = allKeys.some(k => k.name === '__ui_admin__');
  if (!exists) {
    await storage.createApiKey({
      key: `rf_${nanoid(32)}`,
      name: '__ui_admin__',
      environment: '__admin__'
    });
    console.log('✓ UI admin key created');
  }
}

async function main() {
  bootstrapAdminPassword();

  const app = express();
  const sessions: SessionStore = new Map();

  // Periodically clean up expired sessions to prevent memory leak
  setInterval(() => {
    const now = new Date();
    for (const [token, expiresAt] of sessions) {
      if (expiresAt <= now) sessions.delete(token);
    }
  }, 3_600_000).unref(); // every hour, don't block process exit

  app.use(cors());
  app.use(express.json());
  app.use(cookieParser());

  let storage: Storage;
  if (STORAGE_TYPE === 'json') {
    storage = new JsonStorage(STORAGE_PATH);
  } else {
    storage = new SqliteStorage(STORAGE_PATH);
  }

  await storage.initialize();
  console.log(`✓ Storage initialized (${STORAGE_TYPE})`);

  await bootstrapUiAdminKey(storage);

  const evaluator = new FlagEvaluator();
  const authMiddleware = createAuthMiddleware(storage);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', storage: STORAGE_TYPE });
  });

  app.use('/auth', createAuthRouter(sessions));
  app.use('/admin', requireAdminSession(sessions), createAdminRouter(storage));
  app.use('/api/flags', authMiddleware, createFlagsRouter(storage));
  app.use('/api/evaluate', authMiddleware, createEvaluateRouter(storage, evaluator));

  const uiDistPath = join(__dirname, '../ui/dist');
  app.use(express.static(uiDistPath));

  // JSON 404 for unmatched API routes
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  app.get('*', (_req, res) => {
    res.sendFile(join(uiDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 RollerFlags is running on http://localhost:${PORT}`);
    console.log(`   Storage: ${STORAGE_TYPE}`);
    console.log(`   Path: ${STORAGE_PATH}\n`);
  });
}

main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
