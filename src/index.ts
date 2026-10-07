import dotenv from 'dotenv';
import { startServer, ServerConfig, resolveHost } from './server.js';

dotenv.config();

const config: ServerConfig = {
  port: Number(process.env.PORT) || 6789,
  host: resolveHost(process.env.HOST),
  storageType: (process.env.STORAGE_TYPE as 'sqlite' | 'json') || 'sqlite',
  storagePath: process.env.STORAGE_PATH || './data/flagforge.db',
  adminPassword: process.env.ADMIN_PASSWORD,
};

startServer(config).catch((error) => {
  console.error('Failed to start server:', error.message ?? error);
  process.exit(1);
});
