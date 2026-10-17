// Compile-time UI feature flags (R-DEL-002, R-DEL-006).
//
// Unfinished features are hidden behind flags that are resolved at BUILD time,
// not toggled at runtime. The values below are inlined by Vite's `define`
// (see vite.config.ts) through the `__FEATURES__` global, so dead code for an
// OFF feature is eliminated from the bundle rather than guarded by a runtime
// condition.
//
// R-DEL-006: each flag names the release that turns it on. A flag MUST be
// removed in or before the release named here once its module ships.
//
//   patients  -> M1 (patient register + case file)
//   settings  -> M1 (settings screen)
//
// At M0 every flag is false: only Today ships as a reachable screen.

/** The shape of the compile-time feature set injected by Vite `define`. */
export interface Features {
  /** Patients module (register, search, case file). Turns on at M1. */
  readonly patients: boolean;
  /** Settings module. Turns on at M1. */
  readonly settings: boolean;
  /**
   * Backup and restore module (S17 / BAK-001..004). Turns on at M1 Slice D:
   * the nav item, the `/backup` route and the status-bar chip link become
   * reachable.
   */
  readonly backup: boolean;
  /**
   * The "Move to a new computer" guided flow (BAK-005 / HC-MVP1-035, P1).
   * DEFERRED at R1 (OQ-S17-4): the S17 button renders visibly disabled so
   * there is no dead end, and the plain back-up-then-restore path already
   * achieves the same result. Turns on when BAK-005 ships later in MVP1.
   */
  readonly backupMoveToNewComputer: boolean;
  /**
   * Setup wizard P1 controls: font size (SET-005 / HC-MVP1-028) and the
   * data-folder chooser (SET-006 / HC-MVP1-029). DEFERRED this slice — the
   * controls may render disabled, and the wizard completes without them
   * (R-DEL-002/006). Turns on at a later M1 slice.
   */
  readonly setupP1Controls: boolean;
  /**
   * The "I already have a licence" import path on the setup licence step
   * (S20 / LIC-061). Hidden until R8; the trial-only path is the default.
   */
  readonly licenceImport: boolean;
}

// `__FEATURES__` is a Vite compile-time constant (see vite.config.ts `define`
// and the ambient declaration in src/vite-env.d.ts). Referencing it here lets
// the bundler inline the literal object, so `features.patients` becomes a
// literal `false` at build time.
/** Build-time feature flags. All OFF at M0. */
export const features: Features = __FEATURES__;
