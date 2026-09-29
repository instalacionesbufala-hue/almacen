/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base relativa: la app funciona en GitHub Pages (/almacen/) y en cualquier subcarpeta
export default defineConfig({
  base: './',
  plugins: [react()],
  server: { port: 5173, host: true },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'supabase/tests/**/*.test.ts'], testTimeout: 30000, hookTimeout: 60000 },
});
