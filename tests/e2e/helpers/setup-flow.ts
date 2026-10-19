// Shared first-run setup / provision flow for the GATED launch model
// (AppShell.tsx completion route-guard, commit 216cfed; SET-001).
//
// ── The gate, and how the SET-001 fix changed the way specs reach the shell ──
// Two product changes shaped this helper:
//
//   (1) The first-run wizard's ONLY forward exit is Finish (onComplete), which
//       runs setup_complete + setup_start_trial and routes to /today. There is
//       no in-wizard "go to Backup" link.
//
//   (2) A completion route-guard (ShellRoute) wraps every shell route (/today,
//       /backup, any shell path): while setup is not completed it redirects
//       them to /setup. This correctly closed the earlier Backup-bypass (a
//       stray link reaching /backup before the licence/trial was activated).
//
// The SET-001 user-reported defect was that the guard read a FROZEN boot-time
// `completed` value: on a fresh install the app booted completed=false, the
// wizard's Finish navigated to /today, but the guard still saw the frozen
// completed=false and bounced /today straight back to /setup — so finishing the
// wizard did NOT land in the app, and the only way in was to close/reopen and
// PIN-unlock. The product fix (AppShell BootRouter) holds the guard's
// `completed` as LIVE state seeded from the boot decision; the wizard's
// onComplete flips it to true (markCompleted) BEFORE navigating to /today, so
// ShellRoute admits the shell in the SAME launch. Finishing the wizard now
// drops the doctor straight into Today, unlocked — exactly the real first-run
// experience.
//
// The consequence for E2E: completing the wizard on the current launch now
// reaches /today (and /backup) directly — no relaunch + PIN round-trip is
// needed to become usable. The separate "close, reopen, unlock with the PIN"
// path (SET-004) is still a real, distinct requirement and is exercised by the
// specs that own it (first-run.e2e.ts step 2, r1-demo step 2, boot-gate
// PHASE B) via an explicit relaunch; those are reopen-unlock proofs, not a
// workaround for the guard.
import { expect } from '@wdio/globals';

import { bootPage } from '../pages/boot.page.js';
import { lockPage } from '../pages/lock.page.js';
import { setupPage } from '../pages/setup.page.js';
import { shellPage } from '../pages/shell.page.js';
import { relaunchInto } from './launch.js';

/** Default PIN used by the shared provision flow when a spec has no opinion. */
export const DEFAULT_PIN = '4321';

/**
 * Complete the first-run wizard on the CURRENT launch (assumes the app has
 * already self-routed to #/setup on a fresh data dir, or the caller forced it
 * there). Walks doctor -> clinic -> PIN + recovery -> licence -> Finish, the
 * real backend path (setup_set_pin, setup_complete, setup_start_trial). Returns
 * the one-time recovery code the PIN step minted.
 *
 * After Finish the completion route-guard now admits the shell on THIS launch
 * (the live completion signal flips to true before the /today navigation), so
 * the app lands on Today, unlocked. Callers that need the shell/Backup can use
 * it immediately; no relaunch is required.
 */
export async function completeFirstRunWizard(pin = DEFAULT_PIN): Promise<string> {
  await expect(setupPage.wizard).toBeDisplayed();
  await setupPage.fillDoctorAndNext();
  await setupPage.fillClinicAndNext();
  const recoveryCode = await setupPage.setPinAndRevealRecovery(pin);
  await setupPage.ackRecoveryAndNext();
  await expect(setupPage.licenceDevTrial).toBeDisplayed();
  await setupPage.finishSetup();
  return recoveryCode;
}

/**
 * Relaunch the app against the named (now-provisioned) data dir and unlock it
 * with `pin`, landing on the completed + unlocked shell (Today). This is the
 * real SET-004 "close, reopen, unlock with the PIN" path: a fresh process over
 * a completed dir boots to #/lock (SET-004), which we assert before unlocking.
 *
 * `dirName` must be the SAME data dir the wizard was completed against (default
 * 'main', the spec's primary dir).
 */
export async function enterUnlockedApp(
  dirName = 'main',
  pin = DEFAULT_PIN,
): Promise<void> {
  await relaunchInto(dirName);

  // A fresh process over a provisioned dir self-routes to the lock screen
  // (completed === true on disk, but a fresh process starts locked). This also
  // proves the gate: the shell is NOT reachable without the PIN.
  const decided = await bootPage.waitForDecidedScreen();
  expect(decided).toBe('#/lock');
  await expect(lockPage.card).toBeDisplayed();

  await lockPage.attempt(pin);
  await shellPage.waitForShell();
}

/**
 * Full provision: complete the first-run wizard on the current fresh launch and
 * land on the completed + unlocked shell (Today) in the SAME launch — the real
 * first-run experience now that the completion guard uses a live signal
 * (SET-001 fix). This is the one-call flow every spec that needs the
 * shell/Backup right after setup should use.
 *
 * Returns the recovery code the wizard minted (specs that assert on it can use
 * it; others may ignore it). `dirName` is retained for signature compatibility
 * with callers; it is not needed because no relaunch happens here.
 */
export async function provisionAndEnterApp(
  _dirName = 'main',
  pin = DEFAULT_PIN,
): Promise<string> {
  const recoveryCode = await completeFirstRunWizard(pin);
  // The SET-001 fix drops the wizard straight into Today, unlocked, on this
  // same launch — assert we are actually in the shell before returning.
  await shellPage.waitForShell();
  return recoveryCode;
}
