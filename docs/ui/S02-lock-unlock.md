# S02 Lock / unlock
Screen id: lock   Route: /lock   Module: apps/desktop/src/app
Requirements: SET-004, SUX-003, SUX-005   Milestone: M1  Release: R1

## Purpose
Protect patient data behind a single PIN entry. Shown on launch, after idle
auto-lock, and on explicit lock (Ctrl+L). Unlocking is the only routine security
interaction in daily use (SUX-003).

## Entry points
- On app launch once setup is complete (S01 done).
- After the configured idle timeout (SET-004, default 15 min).
- On Ctrl+L or the `[L]` button in the top bar (conventions section 2).

## Layout (wireframe)
Full-window overlay, no nav, centered card. Content area 1366 px; card 420 px.

```
+----------------------------------------------------------------------------------+
|                                                                                    |
|                         +--------------------------------+                         |
|                         |            [Logo]              |                         |
|                         |         HomeoClinic            |                         |
|                         |                                |                         |
|                         |   Enter PIN to unlock          |                         |
|                         |   [ * * * * ]                  |                         |
|                         |   {inline error if wrong}      |                         |
|                         |                                |                         |
|                         |          [ Unlock ]            |                         |
|                         |                                |                         |
|                         |   Forgot PIN?  (link)          |                         |
|                         +--------------------------------+                         |
|                                                                                    |
+----------------------------------------------------------------------------------+
```

Forgot-PIN panel (replaces the card on click, SET-004):
```
                         +--------------------------------+
                         |  Recovery                      |
                         |  Recovery code [____-____-____] |
                         |  New PIN       [____]           |
                         |  Confirm PIN   [____]           |
                         |  {inline error}                 |
                         |         [ Reset PIN ]           |
                         |  Back to unlock (link)          |
                         +--------------------------------+
```

## Fields and controls (element | type | rules | testid)
| Element | Type | Rules | testid |
|---|---|---|---|
| PIN input | password | masked; single entry unlocks (SUX-003) | lock-pin |
| Unlock | button | submits PIN; disabled while empty | lock-unlock |
| Inline error | text | plain language; shows attempts remaining | lock-error |
| Forgot PIN link | link | opens recovery panel (SET-004) | lock-forgot |
| Recovery code input | text | grouped entry, matches setup format (SET-004) | lock-recovery-code |
| New PIN | password | required | lock-recovery-newpin |
| Confirm PIN | password | must equal New PIN | lock-recovery-confirm |
| Reset PIN | button | verifies recovery code, sets new PIN | lock-recovery-submit |
| Back to unlock link | link | returns to PIN entry | lock-recovery-back |

## Behaviour
- A correct PIN unlocks immediately and restores the screen that was open before
  locking. One entry is enough (SUX-003).
- A wrong PIN shows an inline message and keeps the user on the lock screen; a
  single failed entry never restricts or wipes anything (SUX-005).
- Forgot PIN uses the recovery code shown at setup (SET-004) to set a new PIN.
  The recovery code is verified locally; no internet (SUX-004 applies globally).
- Auto-lock fires after the idle timeout (SET-004); any unsaved clinical data is
  already autosaved (CASE-005), so locking never loses data.
- Locking is instant and does not prompt to save (conventions: Esc / lock never
  discards data silently).

## Release slices
- R0 (M0): a lock-screen stub is present in the shell so the app launches to a
  consistent entry point; PIN verification against stored hash and the recovery
  flow are flagged off until R1 (there is no PIN before setup exists).
- R1 (M1): full PIN unlock, idle auto-lock, Ctrl+L and the recovery-code reset
  work. This is the R1 demo "unlock with PIN; wrong PIN is refused".
- No later release changes this screen in MVP1 (Windows Hello / fingerprint is a
  P1 idea in SUX-003 and is out of scope here; recorded in Open questions).

## States (empty, loading, error, read-only, trial)
- Empty: PIN field blank, Unlock disabled.
- Loading: verifying the PIN shows a brief inline state on the button; never a
  blocking spinner.
- Error: wrong PIN -> inline message with attempts remaining; recovery code
  wrong -> inline message naming what to check. No stack traces (NFR-033).
- Read-only: the lock screen itself is unaffected by licence state; read-only
  mode (LIC-020) applies after unlock, inside the app.
- Trial: the trial badge is not shown on the lock screen; it appears in the
  shell after unlock.

## Keyboard
- Enter submits the PIN (or Reset PIN in the recovery panel).
- Ctrl+L from anywhere in the app locks immediately (conventions section 3).
- Esc does not bypass the lock and does not discard data.

## Commands used (proposed)
- `auth_get_lock_state() -> { locked: bool, autolock_minutes: u16 }`
- `auth_unlock({ pin }) -> { ok: bool, attempts_remaining: u8 }`
- `auth_lock() -> {}`
- `auth_recover_with_code({ recovery_code, new_pin, confirm_pin }) -> { ok: bool }`

## Acceptance checks
- After setup, reopening the app shows the lock screen; the correct PIN unlocks
  in one entry (SUX-003); a wrong PIN is refused without restricting the app
  (SUX-005). (R1 demo step 2.)
- Idle for the configured timeout locks the app (SET-004).
- Forgot-PIN with the setup recovery code sets a new PIN and unlocks (SET-004).
- Unlock performs no network call (NFR-022 / SUX-004); verified with the network
  disabled.
- Locking mid-edit loses no data on next unlock (CASE-005 autosave).

## Open questions
- SET-004 does not define PIN length, allowed characters, or a lock-out / backoff
  policy after repeated wrong entries. Proposed default: 4-6 digit numeric PIN,
  no hard lock-out (SUX-005 forbids false lockouts), with a short increasing
  delay after 5 wrong tries. Confirm.
- Windows Hello / fingerprint unlock is a P1 idea (SUX-003) but has no MVP1
  requirement id; left out of this screen. Confirm it is MVP2.
