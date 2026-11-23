// Idle auto-lock choices (SET-004), shared by the S01 setup wizard and S18
// Settings so both offer the same list. The backend accepts 1-120 minutes.

/** Auto-lock options in minutes (SET-004; default 15). */
export const AUTOLOCK_OPTIONS = [5, 10, 15, 30, 60] as const;
