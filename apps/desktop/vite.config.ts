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
  patients: true, // S04/S05/S06/S07 patient UI ships at M2 Slice D (R2)
  settings: false, // turns on at M1
  backup: true, // S17 backup/restore ships at M1 Slice D (BAK-001..004)
  backupMoveToNewComputer: false, // BAK-005 move-to-new-computer: DEFERRED (OQ-S17-4)
  setupP1Controls: false, // SET-005 font + SET-006 data-folder: DEFERRED (R-DEL-002/006)
  licenceImport: false, // "I already have a licence" import path: hidden until R8
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
