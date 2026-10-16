// Ambient declarations for Vite compile-time constants injected via `define`
// (vite.config.ts). `__FEATURES__` is replaced at build time with a literal
// feature-flag object (see src/shared/features.ts).
import type { Features } from '@/shared/features';

declare global {
  // Compile-time feature set, inlined by Vite `define`. Typed so flag names
  // are checked at compile time.
  const __FEATURES__: Features;
}

export {};
