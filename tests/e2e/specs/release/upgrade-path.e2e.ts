// @req NFR-011 NFR-042 BILL-001 SET-003 VIS-004 VIS-005
// @tier regression
// @area release
// @targets linux, windows
//
// HC-MVP1-226 — the upgrade-path harness (NFR-011 "the previous release's data
// always opens after an upgrade install"; NFR-042; R-DEL-004). From R1 onward
// every release must open the previous release's data after an upgrade install.
// This harness carries EVERY release hop; it currently runs FOUR:
//   • R0 -> R1 (PHASE A/B): install R1 over the empty/baseline dir an R0 install
//     leaves, prove R1 opens it, migrations 0001..0002 run forward, and an
//     R1-made backup opens.
//   • R1 -> R2 (PHASE C/D): install the R2 build over a GENUINE R1 install (the
//     R1 build provisions clinic.db @ user_version 3 + an R1-made .hcbak), prove
//     the R2 build opens it, migrations 0004..0007 advance 3 -> 7, the R1 PIN
//     unlocks it, the R1 profile/setup persists, and the R1-made .hcbak opens.
//   • R2 -> R3 (PHASE E/F): install the R3 build over a GENUINE R2 install (the
//     R2 build provisions clinic.db @ user_version 7, 200 fixture patients plus
//     one registered through the R2 UI with a photo, and an R2-made .hcbak),
//     prove the R3 build opens it, migrations 0008..0011 advance 7 -> 11 (the
//     R3 case/visit schema serves), the R2 PIN unlocks it, EVERY R2 patient is
//     present (full id/code/name set equality + search), the R2 setup/licence
//     persists, and the R2-made .hcbak opens.
//   • R3 -> R5 (PHASE G/H): install the R5 build over a GENUINE R3 install (the
//     R3-close build provisions clinic.db @ user_version 11 with clinic fees,
//     two patients with cases (vitals / generals / family tables, a follow-up
//     entry with its own vitals) and next follow-ups due today / tomorrow, 200
//     fixture patients, and an R3-made .hcbak), prove the R5 build unlocks it
//     with the R3 PIN and migrates 11 -> 12 (user_version recorded before and
//     after), every R3 patient, case, visit and next follow-up is intact, Today
//     due/overdue are unchanged, Settings shows the R3 fees, an R3 visit can be
//     billed, and the R3-made .hcbak still opens (verify + preview counts).
//     R4 (M7) is not on this line: the branch goes R3 close (bbe9bd2) ->
//     R3 leftovers -> Settings -> R5 billing, so the hop is R3 -> R5.
// Each future release adds one more hop here (R5 -> R6, …) with the same shape.
//
// ── Building the previous-release binaries (executor / local run) ───────────
// The hops launch the PREVIOUS release's own debug build from a git worktree
// next to the repo ($HC_ROOT/hc-r1-worktree, $HC_ROOT/hc-r2-worktree,
// $HC_ROOT/hc-r3-worktree).
//   R1 (staging-main 95e823c, plain --debug; or set HC_R1_APP_BINARY, which
//   the executor sets — the R1 fallback below is cwd-relative):
//     git worktree add --detach ../hc-r1-worktree 95e823c
//     cd ../hc-r1-worktree/apps/desktop && npm ci &&
//       npm run tauri build -- --debug --no-bundle
//   R2 (R2-final staging-main 5b180b9, WITH e2e-test-keys so the R2 build has
//   patient_import_fixture for seeding; or set HC_R2_APP_BINARY):
//     git worktree add --detach ../hc-r2-worktree 5b180b9
//     cd ../hc-r2-worktree/apps/desktop && npm ci &&
//       npm run tauri build -- --debug --features e2e-test-keys --no-bundle
//     -> ../hc-r2-worktree/target/debug/homeoclinic-desktop (resolved from the
//        repo root, so it is found from any cwd)
//   CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 keep a worktree target small
//   and do not change behaviour. The R2 hop also needs hc-seed (cargo build -p
//   hc-seed --bin hc-seed, or HC_SEED_BIN); tools/seed is unchanged between R2
//   and R3, so the current hc-seed JSONL is what the R2 import reads.
//   R3 (R3 close, staging-main merge bbe9bd2, WITH e2e-test-keys so the R3
//   build has patient_import_fixture; or set HC_R3_APP_BINARY):
//     git worktree add --detach ../hc-r3-worktree bbe9bd2
//     cd ../hc-r3-worktree/apps/desktop && npm ci &&
//       CARGO_PROFILE_DEV_DEBUG=0 CARGO_INCREMENTAL=0 \
//       npm run tauri build -- --debug --features e2e-test-keys --no-bundle
//     -> ../hc-r3-worktree/target/debug/homeoclinic-desktop[.exe] (resolved
//        from the repo root). The R3 fixture import uses the same current
//        hc-seed JSONL as the R2 hop.
//   On Windows every previous-release binary carries the .exe suffix.
// A hop whose previous-release binary is absent SKIPS (infra, logged with the
// path and how to build it), so CI, which builds only the current release,
// still runs every other phase.
//
// ── What "R0 data" is, precisely (honest seeding) ───────────────────────────
// R0 (milestone M0, HC-MVP1-214) shipped ONLY the Tauri shell + an empty Today
// + a lock STUB. Per docs/milestones/R0-brief.md it made ZERO encrypted-DB
// writes — storage (the SQLCipher pool, key hierarchy and migrations) is M1.
// So the real on-disk state an R0 install leaves is an EMPTY/BASELINE data dir:
// an app-data directory with NO clinic.db, NO key hierarchy, nothing migrated
// (effective schema user_version 0 — there is no DB file at all).
//
// Therefore the "R0-equivalent fixture" this harness seeds is exactly that: a
// FRESH, EMPTY XDG_DATA_HOME (the executor hands a brand-new temp dir). That is
// a faithful R0 end-state, not a contrivance — an R0 binary run against a fresh
// user profile would leave the same empty data dir (it never opens a DB). The
// fixture is documented in tests/e2e/fixtures/r0-baseline/README.md.
//
// ── What the harness proves (the R1 "upgrade install over R0") ──────────────
// Launching the R1 build with XDG_DATA_HOME pointing at that empty R0-baseline
// dir IS the upgrade install: the R1 boot-gate reads the empty dir, finds no
// key hierarchy (setup_get_state.completed=false) and self-routes to #/setup.
// Completing the real first-run wizard runs setup_set_pin, which OPENS the
// encrypted DB over the R0 data dir and runs the forward-only migration set
// (0001_init then 0002_setup), advancing PRAGMA user_version 0 → 2
// (= migrate::latest_version()). The harness then proves, through the real
// typed commands the webview owns:
//   • the R1 app OPENS over the R0-baseline dir (boots, reaches Today unlocked);
//   • migrations ran forward and the schema is live — get_backup_status serves
//     the retention, which can only succeed if the 0001/0002 tables exist and
//     the DB opened at the latest schema;
//   • a clinic.db now exists in the R0-baseline dir (runner-side fs check), i.e.
//     the upgrade materialised the migrated DB in place;
//   • an R1-MADE backup opens — backup_now writes a .hcbak, verify_backup
//     passes (checksum + decrypt), and restore_preview reads a valid header
//     whose app_version equals the running R1 build (app_info().version). This
//     is the "existing data + any backups still open" clause of NFR-011.
//
// ── Honesty caveat (what the webview cannot directly assert) ─────────────────
// No typed command exposes PRAGMA user_version to the webview in M1, so the
// EXACT 0 → 2 advance is asserted at the Rust layer by
// crates/hc-storage/tests/migrate_test.rs::
//   nfr011_migrate_from_empty_creates_schema_at_latest (user_version == latest)
//   nfr011_migrate_from_previous_version_is_forward_only
//   nfr011_migrate_backs_up_before_applying_to_nonempty_db (pre-migration backup)
// Here the webview-observable proof is the equivalent end state: the app opens
// over the R0 dir, the migrated schema serves, and R1 backups open. This mirrors
// the restore-clean-install spec, which defers exact profile-value equality to
// a Rust integration test for the same reason. The report states this plainly.
//
// Execution model: ONE launch, ONE data dir. Unlike r1-demo step 3, the whole
// upgrade flow targets the SAME dir (the R0-baseline dir, provisioned/migrated
// in place), so both phases run in a single tauri-driver session. Network
// disabled (product rule 1).
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { browser, expect } from '@wdio/globals';

import { backupPage } from '../../pages/backup.page.js';
import { billingPage, invoiceHash } from '../../pages/billing.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { lockPage } from '../../pages/lock.page.js';
import { nextFollowupPage as nf } from '../../pages/next-followup.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { searchPage, type PatientRow } from '../../pages/search.page.js';
import { settingsPage } from '../../pages/settings.page.js';
import { type ClinicFees } from '../../pages/setup.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { todayPage } from '../../pages/today.page.js';
import { completeFirstRunWizard, provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';
import { seedFixtureIntoApp } from '../../helpers/fixture.js';
import { isoPlusDays, todayIso } from '../../helpers/dates.js';
import {
  dataDir,
  relaunchInto,
  relaunchIntoWithBinary,
  sharedBackupDir,
} from '../../helpers/launch.js';

const PIN = '4321';
const BACKUP_PASSWORD = 'upgrade-backup-1';

/** Executable suffix of the debug app binaries on this host. */
const EXE = process.platform === 'win32' ? '.exe' : '';

/** Shared /tmp backup folder the executor sets for the backup-opens check. */
const BACKUP_DIR = process.env.HC_E2E_BACKUP_DIR;

// ── R1 -> R2 hop configuration ───────────────────────────────────────────────
// The PREVIOUS-release (R1) build the harness installs the data dir with before
// launching the current (R2) build over it. The executor builds the R1 app from
// the R1 source tree (staging-main worktree, plain `--debug`) and points
// HC_R1_APP_BINARY at it; if unset the harness falls back to the conventional
// worktree target path so a local run still resolves it.
const R1_APP_BINARY =
  process.env.HC_R1_APP_BINARY ??
  path.resolve(
    process.cwd(),
    `../hc-r1-worktree/target/debug/homeoclinic-desktop${EXE}`,
  );

/** R1-install PIN: set under the R1 build, re-entered under the R2 build. */
const R1_PIN = '2468';
/** Password of the R1-MADE .hcbak that the R2 build must still open. */
const R1_BACKUP_PASSWORD = 'r1-made-backup-9';
/** Named data dir that carries the R1 install forward into the R2 launch. */
const R1_OVER_DIR = 'r1-install';

// ── R2 -> R3 hop configuration ───────────────────────────────────────────────
// The R2-final build (staging-main 5b180b9) built WITH e2e-test-keys in the
// worktree $HC_ROOT/hc-r2-worktree (see the header). Resolved from the repo
// root (not the cwd) so it is found whether wdio runs from the repo root or
// from tests/e2e; HC_R2_APP_BINARY overrides it.
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const R2_APP_BINARY =
  process.env.HC_R2_APP_BINARY ??
  path.resolve(REPO_ROOT, `../hc-r2-worktree/target/debug/homeoclinic-desktop${EXE}`);

/** R2-install PIN: set under the R2 build, re-entered under the R3 build. */
const R2_PIN = '1593';
/** Password of the R2-MADE .hcbak that the R3 build must still open. */
const R2_BACKUP_PASSWORD = 'r2-made-backup-7';
/** Named data dir that carries the R2 install forward into the R3 launch. */
const R2_OVER_DIR = 'r2-install';
/** Fixture size the R2 build imports (hc-seed's fixture minimum is 200). */
const R2_FIXTURE_COUNT = 200;
/** The one patient registered through the R2 UI, with a photo. */
const R2_UI_PATIENT = 'Upgradia Photopatient';

// ── R3 -> R5 hop configuration ───────────────────────────────────────────────
// The R3-close build (staging-main merge bbe9bd2) built WITH e2e-test-keys in
// the worktree $HC_ROOT/hc-r3-worktree (see the header). Resolved from the
// repo root; HC_R3_APP_BINARY overrides it.
const R3_WORKTREE = path.resolve(REPO_ROOT, '../hc-r3-worktree');
const R3_APP_BINARY =
  process.env.HC_R3_APP_BINARY ?? path.join(R3_WORKTREE, `target/debug/homeoclinic-desktop${EXE}`);
/** R3-install PIN: set under the R3 build, re-entered under the R5 build. */
const R3_PIN = '8642';
/** Password of the R3-MADE .hcbak that the R5 build must still open. */
const R3_BACKUP_PASSWORD = 'r3-made-backup-5';
/** Named data dir that carries the R3 install forward into the R5 launch. */
const R3_OVER_DIR = 'r3-install';
/** Fixture size the R3 build imports (hc-seed's fixture minimum is 200). */
const R3_FIXTURE_COUNT = 200;
/**
 * Clinic fees typed into the R3 wizard. Deliberately NOT the 500/300 every
 * other spec uses, and with paise, so Settings and the R5 invoice can only
 * show them if they really came from the R3 profile.
 */
const R3_FEES: ClinicFees = { first: '450', followup: '275.50' };
/** The R3 clinic name the shared wizard flow types (setup.page.ts). */
const R3_CLINIC_NAME = 'Rao Homoeo Clinic';
/** Patient A: detailed first case with tables + a follow-up, next F/U today. */
const R3_CASE_PATIENT = 'Rohini Upgradecase';
/** Patient B: a short first case, next F/U tomorrow. */
const R3_FU_PATIENT = 'Kunal Upgradefollow';
const R3_COMPLAINT = 'Sinusitis';
const R3_CASE_TEXT = 'Frontal sinus pressure for 2 years, worse stooping and in cold air.';
const R3_V = { sys: '132', dia: '86', pulse: '74', weight: '58', height: '158' };
const R3_GENERALS = { appetite: 'Good', thirst: 'Thirsty for cold water', thermal: 'Hot', constitution: 'Stout' };
const R3_FAMILY_MATERNAL = 'Asthma (mother)';
const R3_FAMILY_PATERNAL = 'Gout (father)';
const R3_FU_V = { sys: '124', dia: '80', pulse: '72' };
const R3_FU_TEXT = 'Follow-up: pressure much less, sleeping well.';
const R3_B_COMPLAINT = 'Eczema';
const R3_B_TEXT = 'Dry itchy patches on both hands, worse washing.';
/** Vitals seed column order (schema §4a): BP sys, BP dia, Pulse, … */
const COL_SYS = 0;
const COL_DIA = 1;
const COL_PULSE = 2;
/**
 * R3-close schema (0001..0011_case_template_journal). Read from the R3
 * worktree's own migrations dir when present; this is the fallback.
 */
const R3_SCHEMA_FALLBACK = 11;

/**
 * The case visit as case_visit_open_or_create returns it (typed IPC).
 *
 * SIDE EFFECT RULE (build-6 round-1): case_visit_open_or_create (and the case
 * route, which calls it) REUSES only the patient's LATEST visit when it is from
 * today and of the requested type; otherwise it CREATES a new visit (VIS-001,
 * same code at R3 bbe9bd2 and R5). So visitSnap() is only ever called for a
 * visit that is its patient's latest (A's first visit right after it is saved,
 * before the follow-up exists; A's follow-up; B's first). A's first visit is
 * re-read afterwards only through create-free reads: case_summary_render (the
 * read-only CASE-009 render of a visit by id; render code identical at R3 and
 * R5) and patient_get_dashboard's visit timeline.
 */
interface VisitSnap {
  visitId: string;
  templateId: string;
  dataJson: string;
  vitalsJson: string;
  visitAt: string;
  nextFollowupOn: string | null;
}

/** One dashboard visit-timeline row as patient_get_dashboard returns it. */
interface DashVisit {
  visitId: string;
  visitAt: string;
  kind: string;
}

/** Which of the hop's two patients Today lists, by section and day. */
interface TodayView {
  /** UI: Today at the real date. */
  ui: { due: string[]; overdue: string[] };
  /** UI: Today with the webview test clock one day on. */
  uiTomorrow: { due: string[]; overdue: string[] };
  /** Typed today_get_overview at today / tomorrow (patient ids, sorted). */
  typed: { due: string[]; overdue: string[] };
  typedTomorrow: { due: string[]; overdue: string[] };
}

/** What PHASE G recorded under the R3 build, checked under R5 in PHASE H. */
interface R3Snapshot {
  dataDir: string;
  appVersion: string;
  patients: PatientRow[];
  a: { patientId: string; firstVisitId: string; followupVisitId: string };
  b: { patientId: string; firstVisitId: string };
  visits: { aFirst: VisitSnap; aFollowup: VisitSnap; bFirst: VisitSnap };
  /** case_summary_render HTML per visit (create-free read by visit id). */
  summaries: { aFirst: string; aFollowup: string; bFirst: string };
  /** patient_get_dashboard visit timelines (ids, instants, kinds). */
  dashVisits: { a: DashVisit[]; b: DashVisit[] };
  dashRows: { a: { date: string; type: string }[]; b: { date: string; type: string }[] };
  today: TodayView;
  licence: { kind: string; validUntil: string; expired: boolean };
  backupPath: string;
  preview: { patientCount: number; visitCount: number; lastVisitDate: string | null };
  /** PRAGMA user_version of the R3 DB, from the R3 .hcbak header. */
  schemaBefore: number;
}
let r3: R3Snapshot | undefined;
/** Built up across PHASE G's steps, frozen into `r3` by the last step. */
const g: {
  dataDir?: string;
  appVersion?: string;
  a?: { patientId: string; firstVisitId: string; followupVisitId: string };
  b?: { patientId: string; firstVisitId: string };
  /** A's first visit, read while it was A's latest visit (see VisitSnap). */
  aFirst?: VisitSnap;
  imported?: number;
} = {};

/**
 * Read the plaintext header of a .hcbak on the runner (no password, no key).
 * Layout (crates/hc-storage/src/backup/mod.rs): MAGIC "HCBAK\0\x01\0" (8) |
 * HEADER_LEN u32 LE | HEADER_JSON (serde_json of BackupHeader). The header
 * carries `schema_version` = the DB snapshot's PRAGMA user_version, which no
 * typed command exposes to the webview.
 */
function readHcbakHeader(file: string): { schemaVersion: number; appVersion: string; formatVersion: number } {
  const bytes = readFileSync(file);
  const magic = Buffer.from('HCBAK\u0000\u0001\u0000', 'latin1');
  if (bytes.length < 12 || !bytes.subarray(0, 8).equals(magic)) {
    throw new Error(`${file} is not a .hcbak (bad magic)`);
  }
  const len = bytes.readUInt32LE(8);
  const json = JSON.parse(bytes.subarray(12, 12 + len).toString('utf8')) as Record<string, unknown>;
  const num = (k: string): number => {
    const v = json[k];
    if (typeof v !== 'number') throw new Error(`${file}: header has no numeric ${k} (${JSON.stringify(json)})`);
    return v;
  };
  return {
    schemaVersion: num('schema_version'),
    appVersion: String(json.app_version ?? ''),
    formatVersion: num('format_version'),
  };
}

/** Highest NNNN_ migration number in a source tree's hc-storage migrations dir. */
function latestMigration(repo: string): number | null {
  const dir = path.join(repo, 'crates/hc-storage/src/migrations');
  if (!existsSync(dir)) return null;
  const nums = readdirSync(dir)
    .map((f) => /^(\d{4})_.*\.sql$/.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(Number);
  return nums.length === 0 ? null : Math.max(...nums);
}

/** The automatic pre-migration copies (migrate.rs backup_path_for) in a data dir. */
function preMigrationCopies(dir: string): string[] {
  return readdirSync(dir).filter((f) => f.startsWith('clinic.db.pre-migration.v')).sort();
}

/** FY label of a local date, as hc-domain billing::FinancialYear ("2026-27"). */
function fyLabel(iso: string): string {
  const [y, m] = iso.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** ISO YYYY-MM-DD -> the case header's DD-MM-YYYY. */
function dash(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
}

/** All cell text of every editor table of `type`, joined (order-free checks). */
async function tableText(type: string): Promise<string> {
  const ts = (await caseRichPage.tables()).filter((t) => t.tableType === type);
  return ts.map((t) => t.rows.map((r) => r.join(' | ')).join('\n')).join('\n');
}

/** case_visit_open_or_create for a visit type the patient ALREADY has. */
async function visitSnap(patientId: string, visitType: 'first' | 'follow_up'): Promise<VisitSnap> {
  const v = await backupPage.invokeCommand<VisitSnap>('case_visit_open_or_create', {
    req: { patientId, visitType },
  });
  return {
    visitId: v.visitId,
    templateId: v.templateId,
    dataJson: v.dataJson,
    vitalsJson: v.vitalsJson,
    visitAt: v.visitAt,
    nextFollowupOn: v.nextFollowupOn ?? null,
  };
}

/** Read-only render of one visit by id (case_summary_render, CASE-009): no visit is created. */
async function visitSummaryHtml(visitId: string): Promise<string> {
  const r = await backupPage.invokeCommand<{ html: string }>('case_summary_render', { req: { visitId } });
  return r.html;
}

/** The patient's dashboard visit timeline (patient_get_dashboard, read-only). */
async function dashVisits(patientId: string): Promise<DashVisit[]> {
  const d = await backupPage.invokeCommand<{ visits: DashVisit[] }>('patient_get_dashboard', { req: { patientId } });
  return d.visits.map((v) => ({ visitId: v.visitId, visitAt: v.visitAt, kind: v.kind }));
}

/**
 * A's first case as the read-only summary renders it (from the visit's stored
 * data_json): complaint, case text, the vitals / physical generals / family
 * history table values. `who` names the build for the failure message.
 */
function expectFirstCaseSummary(html: string, who: string): void {
  const text = html.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');
  const want = [
    R3_COMPLAINT,
    R3_CASE_TEXT,
    R3_V.sys,
    R3_V.dia,
    R3_V.pulse,
    ...Object.values(R3_GENERALS),
    'Asthma',
    'Gout',
  ];
  const missing = want.filter((w) => !text.includes(w));
  if (missing.length > 0) {
    throw new Error(`${who}: case_summary_render of patient A's first visit lacks ${JSON.stringify(missing)}`);
  }
}

/** Set the open case's next follow-up to `iso` (commit-on-blur) and Save. */
async function setNextFollowupAndSave(iso: string, what: string): Promise<void> {
  await nf.focusCustom();
  await nf.setCustom(iso);
  await nf.blurCustomByClickingHeader();
  await nf.waitDisplay(`Next F/U: ${dash(iso)}`, what);
  await caseRichPage.save();
  expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
}

/**
 * Today for the hop's two patients: the UI at the real date and with the
 * webview test clock one day on (pages/next-followup.page.ts shiftClockDays,
 * as r3-demo does; no past date is ever written), plus the typed
 * today_get_overview at today and tomorrow. Only the two hop patients are
 * kept (the fixture patients have no visits).
 */
async function todayView(names: string[], ids: string[]): Promise<TodayView> {
  const keep = (texts: string[]): string[] => names.filter((n) => texts.some((t) => t.includes(n)));
  const typed = async (day: string): Promise<{ due: string[]; overdue: string[] }> => {
    const o = await backupPage.invokeCommand<{
      dueToday: { patientId: string }[];
      overdue: { patientId: string }[];
    }>('today_get_overview', { req: { today: day } });
    const pick = (rows: { patientId: string }[]): string[] =>
      rows.map((r) => r.patientId).filter((id) => ids.includes(id)).sort();
    return { due: pick(o.dueToday), overdue: pick(o.overdue) };
  };

  await todayPage.open();
  await todayPage.waitForDue();
  const ui = { due: keep(await todayPage.dueTexts()), overdue: keep(await todayPage.overdueTexts()) };

  // Leave Today before moving the clock so it re-renders on the shifted date.
  await patientsPage.openDashboard(ids[0] as string);
  const shifted = await nf.shiftClockDays(1);
  expect(shifted).toBe(isoPlusDays(1));
  let uiTomorrow: { due: string[]; overdue: string[] };
  try {
    await todayPage.open();
    await todayPage.waitForOverdue();
    await todayPage.waitForDue();
    uiTomorrow = { due: keep(await todayPage.dueTexts()), overdue: keep(await todayPage.overdueTexts()) };
  } finally {
    await nf.restoreClock();
  }
  return {
    ui,
    uiTomorrow,
    typed: await typed(todayIso()),
    typedTomorrow: await typed(isoPlusDays(1)),
  };
}

/** The Today a correct build shows for the hop: A due today, B due tomorrow. */
function expectHopToday(t: TodayView, aId: string, bId: string): void {
  expect(t.ui).toEqual({ due: [R3_CASE_PATIENT], overdue: [] });
  expect(t.uiTomorrow).toEqual({ due: [R3_FU_PATIENT], overdue: [R3_CASE_PATIENT] });
  expect(t.typed).toEqual({ due: [aId], overdue: [] });
  expect(t.typedTomorrow).toEqual({ due: [bId], overdue: [aId] });
}

/** What PHASE E recorded under the R2 build, checked under R3 in PHASE F. */
interface R2Snapshot {
  dataDir: string;
  patients: PatientRow[];
  uiPatient: PatientRow;
  licence: { kind: string; validUntil: string; expired: boolean };
  appVersion: string;
  backupPath: string;
}
let r2: R2Snapshot | undefined;

/** A tiny valid 1x1 PNG on disk for the R2 photo attach (as register-photo). */
function tinyPngPath(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hc-e2e-upgrade-photo-'));
  const file = path.join(dir, 'patient.png');
  writeFileSync(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    ),
  );
  return file;
}

/**
 * Call a typed command that reads a table of the CURRENT release's schema and
 * return null when it serves, else its error text. Lets a hop report exactly
 * which post-upgrade schema read fails (an unmigrated DB) instead of a bare
 * WebDriver error.
 */
async function schemaError(cmd: string, args: Record<string, unknown> = {}): Promise<string | null> {
  let last = '';
  // WebKitWebDriver can fail an in-flight async script with a bare
  // WebDriverError when the page throws meanwhile (e.g. the Today screen's own
  // failing load); one retry then reads the command's real result/error.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await backupPage.invokeCommand(cmd, args);
      return null;
    } catch (e) {
      last = e instanceof Error ? e.message : String(e);
      if (!last.includes('WebDriverError')) return last;
    }
  }
  return last;
}

/** Rows sorted by patient id (stable comparison of two snapshots). */
function byId(rows: PatientRow[]): PatientRow[] {
  return [...rows].sort((a, b) => a.patientId.localeCompare(b.patientId));
}

describe('HC-MVP1-226 upgrade-path PHASE A: R1 opens an R0-equivalent (empty/baseline) data dir and migrates forward (NFR-011)', () => {
  it('self-routes the empty R0-baseline dir to the wizard, then provisions in place so R1 opens over the R0 data dir and the migrated schema serves', async () => {
    // The R0-baseline dir is EMPTY (no clinic.db, no key hierarchy) — the exact
    // state an R0 install leaves. The R1 boot-gate therefore finds no completed
    // setup and self-routes to #/setup. (bootPage only OBSERVES the hash.)
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] self-chosen launch hash over R0-baseline = ${hash}`);
    expect(decided).toBe('#/setup');
    expect(hash).toBe('#/setup');

    // Confirm the R0-equivalent precondition through the real typed command:
    // an R0 data dir has no key hierarchy, so setup is NOT completed.
    const r0State = await backupPage.setupState();
    expect(r0State.completed).toBe(false);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] R0-baseline setup.completed = ${r0State.completed}`);

    // The "upgrade install" step: complete the real first-run wizard. This runs
    // setup_set_pin, which opens the encrypted DB over the R0 data dir and runs
    // migrations 0001_init + 0002_setup (user_version 0 → 2 at the Rust layer).
    //
    // Under the SET-001 fix (AppShell BootRouter live completion signal)
    // finishing the wizard flips completion before navigating to /today, so the
    // completion route-guard (commit 216cfed) admits the shell on THIS launch:
    // the migrated + unlocked shell (Today) is reached in place, no relaunch.
    // The migrated clinic.db is written into the R0-baseline dir, proving "R1
    // opens over the R0 data dir and the migrated schema serves".
    await provisionAndEnterApp('main', PIN);
    await expect(shellPage.todayScreen).toBeDisplayed();

    // R1 opened over the R0 dir: setup is now completed and the migrated schema
    // is live — get_backup_status can only serve if the 0001/0002 tables exist
    // and the DB opened at the latest schema (migrations ran forward).
    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    const status = await backupPage.getStatus();
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });

    // The migrated DB was materialised IN the R0-baseline data dir (runner-side
    // fs proof that the upgrade wrote the DB over the previous-release dir).
    const dataDir = upgraded.dataDir;
    expect(existsSync(dataDir)).toBe(true);
    const dbExists = existsSync(`${dataDir}/clinic.db`);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][A] migrated clinic.db present in R0 dir (${dataDir}) = ${dbExists}`);
    expect(dbExists).toBe(true);
  });
});

describe('HC-MVP1-226 upgrade-path PHASE B: an R1-made backup over the upgraded data opens (NFR-011 "backups still open")', () => {
  it('backs up the upgraded data and proves the archive opens: verify_backup passes and restore_preview reads a valid header stamped with the running R1 build', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // Same launch/data dir as PHASE A (the upgraded install). Write an R1
    // backup of the migrated data to the shared folder.
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(BACKUP_DIR as string, BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.filePath).toContain('.hcbak');
    expect(existsSync(res.filePath)).toBe(true);

    const archives = readdirSync(BACKUP_DIR as string).filter((f) =>
      f.endsWith('.hcbak'),
    );
    expect(archives.length).toBeGreaterThanOrEqual(1);

    // The backup OPENS (NFR-011): verify_backup re-hashes the body and
    // decrypt-tests the first chunk under the password.
    const verified = await backupPage.invokeCommand<{
      ok: boolean;
      checksumOk: boolean;
      decryptOk: boolean;
    }>('verify_backup', { filePath: res.filePath, password: BACKUP_PASSWORD });
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);

    // The archive's plaintext header reads back and is stamped with the running
    // R1 build's app version — i.e. the previous-release data, migrated by R1,
    // was backed up by THIS R1 build and the backup opens.
    const preview = await backupPage.restorePreview(res.filePath, BACKUP_PASSWORD);
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);
    const info = await backupPage.invokeCommand<{ name: string; version: string }>(
      'app_info',
    );
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][B] backup app_version=${preview.appVersion} running R1 version=${info.version}`,
    );
    expect(preview.appVersion).toBe(info.version);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R1 -> R2 HOP (HC-MVP1-226, NFR-011, R-DEL-004). From R1 onward every release
// must open the PREVIOUS release's REAL data after an upgrade install. Unlike
// the R0 hop above (R0 leaves an empty dir), R1 leaves a REAL provisioned data
// dir: an encrypted clinic.db at the R1 schema (user_version 3 — migrations
// 0001_init, 0002_setup, 0003_licence_state), a PIN-derived key hierarchy, the
// doctor + clinic profile rows, and R1-made .hcbak backups.
//
// ── How the R1-state is seeded (honest, genuine previous-release data) ───────
// The harness does a TRUE "install R1, then install R2 over it":
//   PHASE C launches the ACTUAL R1 BUILD (HC_R1_APP_BINARY — the R1 source tree
//     built as a debug app) over a fresh data dir and runs the real first-run
//     wizard (setup_set_pin -> opens the encrypted DB and applies R1 migrations
//     0001..0003, user_version 0 -> 3; setup_start_trial; setup_complete),
//     landing on Today unlocked. It then writes a REAL R1 .hcbak through the R1
//     build's own backup_now. After PHASE C the `r1-install` dir holds a
//     genuine R1 install: clinic.db @ user_version 3 + an R1-made .hcbak. This
//     is not a hand-rolled fixture — it is produced by running R1 itself, so
//     the "R1-state" is exactly what a real R1 install leaves on disk.
//   PHASE D relaunches the R2 BUILD UNDER TEST (the default target binary) over
//     that SAME `r1-install` dir — the upgrade install. It asserts the R2 build
//     opens the R1 dir, migrations advance FORWARD 3 -> 7 (0004_patient_search,
//     0005_patient_diagnosis, 0006_patient_registration, 0007_patient_recent),
//     the app unlocks with the R1 PIN, the R1 profile/setup persists, and the
//     R1-made .hcbak still opens under R2.
//   NOTE (HC-MVP1-226, R3): "the build under test" is whatever the default
//     binary is — on the R3 branch PHASE D therefore installs R3 over R1. It
//     now also proves the CURRENT build really runs and migrated the R1 DB
//     (patient_search, absent in R1, reads the 0004 schema). Before R3 a bare
//     reloadSession() silently relaunched the R1 binary here (cached
//     capabilities), so PHASE D did not actually exercise the newer build; see
//     helpers/launch.ts relaunchInto.
//
// ── What the R2 build can assert through the webview (and the honest caveat) ──
// As in the R0 hop, no typed command exposes PRAGMA user_version or the raw
// profile rows to the webview in M1/M2. The exact 3 -> 7 advance and exact
// doctor/clinic value equality are asserted at the Rust layer
// (crates/hc-storage/tests/migrate_test.rs forward-only + from-previous-version
// tests; the backup round-trip profile test). Here the webview-observable proof
// of the forward migration is the equivalent END STATE under the R2 build:
//   • boot-gate self-routes the completed R1 dir to #/lock, and the R1 PIN
//     unlocks it (the R1 key hierarchy + completed setup survived the upgrade);
//   • get_backup_status serves — it reads retention through the OPEN migrated
//     pool, which can only succeed if the DB opened at the R2 latest schema
//     (migrations ran forward; a schema-too-new/!migrated DB would error);
//   • the R1-made .hcbak still opens under R2 (verify_backup + restore_preview),
//     i.e. "existing data AND any backups still open" (NFR-011) across the hop.
// The report states this caveat plainly, mirroring PHASE A/B and
// restore-clean-install.e2e.ts.
//
// SKIP-not-fail: if HC_R1_APP_BINARY is absent the R1 build was not provided, so
// the hop cannot run honestly. It is reported as an infra skip (not a silent
// pass and not a product failure) — the executor must supply the R1 build.
const r1BuildPresent = existsSync(R1_APP_BINARY);

describe('HC-MVP1-226 upgrade-path PHASE C: provision a GENUINE R1 install (the R1 build writes clinic.db @ user_version 3 + an R1-made .hcbak)', () => {
  before(function () {
    if (!r1BuildPresent) {
      // eslint-disable-next-line no-console
      console.log(
        `[upgrade][C] SKIP (infra): R1 build not found at ${R1_APP_BINARY}. ` +
          `Set HC_R1_APP_BINARY to the R1 (staging-main) debug app to run the ` +
          `R1->R2 hop.`,
      );
      this.skip();
    }
  });

  it('runs the REAL R1 first-run wizard under the R1 build, then writes an R1-made .hcbak, leaving a genuine previous-release data dir', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // Launch the ACTUAL R1 BUILD over a fresh `r1-install` dir (upgrade from a
    // clean R1 install). The R1 boot-gate self-routes a fresh dir to #/setup.
    await relaunchIntoWithBinary(R1_OVER_DIR, R1_APP_BINARY);
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][C] R1 build self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/setup');

    // Real first-run wizard under R1 — setup_set_pin opens the DB and applies
    // the R1 migrations 0001..0003 (user_version 0 -> 3), setup_start_trial +
    // setup_complete finish it. Lands on Today unlocked (SET-001 fix). This is
    // the genuine R1 install state the R2 build will upgrade.
    await provisionAndEnterApp(R1_OVER_DIR, R1_PIN);
    await expect(shellPage.todayScreen).toBeDisplayed();

    const r1State = await backupPage.setupState();
    expect(r1State.completed).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][C] R1 install provisioned; setup.completed=${r1State.completed} dataDir=${r1State.dataDir}`,
    );

    // The R1 build wrote a real encrypted clinic.db into the resolved app data
    // dir (XDG_DATA_HOME/<identifier>, reported by setup_get_state).
    expect(existsSync(`${r1State.dataDir}/clinic.db`)).toBe(true);

    // Write a REAL R1-made .hcbak through the R1 build's own backup_now, into a
    // dedicated subfolder so PHASE D can unambiguously pick the R1 archive (the
    // shared backup dir also holds the PHASE-B R1-over-R0 archive).
    const r1BackupDir = path.join(sharedBackupDir(), 'r1-made');
    mkdirSync(r1BackupDir, { recursive: true });
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(r1BackupDir, R1_BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(res.filePath).toContain('.hcbak');
    expect(existsSync(res.filePath)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`[upgrade][C] R1-made .hcbak written at ${res.filePath}`);
  });
});

describe('HC-MVP1-226 upgrade-path PHASE D: the R2 build opens the R1 data dir, migrates 3->7 forward, unlocks with the R1 PIN, and the R1-made .hcbak still opens (NFR-011, R-DEL-004)', () => {
  before(function () {
    if (!r1BuildPresent) {
      this.skip();
    }
  });

  it('relaunches the R2 build over the SAME R1 data dir (upgrade install): boot-gate -> lock -> unlock with the R1 PIN, the R1 profile/setup persists, the migrated schema serves, and the R1-made backup opens under R2', async () => {
    expect(BACKUP_DIR).toBeDefined();

    // THE UPGRADE INSTALL: relaunch the R2 build under test (the default target
    // binary — relaunchInto uses the config's application) over the SAME
    // `r1-install` dir PHASE C provisioned under R1. A fresh process over a
    // completed-on-disk dir self-routes to #/lock (SET-004); opening the DB
    // runs the forward-only migrations 0004..0007 (user_version 3 -> 7) before
    // the shell is usable.
    await relaunchInto(R1_OVER_DIR);
    const decided = await bootPage.waitForDecidedScreen();
    const hash = await bootPage.launchHash();
    // eslint-disable-next-line no-console
    console.log(`[upgrade][D] R2 build over R1 dir self-chosen launch hash = ${hash}`);
    expect(decided).toBe('#/lock');
    expect(hash).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();

    // Unlock with the R1 PIN: the R1 PIN-derived key hierarchy survived the
    // upgrade and still unseals the DEK under the R2 build (the R1 profile is
    // reachable only because the key hierarchy + completed setup persisted).
    await lockPage.attempt(R1_PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();

    // The R1 profile/setup persisted across the upgrade: setup is STILL
    // completed (the doctor + clinic + trial rows migrated forward intact), and
    // get_backup_status serves through the OPEN migrated pool — which can only
    // succeed if the DB opened at the R2 latest schema (migrations 0004..0007
    // ran forward; a non-migrated or schema-too-new DB would error here).
    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    const status = await backupPage.getStatus();
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][D] R2 opened R1 dir; setup.completed=${upgraded.completed}, migrated schema serves backup status`,
    );

    // The R1 clinic.db is STILL the one in the R1 dir (upgraded in place, not a
    // fresh file) — runner-side proof the R2 build opened the previous-release
    // DB rather than creating a new one. Use the app-resolved data dir reported
    // by setup_get_state (XDG_DATA_HOME/<identifier>).
    expect(existsSync(`${upgraded.dataDir}/clinic.db`)).toBe(true);


    // The R1-MADE .hcbak still opens under the R2 build (NFR-011 "any backups
    // still open"): verify_backup re-hashes + decrypt-tests it, and
    // restore_preview reads a valid plaintext header. The archive was written
    // by the R1 build (format version 1), and the R2 reader accepts it.
    const r1BackupDir = path.join(sharedBackupDir(), 'r1-made');
    const r1Archives = readdirSync(r1BackupDir).filter((f) => f.endsWith('.hcbak'));
    expect(r1Archives.length).toBeGreaterThanOrEqual(1);
    const r1Archive = path.join(r1BackupDir, r1Archives[0] as string);

    const verified = await backupPage.invokeCommand<{
      ok: boolean;
      checksumOk: boolean;
      decryptOk: boolean;
    }>('verify_backup', { filePath: r1Archive, password: R1_BACKUP_PASSWORD });
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);

    const preview = await backupPage.restorePreview(r1Archive, R1_BACKUP_PASSWORD);
    expect(typeof preview.createdAt).toBe('string');
    expect(preview.createdAt.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(
      `[upgrade][D] R1-made .hcbak opens under R2: app_version=${preview.appVersion} createdAt=${preview.createdAt}`,
    );

    // It really is the CURRENT build running over the R1 dir (not the R1
    // binary relaunched — see launch.ts relaunchInto) and the DB was migrated
    // forward: patient_search exists only from R2 (the R1 build has no such
    // command) and reads the 0004 search schema the R1 DB does not have until
    // migrated.
    const searchErr = await schemaError('patient_search', { req: { query: 'a', limit: 5, cursor: null } });
    evidence(`[upgrade][D] patient_search (0004 schema) over the upgraded R1 dir: ${searchErr ?? 'serves'}`);
    if (searchErr !== null) {
      throw new Error(
        `NFR-011 upgrade defect: the current build opened the R1 dir but its schema was not migrated forward ` +
          `(patient_search -> ${searchErr})`,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R2 -> R3 HOP (HC-MVP1-226, NFR-011, R-DEL-004; R3 exit "an upgrade install
// over R2 keeps all patients"). R2 leaves a REAL clinic: clinic.db at the R2
// schema (user_version 7 — 0001..0007), the PIN key hierarchy, the doctor /
// clinic / trial rows, PATIENTS (with photos) and R2-made .hcbak backups.
//
// ── How the R2-state is seeded (honest, genuine previous-release data) ───────
//   PHASE E launches the ACTUAL R2 BUILD (R2_APP_BINARY, R2-final 5b180b9 built
//     with e2e-test-keys) over a fresh `r2-install` dir: the real first-run
//     wizard (setup_set_pin applies 0001..0007, user_version 0 -> 7), ONE
//     patient registered through the R2 S06 form WITH a photo, then the
//     200-patient synthetic fixture imported through the R2 build's own
//     patient_create path (patient_import_fixture), then a REAL R2 .hcbak via
//     the R2 build's backup_now. It snapshots, through the R2 build's own typed
//     commands, the FULL patient set (patient_list_query: id, code, name), the
//     licence row and the R2 app version.
//   PHASE F relaunches the R3 BUILD UNDER TEST over that SAME dir.
//
// ── What PHASE F proves through the webview (and the honest caveat) ─────────
//   • #/lock on the R2 dir and the R2 PIN unlocks (key hierarchy survived);
//   • migrations ran FORWARD to the R3 latest: case_template_get_default and
//     today_get_overview — which read tables only 0008_case_template /
//     0009_visit / 0011_case_template_journal create — serve, and a case is
//     taken + saved on an R2 patient (writes 0009 visit rows). PHASE E shows
//     the R2 build has no such command, so the DB really started at R2.
//     PRAGMA user_version itself (7 -> 11) is not exposed to the webview and is
//     asserted at the Rust layer (crates/hc-storage/tests/migrate_test.rs), as
//     for the earlier hops;
//   • ALL R2 patients are present: patient_list_query under R3 returns EXACTLY
//     the R2 snapshot (same count, same id/code/name on every row); search
//     (typed patient_search + the real F2 overlay) finds R2 patients by name
//     and by code; the photo patient's dashboard still shows the photo;
//   • the R2 setup/profile persists: setup completed, same data dir, the same
//     licence (kind + validUntil) as under R2. Exact doctor/clinic value
//     equality has no read command in R3 and stays a Rust-layer assertion;
//   • the R2-made .hcbak opens under R3 (verify_backup + restore_preview with
//     the R2 app version in its header).
//
// SKIP-not-fail: if R2_APP_BINARY is absent the hop cannot run honestly; it is
// reported as an infra skip (path + how to build it), never a silent pass.
const r2BuildPresent = existsSync(R2_APP_BINARY);

describe('HC-MVP1-226 upgrade-path PHASE E: provision a GENUINE R2 install (the R2 build writes clinic.db @ user_version 7, R2 patients incl a photo, and an R2-made .hcbak)', () => {
  before(function () {
    if (!r2BuildPresent) {
      evidence(
        `[upgrade][E] SKIP (infra): R2 build not found at ${R2_APP_BINARY}. ` +
          `Build the R2-final worktree (git worktree add --detach ../hc-r2-worktree 5b180b9; ` +
          `cd ../hc-r2-worktree/apps/desktop && npm ci && npm run tauri build -- --debug ` +
          `--features e2e-test-keys --no-bundle) or set HC_R2_APP_BINARY to run the R2->R3 hop.`,
      );
      this.skip();
    }
  });

  it('runs the REAL R2 wizard under the R2 build, registers a photo patient through the R2 UI, imports the 200-patient fixture through R2, snapshots every patient, and writes an R2-made .hcbak', async () => {
    expect(BACKUP_DIR).toBeDefined();

    await relaunchIntoWithBinary(R2_OVER_DIR, R2_APP_BINARY);
    const decided = await bootPage.waitForDecidedScreen();
    evidence(`[upgrade][E] R2 build (${R2_APP_BINARY}) self-chosen launch hash = ${await bootPage.launchHash()}`);
    expect(decided).toBe('#/setup');

    // Real first-run wizard under R2 (0001..0007 applied, user_version 0 -> 7).
    await provisionAndEnterApp(R2_OVER_DIR, R2_PIN);
    await expect(shellPage.todayScreen).toBeDisplayed();
    const r2State = await backupPage.setupState();
    expect(r2State.completed).toBe(true);
    expect(existsSync(`${r2State.dataDir}/clinic.db`)).toBe(true);
    const appInfo = await backupPage.invokeCommand<{ name: string; version: string }>('app_info');

    // This really is an R2 install: the R2 build has no R3 case-template
    // command (so the 0008+ schema cannot exist yet).
    let r2HasCaseTemplates = true;
    try {
      await backupPage.invokeCommand('case_template_get_default');
    } catch {
      r2HasCaseTemplates = false;
    }
    expect(r2HasCaseTemplates).toBe(false);

    // ONE patient through the real R2 S06 register form, with a photo.
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: R2_UI_PATIENT, age: '47', mobile: '9876501234', city: 'Kolhapur' });
    await patientsPage.attachPhotoFile(tinyPngPath());
    await browser.waitUntil(async () => patientsPage.hasPhoto(), {
      timeout: 15000,
      timeoutMsg: 'R2 register form: photo preview did not appear after file attach',
    });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(R2_UI_PATIENT);
    expect(await patientsPage.dashHasPhotoImg()).toBe(true);

    // The 200-patient synthetic fixture through the R2 build's own create path.
    const jsonl = path.join(dataDir('r2-fixture'), 'fixture.jsonl');
    const imported = await seedFixtureIntoApp(jsonl, R2_FIXTURE_COUNT, 42);
    expect(imported).toBeGreaterThanOrEqual(R2_FIXTURE_COUNT);

    // Snapshot EVERY R2 patient through the R2 build's own list command.
    const patients = await searchPage.listAllPatients();
    expect(patients.length).toBe(imported + 1);
    const uiPatient = patients.find((p) => p.name === R2_UI_PATIENT);
    expect(uiPatient).toBeDefined();
    const licence = await backupPage.invokeCommand<{ kind: string; validUntil: string; expired: boolean }>(
      'get_licence_status',
    );

    // A REAL R2-made .hcbak through the R2 build's backup_now.
    const r2BackupDir = path.join(sharedBackupDir(), 'r2-made');
    mkdirSync(r2BackupDir, { recursive: true });
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(r2BackupDir, R2_BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(existsSync(res.filePath)).toBe(true);

    r2 = {
      dataDir: r2State.dataDir,
      patients: byId(patients),
      uiPatient: uiPatient as PatientRow,
      licence: { kind: licence.kind, validUntil: licence.validUntil, expired: licence.expired },
      appVersion: appInfo.version,
      backupPath: res.filePath,
    };
    evidence(
      `[upgrade][E] R2 install: version=${appInfo.version} dataDir=${r2State.dataDir} ` +
        `patients=${patients.length} (fixture ${imported} + UI photo patient ${uiPatient?.code}) ` +
        `case_template_get_default under R2 = absent; licence=${JSON.stringify(r2.licence)}; ` +
        `R2 .hcbak=${res.filePath}`,
    );
  });
});

describe('HC-MVP1-226 upgrade-path PHASE F: the R3 build opens the R2 data dir, migrates 7->11 forward, unlocks with the R2 PIN, keeps EVERY R2 patient, and the R2-made .hcbak still opens (NFR-011, R-DEL-004)', () => {
  before(function () {
    if (!r2BuildPresent) {
      this.skip();
    }
  });

  it('relaunches the R3 build over the SAME R2 data dir: lock -> R2 PIN unlock, R3 schema serves, all R2 patients + photo + search survive, setup/licence persist, and the R2 backup opens', async () => {
    expect(r2).toBeDefined();
    const snap = r2 as R2Snapshot;

    // THE UPGRADE INSTALL: the R3 build under test (the default binary) over
    // the SAME `r2-install` dir. The idle R2 app is reaped first (launch.ts).
    await relaunchInto(R2_OVER_DIR);
    const decided = await bootPage.waitForDecidedScreen();
    evidence(`[upgrade][F] R3 build over R2 dir self-chosen launch hash = ${await bootPage.launchHash()}`);
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(R2_PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();

    // Setup / profile persisted, same data dir, migrated pool serves.
    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    expect(upgraded.dataDir).toBe(snap.dataDir);
    expect(existsSync(`${upgraded.dataDir}/clinic.db`)).toBe(true);
    const status = await backupPage.getStatus();
    expect(status.retention).toEqual({ daily: 14, weekly: 8, monthly: 12 });
    const licence = await backupPage.invokeCommand<{ kind: string; validUntil: string; expired: boolean }>(
      'get_licence_status',
    );
    expect({ kind: licence.kind, validUntil: licence.validUntil, expired: licence.expired }).toEqual(snap.licence);
    const info = await backupPage.invokeCommand<{ name: string; version: string }>('app_info');

    // EVERY R2 patient is present: the full id/code/name set is identical.
    const after = byId(await searchPage.listAllPatients());
    expect(after.length).toBe(snap.patients.length);
    expect(after).toEqual(snap.patients);

    // Search finds R2 patients (typed command) by name and by code.
    const picks = [
      snap.patients[0],
      snap.patients[Math.floor(snap.patients.length / 2)],
      snap.patients[snap.patients.length - 1],
      snap.uiPatient,
    ] as PatientRow[];
    for (const p of picks) {
      const byName = await searchPage.searchRows(p.name);
      expect(byName.some((r) => r.patientId === p.patientId)).toBe(true);
      const byCode = await searchPage.searchRows(p.code);
      expect(byCode.some((r) => r.patientId === p.patientId)).toBe(true);
    }

    // The R2-MADE .hcbak still opens under R3.
    const verified = await backupPage.invokeCommand<{ ok: boolean; checksumOk: boolean; decryptOk: boolean }>(
      'verify_backup',
      { filePath: snap.backupPath, password: R2_BACKUP_PASSWORD },
    );
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);
    const preview = await backupPage.restorePreview(snap.backupPath, R2_BACKUP_PASSWORD);
    expect(preview.createdAt.length).toBeGreaterThan(0);
    expect(preview.appVersion).toBe(snap.appVersion);

    evidence(
      `[upgrade][F] R3 (version ${info.version}) over R2 dir (R2 version ${snap.appVersion}): unlocked with R2 PIN; ` +
        `patients ${after.length} == R2 ${snap.patients.length}, id/code/name set identical; search by name+code found ` +
        `${picks.map((p) => p.code).join(',')}; licence ` +
        `${JSON.stringify(snap.licence)} kept; R2 .hcbak verify ok, preview appVersion=${preview.appVersion} ` +
        `createdAt=${preview.createdAt} patientCount=${preview.patientCount} visitCount=${preview.visitCount}`,
    );

    // Migrations 0008..0011 ran forward: the R3-only case/visit schema serves
    // (case_template_get_default reads 0008/0011, today_get_overview 0009).
    const tmplErr = await schemaError('case_template_get_default');
    const todayErr = await schemaError('today_get_overview', { req: { today: todayIso() } });
    evidence(
      `[upgrade][F] R3 schema over the upgraded R2 dir: case_template_get_default=${tmplErr ?? 'serves'}; ` +
        `today_get_overview=${todayErr ?? 'serves'}`,
    );
    if (tmplErr !== null || todayErr !== null) {
      throw new Error(
        `NFR-011 upgrade defect: the R3 build opened the R2 dir but did not migrate it to the R3 schema ` +
          `(case_template_get_default -> ${tmplErr ?? 'ok'}; today_get_overview -> ${todayErr ?? 'ok'})`,
      );
    }

    // The real F2 overlay finds the R2 photo patient; its dashboard (which
    // reads the migrated visit tables) opens and keeps the photo.
    await searchPage.openWithF2();
    await searchPage.searchFor(R2_UI_PATIENT);
    expect(await searchPage.firstResultText()).toContain(R2_UI_PATIENT);
    await searchPage.openFirstResult();
    await patientsPage.waitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(R2_UI_PATIENT);
    expect(await patientsPage.dashboardText()).toContain(snap.uiPatient.code);
    expect(await patientsPage.dashHasPhotoImg()).toBe(true);
    evidence(`[upgrade][F] F2 search opened R2 photo patient ${snap.uiPatient.code}; dashboard photo=true`);

    // An R3 case on an R2 patient saves (writes the migrated 0009 visit rows).
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    await caseRichPage.typeProse('Upgrade check: first R3 case on an R2 patient.');
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    evidence(`[upgrade][F] R3 case taken + saved on R2 patient ${snap.uiPatient.code}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R3 -> R5 HOP (HC-MVP1-226, NFR-011, R-DEL-004; the R5 build over a real R3
// clinic). R3 leaves: clinic.db at the R3 schema (user_version 11 —
// 0001..0011), the PIN key hierarchy, the doctor / clinic profile WITH the
// consultation fees, patients, journal-model CASES (complaint sections, record
// tables, dated follow-up entries), VISITS with next follow-up dates, and
// R3-made .hcbak backups.
//
// ── How the R3-state is seeded (honest, genuine previous-release data) ───────
//   PHASE G launches the ACTUAL R3 BUILD (R3_APP_BINARY, R3 close bbe9bd2 built
//     with e2e-test-keys) over a fresh `r3-install` dir and, through the R3 UI:
//     the real wizard with fees 450 / 275.50; patient A (S06) -> Take case ->
//     complaint + case text + vitals / physical generals / family history
//     tables -> Save; dashboard Follow-up -> a follow-up entry with its OWN
//     vitals -> next follow-up = today -> Save; patient B -> Take case ->
//     complaint + text -> next follow-up = tomorrow -> Save; then the
//     200-patient fixture through the R3 build's patient_import_fixture. It
//     snapshots through the R3 build's own typed commands the full patient set,
//     the three visits (case_visit_open_or_create: data / vitals / visit time /
//     next follow-up), the dashboard visit rows, Today (UI today and on the
//     test clock +1 day, typed overview today and tomorrow), the licence, and
//     writes a REAL R3 .hcbak (restore_preview counts recorded).
//   PHASE H relaunches the R5 BUILD UNDER TEST (the default binary) over that
//     SAME dir and unlocks with the R3 PIN.
//
// ── user_version before / after (runner-side, no new command) ───────────────
// No typed command exposes PRAGMA user_version, but two on-disk artefacts do:
//   • BEFORE: the R3 .hcbak's plaintext header `schema_version` (the R3 DB's
//     user_version at backup time) must equal the R3 latest migration (read
//     from the R3 worktree's migrations dir, else 11); and no
//     clinic.db.pre-migration.v<N>.bak exists in the R3 dir yet;
//   • AFTER: unlocking under R5 runs migrate::run, which writes
//     clinic.db.pre-migration.v<before>.bak (migrate.rs backup_path_for) — so
//     that exact file appearing proves the DB migrated FROM <before> — and an
//     R5 .hcbak written right after unlock carries `schema_version` = the
//     current tree's latest migration (12, 0012_billing).
// Both are logged to evidence.log as "user_version before=… after=…".
//
// SKIP-not-fail: if R3_APP_BINARY is absent the hop cannot run honestly; it is
// reported as an infra skip (path + how to build it), never a silent pass.
const r3BuildPresent = existsSync(R3_APP_BINARY);

describe('HC-MVP1-226 upgrade-path PHASE G: provision a GENUINE R3 install (the R3 build writes clinic.db @ user_version 11 with fees, cases with tables, visits with next follow-ups, 200 fixture patients and an R3-made .hcbak)', () => {
  before(function () {
    if (!r3BuildPresent) {
      evidence(
        `[upgrade][G] SKIP (infra): R3 build not found at ${R3_APP_BINARY}. ` +
          `Build the R3-close worktree (git worktree add --detach ../hc-r3-worktree bbe9bd2; ` +
          `cd ../hc-r3-worktree/apps/desktop && npm ci && npm run tauri build -- --debug ` +
          `--features e2e-test-keys --no-bundle) or set HC_R3_APP_BINARY to run the R3->R5 hop.`,
      );
      this.skip();
    }
  });

  it('runs the REAL R3 wizard under the R3 build with clinic fees 450 / 275.50 and proves it is an R3 install (no R5 billing command)', async () => {
    expect(BACKUP_DIR).toBeDefined();
    await relaunchIntoWithBinary(R3_OVER_DIR, R3_APP_BINARY);
    const decided = await bootPage.waitForDecidedScreen();
    evidence(`[upgrade][G] R3 build (${R3_APP_BINARY}) self-chosen launch hash = ${await bootPage.launchHash()}`);
    expect(decided).toBe('#/setup');

    // Real first-run wizard under R3 (0001..0011, user_version 0 -> 11), with
    // the hop's own fees so R5 can only show them if they came from R3.
    await completeFirstRunWizard(R3_PIN, R3_FEES);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();
    const st = await backupPage.setupState();
    expect(st.completed).toBe(true);
    expect(existsSync(`${st.dataDir}/clinic.db`)).toBe(true);
    const info = await backupPage.invokeCommand<{ name: string; version: string }>('app_info');

    // This really is an R3 install: the R5 billing command does not exist.
    let r3Billing = 'present';
    try {
      await backupPage.invokeCommand('billing_visit_status', { req: { visitId: 'none' } });
    } catch (e) {
      r3Billing = `absent (${e instanceof Error ? e.message : String(e)})`;
    }
    expect(r3Billing.startsWith('absent')).toBe(true);
    g.dataDir = st.dataDir;
    g.appVersion = info.version;
    evidence(
      `[upgrade][G] R3 install: version=${info.version} dataDir=${st.dataDir}; wizard fees ` +
        `${R3_FEES.first} / ${R3_FEES.followup}; billing_visit_status under R3 = ${r3Billing}`,
    );
  });

  it('patient A under R3: a first case with complaint, text and vitals / generals / family tables, then a follow-up entry with its own vitals and next follow-up = today', async () => {
    expect(g.dataDir).toBeDefined();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: R3_CASE_PATIENT, age: '39', city: 'Satara' });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(R3_CASE_PATIENT);
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    const { patientId, visitId: firstVisitId } = await caseRichPage.routeIds();

    await caseRichPage.addComplaint(R3_COMPLAINT);
    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(R3_COMPLAINT)),
      { timeout: 15000, timeoutMsg: 'R3: Add new complaint did not create the complaint section' },
    );
    await caseRichPage.typeProse(R3_CASE_TEXT);
    await caseRichPage.recordVitals(R3_V);
    await caseRichPage.recordGenerals(R3_GENERALS);
    await caseRichPage.recordFamily(R3_FAMILY_MATERNAL, R3_FAMILY_PATERNAL);
    await browser.waitUntil(
      async () => {
        const types = (await caseRichPage.tables()).map((t) => t.tableType);
        return ['vitals', 'physical_generals', 'family_history'].every((t) => types.includes(t));
      },
      { timeout: 15000, timeoutMsg: 'R3: vitals / physical generals / family history tables were not all inserted' },
    );
    expect(await caseRichPage.tableCellText('vitals', 0, COL_SYS)).toBe(R3_V.sys);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    // Snapshot A's first visit NOW, while it is A's latest visit: once the
    // follow-up exists, open_or_create('first') would CREATE a new visit.
    g.aFirst = await visitSnap(patientId, 'first');
    expect(g.aFirst.visitId).toBe(firstVisitId);

    // Follow-up from the dashboard: prior record pre-loaded, a follow-up entry
    // under the complaint with its OWN vitals, next follow-up = today.
    await patientsPage.openDashboard(patientId);
    await patientsPage.dashFollowup();
    await caseRichPage.waitForForm();
    const followupVisitId = (await caseRichPage.routeIds()).visitId;
    expect(followupVisitId).not.toBe(firstVisitId);
    await browser.waitUntil(async () => (await caseRichPage.editorText()).includes(R3_CASE_TEXT), {
      timeout: 20000,
      timeoutMsg: 'R3: prior case text was not pre-loaded into the follow-up',
    });
    await caseRichPage.focusComplaintByName(R3_COMPLAINT);
    const before = (await caseRichPage.entryHeadings()).length;
    await caseRichPage.addFollowupEntry();
    await browser.waitUntil(async () => (await caseRichPage.entryHeadings()).length === before + 1, {
      timeout: 15000,
      timeoutMsg: 'R3: Add follow-up entry did not append an entry',
    });
    const last = (await caseRichPage.entryTables()).length - 1;
    await caseRichPage.recordVitals(R3_FU_V);
    await browser.waitUntil(
      async () => ((await caseRichPage.entryTables())[last]?.tables ?? []).some((t) => t.type === 'vitals'),
      { timeout: 15000, timeoutMsg: 'R3: Record vitals in the follow-up entry did not create a vitals table there' },
    );
    await caseRichPage.typeProse(R3_FU_TEXT);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    const today = todayIso();
    await setNextFollowupAndSave(today, 'R3 patient A next follow-up today');
    expect(await nf.savedNextFollowup(patientId, 'follow_up')).toEqual({
      visitId: followupVisitId,
      nextFollowupOn: today,
    });
    g.a = { patientId, firstVisitId, followupVisitId };
    evidence(
      `[upgrade][G] R3 patient A ${patientId}: first visit ${firstVisitId} (complaint "${R3_COMPLAINT}", text, ` +
        `vitals ${R3_V.sys}/${R3_V.dia} pulse ${R3_V.pulse}, generals, family) + follow-up ${followupVisitId} ` +
        `(entry vitals ${R3_FU_V.sys}/${R3_FU_V.dia}); next F/U ${today}`,
    );
  });

  it('patient B under R3: a short first case with next follow-up = tomorrow, then the 200-patient fixture through the R3 build', async () => {
    expect(g.a).toBeDefined();
    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({ name: R3_FU_PATIENT, age: '52', city: 'Sangli' });
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    const { patientId, visitId: firstVisitId } = await caseRichPage.routeIds();
    await caseRichPage.addComplaint(R3_B_COMPLAINT);
    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(R3_B_COMPLAINT)),
      { timeout: 15000, timeoutMsg: 'R3: patient B complaint section was not created' },
    );
    await caseRichPage.typeProse(R3_B_TEXT);
    await caseRichPage.save();
    expect(await caseRichPage.waitForSaved()).toMatch(/^Saved/);
    const tomorrow = isoPlusDays(1);
    await setNextFollowupAndSave(tomorrow, 'R3 patient B next follow-up tomorrow');
    expect((await nf.savedNextFollowup(patientId, 'first')).nextFollowupOn).toBe(tomorrow);
    g.b = { patientId, firstVisitId };

    const jsonl = path.join(dataDir('r3-fixture'), 'fixture.jsonl');
    g.imported = await seedFixtureIntoApp(jsonl, R3_FIXTURE_COUNT, 43);
    expect(g.imported).toBeGreaterThanOrEqual(R3_FIXTURE_COUNT);
    evidence(
      `[upgrade][G] R3 patient B ${patientId}: first visit ${firstVisitId} next F/U ${tomorrow}; ` +
        `fixture imported through R3 = ${g.imported}`,
    );
  });

  it('snapshots every R3 patient, visit, dashboard row and Today under R3, and writes an R3-made .hcbak whose header records user_version 11', async () => {
    expect(g.b).toBeDefined();
    const a = g.a as NonNullable<typeof g.a>;
    const b = g.b as NonNullable<typeof g.b>;

    const patients = byId(await searchPage.listAllPatients());
    expect(patients.length).toBe((g.imported as number) + 2);
    // A's first visit was read while it was A's latest (patient A step); A's
    // follow-up and B's first are each their patient's latest, so these
    // open_or_create calls reuse and create nothing (see VisitSnap).
    expect(g.aFirst).toBeDefined();
    const visits = {
      aFirst: g.aFirst as VisitSnap,
      aFollowup: await visitSnap(a.patientId, 'follow_up'),
      bFirst: await visitSnap(b.patientId, 'first'),
    };
    expect(visits.aFirst.visitId).toBe(a.firstVisitId);
    expect(visits.aFollowup.visitId).toBe(a.followupVisitId);
    expect(visits.bFirst.visitId).toBe(b.firstVisitId);
    expect(visits.aFollowup.nextFollowupOn).toBe(todayIso());
    expect(visits.bFirst.nextFollowupOn).toBe(isoPlusDays(1));

    await patientsPage.openDashboard(a.patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 2, {
      timeout: 20000,
      timeoutMsg: 'R3: dashboard of patient A did not list both visits',
    });
    const dashA = await patientsPage.dashVisitRows();
    expect(dashA.map((r) => r.type)).toEqual(['Follow-up', 'First']);
    await patientsPage.openDashboard(b.patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 1, {
      timeout: 20000,
      timeoutMsg: 'R3: dashboard of patient B did not list its visit',
    });
    const dashB = await patientsPage.dashVisitRows();
    // Create-free reads: the typed timelines prove exactly the three R3 visits
    // exist (nothing above created one), and the read-only summary render of
    // each visit by id is the content baseline for A's first visit under R5.
    const dv = { a: await dashVisits(a.patientId), b: await dashVisits(b.patientId) };
    expect(dv.a.map((v) => [v.visitId, v.kind])).toEqual([
      [a.followupVisitId, 'follow_up'],
      [a.firstVisitId, 'first'],
    ]);
    expect(dv.b.map((v) => [v.visitId, v.kind])).toEqual([[b.firstVisitId, 'first']]);
    const summaries = {
      aFirst: await visitSummaryHtml(a.firstVisitId),
      aFollowup: await visitSummaryHtml(a.followupVisitId),
      bFirst: await visitSummaryHtml(b.firstVisitId),
    };
    expectFirstCaseSummary(summaries.aFirst, 'R3');

    // Today under R3 is the baseline R5 must reproduce.
    const today = await todayView([R3_CASE_PATIENT, R3_FU_PATIENT], [a.patientId, b.patientId]);
    expectHopToday(today, a.patientId, b.patientId);

    const licence = await backupPage.invokeCommand<{ kind: string; validUntil: string; expired: boolean }>(
      'get_licence_status',
    );

    // A REAL R3-made .hcbak through the R3 build's backup_now.
    const r3BackupDir = path.join(sharedBackupDir(), 'r3-made');
    mkdirSync(r3BackupDir, { recursive: true });
    await backupPage.open();
    await expect(backupPage.screen).toBeDisplayed();
    const res = await backupPage.backupNow(r3BackupDir, R3_BACKUP_PASSWORD);
    expect(res.ok).toBe(true);
    expect(res.verified).toBe(true);
    expect(existsSync(res.filePath)).toBe(true);
    const preview = await backupPage.restorePreview(res.filePath, R3_BACKUP_PASSWORD);
    expect(preview.patientCount).toBe(patients.length);
    expect(preview.visitCount).toBe(3);

    // user_version BEFORE the upgrade: the R3 DB's, from the archive header.
    const header = readHcbakHeader(res.filePath);
    const r3Latest = latestMigration(R3_WORKTREE) ?? R3_SCHEMA_FALLBACK;
    expect(header.schemaVersion).toBe(r3Latest);
    expect(header.appVersion).toBe(g.appVersion);
    const copies = preMigrationCopies(g.dataDir as string);
    expect(copies.filter((f) => f.startsWith(`clinic.db.pre-migration.v${r3Latest}.`))).toEqual([]);

    r3 = {
      dataDir: g.dataDir as string,
      appVersion: g.appVersion as string,
      patients,
      a,
      b,
      visits,
      summaries,
      dashVisits: dv,
      dashRows: { a: dashA, b: dashB },
      today,
      licence: { kind: licence.kind, validUntil: licence.validUntil, expired: licence.expired },
      backupPath: res.filePath,
      preview: {
        patientCount: preview.patientCount,
        visitCount: preview.visitCount,
        lastVisitDate: preview.lastVisitDate,
      },
      schemaBefore: header.schemaVersion,
    };
    evidence(
      `[upgrade][G] R3 snapshot: patients=${patients.length}; visits A first ${visits.aFirst.visitId} / ` +
        `A follow-up ${visits.aFollowup.visitId} (next ${visits.aFollowup.nextFollowupOn}) / B first ` +
        `${visits.bFirst.visitId} (next ${visits.bFirst.nextFollowupOn}); dash A ${JSON.stringify(dashA)} ` +
        `B ${JSON.stringify(dashB)}; Today ${JSON.stringify(today)}; licence ${JSON.stringify(r3.licence)}; ` +
        `R3 .hcbak ${res.filePath} preview patients=${preview.patientCount} visits=${preview.visitCount} ` +
        `last=${preview.lastVisitDate}; header schema_version=${header.schemaVersion} (R3 latest ${r3Latest}) ` +
        `app_version=${header.appVersion}; pre-migration copies in R3 dir: ${JSON.stringify(copies)}`,
    );
  });
});

describe('HC-MVP1-226 upgrade-path PHASE H: the R5 build opens the R3 data dir, migrates 11->12, keeps every R3 patient, case, visit and next follow-up, shows the R3 fees, bills an R3 visit, and the R3-made .hcbak still opens (NFR-011, R-DEL-004)', () => {
  before(function () {
    if (!r3BuildPresent) {
      this.skip();
    }
  });

  it('relaunches the R5 build over the SAME R3 dir: lock -> R3 PIN unlock migrates to latest (user_version before/after recorded), setup / licence persist and the R5 schema serves', async () => {
    expect(r3).toBeDefined();
    const snap = r3 as R3Snapshot;

    // THE UPGRADE INSTALL: the build under test (default binary) over the
    // SAME `r3-install` dir. The idle R3 app is reaped first (launch.ts).
    await relaunchInto(R3_OVER_DIR);
    const decided = await bootPage.waitForDecidedScreen();
    evidence(`[upgrade][H] R5 build over R3 dir self-chosen launch hash = ${await bootPage.launchHash()}`);
    expect(decided).toBe('#/lock');
    await expect(bootPage.lockCard).toBeDisplayed();
    await lockPage.attempt(R3_PIN);
    await shellPage.waitForShell();
    await expect(shellPage.todayScreen).toBeDisplayed();

    const upgraded = await backupPage.setupState();
    expect(upgraded.completed).toBe(true);
    expect(upgraded.dataDir).toBe(snap.dataDir);
    const licence = await backupPage.invokeCommand<{ kind: string; validUntil: string; expired: boolean }>(
      'get_licence_status',
    );
    expect({ kind: licence.kind, validUntil: licence.validUntil, expired: licence.expired }).toEqual(snap.licence);
    const info = await backupPage.invokeCommand<{ name: string; version: string }>('app_info');

    // user_version AFTER: unlock ran migrate::run, which copied the DB to
    // clinic.db.pre-migration.v<before>.bak first (so it migrated FROM the R3
    // version), and an R5 backup made now records the latest schema.
    const copies = preMigrationCopies(upgraded.dataDir);
    expect(copies).toContain(`clinic.db.pre-migration.v${snap.schemaBefore}.bak`);
    const r5BackupDir = path.join(sharedBackupDir(), 'r5-after-r3');
    mkdirSync(r5BackupDir, { recursive: true });
    const after = await backupPage.backupNow(r5BackupDir, R3_BACKUP_PASSWORD);
    expect(after.ok).toBe(true);
    const afterHeader = readHcbakHeader(after.filePath);
    const latest = latestMigration(REPO_ROOT);
    expect(latest).not.toBeNull();
    expect(afterHeader.schemaVersion).toBe(latest as number);
    expect(afterHeader.schemaVersion).toBeGreaterThan(snap.schemaBefore);

    // The R5-only billing schema (0012) serves over the upgraded R3 DB.
    const reportErr = await schemaError('report_daily_collection', { req: { date: todayIso() } });
    const statusErr = await schemaError('billing_visit_status', { req: { visitId: snap.a.firstVisitId } });
    const todayErr = await schemaError('today_get_overview', { req: { today: todayIso() } });
    evidence(
      `[upgrade][H] R5 (version ${info.version}) over R3 dir (R3 version ${snap.appVersion}): unlocked with the R3 PIN; ` +
        `user_version before=${snap.schemaBefore} (R3 .hcbak header) after=${afterHeader.schemaVersion} ` +
        `(R5 .hcbak header, tree latest ${latest}); pre-migration copies ${JSON.stringify(copies)}; ` +
        `report_daily_collection=${reportErr ?? 'serves'} billing_visit_status=${statusErr ?? 'serves'} ` +
        `today_get_overview=${todayErr ?? 'serves'}; licence ${JSON.stringify(snap.licence)} kept`,
    );
    if (reportErr !== null || statusErr !== null || todayErr !== null) {
      throw new Error(
        `NFR-011 upgrade defect: the R5 build opened the R3 dir but its schema does not serve ` +
          `(report_daily_collection -> ${reportErr ?? 'ok'}; billing_visit_status -> ${statusErr ?? 'ok'}; ` +
          `today_get_overview -> ${todayErr ?? 'ok'})`,
      );
    }
  });

  it('keeps EVERY R3 patient, the three R3 visits (case data, vitals, visit time, next follow-up), the dashboard rows, and the reopened case still shows its complaint and tables', async () => {
    expect(r3).toBeDefined();
    const snap = r3 as R3Snapshot;

    // Typed reads FIRST, before any R5 screen opens a visit (which may save).
    const patients = byId(await searchPage.listAllPatients());
    expect(patients.length).toBe(snap.patients.length);
    expect(patients).toEqual(snap.patients);
    // Create-free reads first: the visit timelines (ids, instants, kinds) and
    // the read-only summary render of every R3 visit by id, byte-identical to
    // R3's (the render code is the same at R3 and R5, so equal HTML = equal
    // stored case data). A's first visit is NOT A's latest, so it is never read
    // through open_or_create here (that would create a visit, see VisitSnap).
    const dv = { a: await dashVisits(snap.a.patientId), b: await dashVisits(snap.b.patientId) };
    expect(dv).toEqual(snap.dashVisits);
    const summaries = {
      aFirst: await visitSummaryHtml(snap.a.firstVisitId),
      aFollowup: await visitSummaryHtml(snap.a.followupVisitId),
      bFirst: await visitSummaryHtml(snap.b.firstVisitId),
    };
    expect(summaries).toEqual(snap.summaries);
    expectFirstCaseSummary(summaries.aFirst, 'R5');
    expect(dv.a.find((v) => v.visitId === snap.a.firstVisitId)?.visitAt).toBe(snap.visits.aFirst.visitAt);
    // A's follow-up and B's first are each their patient's latest visit, so
    // open_or_create reuses them: full typed compare (data, vitals, instant,
    // next follow-up).
    const visits = {
      aFollowup: await visitSnap(snap.a.patientId, 'follow_up'),
      bFirst: await visitSnap(snap.b.patientId, 'first'),
    };
    for (const k of ['aFollowup', 'bFirst'] as const) {
      expect(visits[k].visitId).toBe(snap.visits[k].visitId);
      expect(visits[k].visitAt).toBe(snap.visits[k].visitAt);
      expect(visits[k].nextFollowupOn).toBe(snap.visits[k].nextFollowupOn);
      expect(JSON.parse(visits[k].dataJson)).toEqual(JSON.parse(snap.visits[k].dataJson));
      expect(JSON.parse(visits[k].vitalsJson)).toEqual(JSON.parse(snap.visits[k].vitalsJson));
    }
    const found = await searchPage.searchRows(R3_CASE_PATIENT);
    expect(found.some((r) => r.patientId === snap.a.patientId)).toBe(true);

    await patientsPage.openDashboard(snap.a.patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 2, {
      timeout: 20000,
      timeoutMsg: 'R5: dashboard of R3 patient A did not list both R3 visits',
    });
    expect(await patientsPage.dashVisitRows()).toEqual(snap.dashRows.a);
    await patientsPage.openDashboard(snap.b.patientId);
    await browser.waitUntil(async () => (await patientsPage.dashVisitRows()).length >= 1, {
      timeout: 20000,
      timeoutMsg: 'R5: dashboard of R3 patient B did not list its R3 visit',
    });
    expect(await patientsPage.dashVisitRows()).toEqual(snap.dashRows.b);

    // The R3 case journal renders under R5. The case route opens A's LATEST
    // visit (the R3 follow-up, open_or_create reuses it): the journal carries
    // the R3 complaint, the first-case text and tables, and the follow-up
    // entry's own text.
    await caseRichPage.openFollowupVisit(snap.a.patientId, snap.a.followupVisitId);
    expect((await caseRichPage.routeIds()).visitId).toBe(snap.a.followupVisitId);
    await browser.waitUntil(
      async () => (await caseRichPage.complaintHeaders()).some((c) => c.text.includes(R3_COMPLAINT)),
      { timeout: 20000, timeoutMsg: 'R5: the R3 complaint section did not render' },
    );
    expect(await caseRichPage.editorText()).toContain(R3_CASE_TEXT);
    expect(await caseRichPage.editorText()).toContain(R3_FU_TEXT);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_SYS)).toBe(R3_V.sys);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_DIA)).toBe(R3_V.dia);
    expect(await caseRichPage.tableCellText('vitals', 0, COL_PULSE)).toBe(R3_V.pulse);
    const generals = await tableText('physical_generals');
    for (const v of Object.values(R3_GENERALS)) expect(generals).toContain(v);
    const family = await tableText('family_history');
    expect(family).toContain('Asthma');
    expect(family).toContain('Gout');
    // Opening the journal created nothing: still exactly the R3 timeline.
    expect(await dashVisits(snap.a.patientId)).toEqual(snap.dashVisits.a);
    evidence(
      `[upgrade][H] R5 keeps R3 data: patients ${patients.length} == R3 ${snap.patients.length} (id/code/name identical); ` +
        `timelines identical; summary render of A first / A follow-up / B first byte-identical; ` +
        `A follow-up / B first identical (data, vitals, visitAt, next F/U ` +
        `${visits.aFollowup.nextFollowupOn} / ${visits.bFirst.nextFollowupOn}); dashboard rows A ` +
        `${JSON.stringify(snap.dashRows.a)} B ${JSON.stringify(snap.dashRows.b)}; R3 case renders complaint, ` +
        `text, vitals ${R3_V.sys}/${R3_V.dia}/${R3_V.pulse}, generals, family`,
    );
  });

  it('Today still lists R3 patient A as due today and, on the test clock +1 day, A overdue and B due — exactly as R3 did', async () => {
    expect(r3).toBeDefined();
    const snap = r3 as R3Snapshot;
    const today = await todayView([R3_CASE_PATIENT, R3_FU_PATIENT], [snap.a.patientId, snap.b.patientId]);
    expectHopToday(today, snap.a.patientId, snap.b.patientId);
    expect(today).toEqual(snap.today);
    evidence(`[upgrade][H] Today under R5 == R3: ${JSON.stringify(today)}`);
  });

  it('Settings opens and shows the R3 clinic name and the R3 fees 450.00 / 275.50', async () => {
    expect(r3).toBeDefined();
    await settingsPage.openViaNav();
    expect(await settingsPage.value('settings-clinic-name')).toBe(R3_CLINIC_NAME);
    const consult = await settingsPage.value('settings-fee-consult');
    const followup = await settingsPage.value('settings-fee-followup');
    expect(consult).toBe('450.00');
    expect(followup).toBe('275.50');
    evidence(`[upgrade][H] Settings over the R3 profile: clinic "${R3_CLINIC_NAME}", fees ${consult} / ${followup}`);
  });

  it('a new invoice is created for an R3 visit: the dashboard Bill button on R3 patient A\'s first visit proposes the R3 first-visit fee, and saves <FY>/0001', async () => {
    expect(r3).toBeDefined();
    const snap = r3 as R3Snapshot;
    // A's first visit is not A's latest, so it is billed from its dashboard
    // timeline row (the R5 per-visit Bill button), never by reopening the case
    // route (which would create a new first visit, see VisitSnap).
    await patientsPage.openDashboard(snap.a.patientId);
    await billingPage.openFromDashboardBill(snap.a.firstVisitId);
    expect(await billingPage.hash()).toBe(invoiceHash(snap.a.patientId, snap.a.firstVisitId));
    expect(await billingPage.lineCount()).toBe(1);
    expect(await billingPage.lineKindValue(1)).toBe('consultation');
    await billingPage.waitForLineAmount(1, '450.00');
    await billingPage.typePaid('450');
    await billingPage.chooseMode('cash');
    const number = await billingPage.saveAndWaitForNumber();
    const fy = fyLabel(todayIso());
    expect(number).toContain(`${fy}/0001`);
    await billingPage.waitForPaidBalance('450.00', '0.00');
    evidence(
      `[upgrade][H] invoice for R3 visit ${snap.a.firstVisitId}: consultation line 450.00 (the R3 first-visit fee), ` +
        `paid 450 cash, saved "${number}" (FY ${fy})`,
    );
  });

  it('the R3-made .hcbak still opens under R5: verify passes and the preview counts equal the R3 snapshot', async () => {
    expect(r3).toBeDefined();
    const snap = r3 as R3Snapshot;
    const verified = await backupPage.invokeCommand<{ ok: boolean; checksumOk: boolean; decryptOk: boolean }>(
      'verify_backup',
      { filePath: snap.backupPath, password: R3_BACKUP_PASSWORD },
    );
    expect(verified.ok).toBe(true);
    expect(verified.checksumOk).toBe(true);
    expect(verified.decryptOk).toBe(true);
    const preview = await backupPage.restorePreview(snap.backupPath, R3_BACKUP_PASSWORD);
    expect(preview.appVersion).toBe(snap.appVersion);
    expect(preview.createdAt.length).toBeGreaterThan(0);
    expect({
      patientCount: preview.patientCount,
      visitCount: preview.visitCount,
      lastVisitDate: preview.lastVisitDate,
    }).toEqual(snap.preview);
    expect(preview.patientCount).toBe(snap.patients.length);
    expect(preview.visitCount).toBe(3);
    evidence(
      `[upgrade][H] R3 .hcbak under R5: verify ok (checksum+decrypt); preview appVersion=${preview.appVersion} ` +
        `patients=${preview.patientCount} visits=${preview.visitCount} last=${preview.lastVisitDate} == R3 snapshot`,
    );
  });
});
