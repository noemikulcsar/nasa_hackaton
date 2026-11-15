import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The interface talks to the API only over HTTP; in development Vite forwards /api to the backend.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_URL ?? 'http://localhost:3001', changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 2000 },
});
