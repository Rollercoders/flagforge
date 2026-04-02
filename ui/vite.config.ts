import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:6789',
      '/admin': 'http://localhost:6789',
      '/health': 'http://localhost:6789',
    },
  },
  build: {
    outDir: 'dist',
  },
});
