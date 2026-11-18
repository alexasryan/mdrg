import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig(({ command, isPreview }) => ({
  root: 'site',
  publicDir: '../public',
  plugins: [react()],
  base: process.env.VITE_BASE || (command === 'serve' && !isPreview ? '/' : '/mdrg/'),
  server: { host: '0.0.0.0', port: 5173 },
  build: { outDir: '../dist', emptyOutDir: true },
  test: { root: '.', environment: 'node', include: ['src/**/*.test.ts'] },
}));
