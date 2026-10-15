import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Базовый путь для GitHub Pages: /<имя-репозитория>/
// При локальной разработке используется '/'.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1];

export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE || (repoName ? `/${repoName}/` : '/'),
  server: { port: 5173 },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0] & { test?: unknown });
