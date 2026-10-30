import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// 前端直接使用核心模組的 TypeScript 原始碼，與後端共用同一套計算。
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@tanker/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 3000}`, changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 2500,
  },
});
