import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';
import { SqliteStorage } from './storage/sqlite';
import { JsonStorage } from './storage/json';
import { Storage } from './types';
import { FlagEvaluator } from './evaluator';
import { createAuthMiddleware } from './middleware/auth';
import { createFlagsRouter } from './routes/flags';
import { createEvaluateRouter } from './routes/evaluate';
import { createAdminRouter } from './routes/admin';
import { nanoid } from 'nanoid';

dotenv.config();

const PORT = process.env.PORT || 3000;
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'sqlite';
const STORAGE_PATH = process.env.STORAGE_PATH || './data/rollerflags.db';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Initialize storage
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

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', storage: STORAGE_TYPE });
  });

  // Admin routes (no auth required for API key management)
  app.use('/admin', createAdminRouter(storage));

  // Protected routes
  app.use('/api/flags', authMiddleware, createFlagsRouter(storage));
  app.use('/api/evaluate', authMiddleware, createEvaluateRouter(storage, evaluator));

  // Serve Web UI static files
  const uiDistPath = join(__dirname, '../ui/dist');
  app.use(express.static(uiDistPath));

  // SPA catch-all: serve index.html for any non-API route
  app.get('*', (_req, res) => {
    res.sendFile(join(uiDistPath, 'index.html'), (err) => {
      if (err) res.status(404).send('Not found');
    });
  });

  app.listen(PORT, () => {
    console.log(`\n🚀 RollerFlags is running on http://localhost:${PORT}`);
    console.log(`   Storage: ${STORAGE_TYPE}`);
    console.log(`   Path: ${STORAGE_PATH}\n`);
    console.log('📚 Endpoints:');
    console.log('   GET    /admin/ui-token           - Get UI token');
    console.log('   POST   /admin/api-keys           - Create API key');
    console.log('   GET    /admin/api-keys           - List API keys');
    console.log('   DELETE /admin/api-keys/:id       - Delete API key');
    console.log('   POST   /api/flags                - Create flag');
    console.log('   GET    /api/flags                - List flags');
    console.log('   GET    /api/flags/:key           - Get flag');
    console.log('   PATCH  /api/flags/:key           - Update flag');
    console.log('   DELETE /api/flags/:key           - Delete flag');
    console.log('   POST   /api/evaluate/:key        - Evaluate flag');
    console.log('   POST   /api/evaluate             - Batch evaluate\n');
  });
}

main().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
