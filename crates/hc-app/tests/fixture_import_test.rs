//! HC-MVP1-M2d (OPTION A): the provisioned, boot-gated app can SEED and SEARCH
//! a >= 200-patient multi-disease fixture WITHOUT sharing the seed's key.
//!
//! This closes the E2E key-mismatch blocker: `hc-seed` keys its own DB with the
//! fixed dev/test key, but the app opens `clinic.db` with a RANDOM PIN-derived
//! DEK (`KeyHierarchy::initialize`), so a seed-produced DB can't be opened by
//! the app. Instead, the seed emits a plaintext JSONL fixture and the app
//! imports it through the REAL `patient_create` path (`patient_import_fixture`,
//! feature `e2e-test-keys`), so the patient_sequence, the four normalised
//! columns and the migration-0004 FTS/trigram triggers stay in sync and every
//! imported patient is immediately findable by the running app.
//!
//! The DB here is opened exactly as the provisioned app opens it — a REAL DEK
//! minted by `KeyHierarchy::initialize` over the encrypted-file keystore — so
//! this test proves the app-DB path end to end, not a shared-key shortcut.
//!
//! RED before green: the feature-gated `import_fixture` method and command do
//! not exist until `hc-core-dev` lands them, so this fails to compile against
//! the absent CUT. Synthetic data only (R-TEST-004, R-PRIV-001). Run with:
//! `cargo test -p hc-app --features e2e-test-keys`.
#![cfg(feature = "e2e-test-keys")]

use hc_app::clock::Clock;
use hc_app::patient::PatientService;

use hc_seed::{write_fixture_jsonl_file, GenConfig, FIXTURE_MIN_PATIENTS};

use hc_search::query::search;
use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::FileKeystore;
use hc_storage::Pool;

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock;
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        "2026-02-01T00:00:00Z".to_string()
    }
}

/// The synthetic app PIN (A3 policy: 4–6 digits).
const TEST_PIN: &str = "2468";

/// Open the DB EXACTLY as the provisioned, boot-gated app does: a real DEK
/// minted by `KeyHierarchy::initialize` over the encrypted-file keystore, then
/// `Pool::open` under that DEK + migrations. This is a DIFFERENT key from
/// `hc-seed`'s fixed dev key, which is the whole point (the import path never
/// shares a key).
fn provisioned_app_db() -> (tempfile::TempDir, tempfile::TempDir, FileKeystore, Pool) {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");

    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(TEST_PIN)
        .expect("mint random PIN-derived DEK (as the app does at setup)");
    let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open app DB");
    hc_storage::migrate::run(&pool).expect("migrate app DB to latest");

    (ks_dir, data_dir, keystore, pool)
}

/// OPTION A end to end: seed a JSONL fixture, import it into the provisioned app
/// DB through the real create path, then assert the app can OPEN + SEARCH it.
#[test]
fn m2d_seeded_fixture_is_importable_and_searchable_by_the_app() {
    let (_ks, data_dir, keystore, pool) = provisioned_app_db();

    // 1) Seed a >= 200-patient fixture as the E2E does — plaintext JSONL, NO key.
    let jsonl = data_dir.path().join("fixture.jsonl");
    let cfg = GenConfig::fixture(240, data_dir.path().join("unused.db"));
    let generated = write_fixture_jsonl_file(&cfg, &jsonl).expect("write JSONL fixture");
    assert!(
        generated >= FIXTURE_MIN_PATIENTS,
        "the fixture must carry >= {FIXTURE_MIN_PATIENTS} patients (got {generated})"
    );

    // 2) Import it into the ALREADY-PROVISIONED app DB through the real create
    //    path (feature-gated command path).
    let clock = FakeClock;
    let svc = PatientService::new(&keystore, &clock, data_dir.path());
    let resp = svc
        .import_fixture(&pool, &jsonl)
        .expect("import the JSONL fixture through the real create path");
    assert_eq!(
        resp.imported as usize, generated,
        "every seeded patient must import via patient_create (count parity)"
    );

    // 3) The app opened the DB with its OWN random DEK and must now find the
    //    imported patients — proving the import went through the real write
    //    path (FTS/trigram in sync), not a shared-key DB swap.
    let row_count: i64 = pool
        .with_reader(|c| Ok(c.query_row("SELECT COUNT(*) FROM patient", [], |r| r.get(0))?))
        .expect("count patients");
    assert_eq!(
        row_count as usize, generated,
        "the app DB must hold exactly the imported patients"
    );

    // Codes are assigned by the app's monotonic sequence (PAT-002), so the
    // first patient is HC-000001 — search it by exact code.
    let page = pool
        .with_reader(|c| Ok(search(c, "HC-000001", None).expect("search by code")))
        .expect("reader lease");
    assert!(
        page.hits.iter().any(|h| h.code == "HC-000001"),
        "a freshly imported patient must be findable by its exact code — \
         proves the import ran through the real create path (FTS in sync)"
    );

    // And a name search returns ranked hits (the FTS/phonetic index is live).
    let any_name_hits = pool
        .with_reader(|c| {
            // Pull one imported name to search for.
            let name: String = c.query_row("SELECT name FROM patient LIMIT 1", [], |r| r.get(0))?;
            Ok(search(c, &name, None).map(|p| p.hits.len()).unwrap_or(0))
        })
        .expect("name search lease");
    assert!(
        any_name_hits >= 1,
        "searching an imported patient's name must return >= 1 hit (phonetic/FTS live)"
    );
}

/// The import is additive through the real sequence: importing twice does not
/// reuse codes (PAT-002) and both batches are searchable — i.e. the command is
/// a thin loop over `patient_create`, not a bulk INSERT that bypasses the
/// sequence or the FTS triggers.
#[test]
fn m2d_import_uses_the_real_monotonic_sequence() {
    let (_ks, data_dir, keystore, pool) = provisioned_app_db();
    let jsonl = data_dir.path().join("fixture.jsonl");
    let cfg = GenConfig::fixture(55, data_dir.path().join("unused.db"));
    let n = write_fixture_jsonl_file(&cfg, &jsonl).expect("write fixture");

    let clock = FakeClock;
    let svc = PatientService::new(&keystore, &clock, data_dir.path());
    svc.import_fixture(&pool, &jsonl).expect("first import");
    svc.import_fixture(&pool, &jsonl).expect("second import");

    // 2n rows, all distinct codes (the monotonic PAT-002 sequence never reused).
    let (rows, distinct_codes): (i64, i64) = pool
        .with_reader(|c| {
            let rows: i64 = c.query_row("SELECT COUNT(*) FROM patient", [], |r| r.get(0))?;
            let distinct: i64 =
                c.query_row("SELECT COUNT(DISTINCT code) FROM patient", [], |r| r.get(0))?;
            Ok((rows, distinct))
        })
        .expect("count");
    assert_eq!(rows as usize, 2 * n, "both import batches landed");
    assert_eq!(
        distinct_codes, rows,
        "every patient has a unique code — the import used the real monotonic sequence (PAT-002)"
    );
}
