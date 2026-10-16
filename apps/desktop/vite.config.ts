/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Vite + Vitest config. The `@/*` alias mirrors tsconfig.json (design §3b) so
// both tsc and the bundler resolve `@/bindings`, `@/locales/...`, etc.
//
// `__FEATURES__` is the compile-time feature-flag set (R-DEL-002). Values are
// inlined into the bundle at build time via `define`, so an OFF feature's dead
// code is eliminated rather than guarded at runtime. At M0 every flag is false;
// each flag names the release that turns it on in src/shared/features.ts
// (R-DEL-006).
const FEATURES = {
  patients: false, // turns on at M1
  settings: false, // turns on at M1
};

export default defineConfig({
  plugins: [react()],
  // Tauri expects a relative base so the bundled assets load under asset:.
  base: './',
  define: {
    __FEATURES__: JSON.stringify(FEATURES),
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Matches tauri.conf.json build.frontendDist ("../dist").
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
