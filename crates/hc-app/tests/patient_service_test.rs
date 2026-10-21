//! RED tests for the patient use-case service (HC-MVP1-036..043,
//! PAT-001/002/004/005/006/008/011). CUT: `hc_app::patient::PatientService` and
//! the `hc_storage::patient` repositories + migration 0006 it drives.
//!
//! The ONLY fakes are DEPENDENCIES (R-TEST-002): the encrypted-file keystore
//! (`hc_storage::testing::temp_file_keystore`, the headless-Linux fallback) with
//! a REAL wrapped DEK minted by `KeyHierarchy::initialize` (so the permanent-
//! delete PIN re-verify path is exercised for real), a local `FakeClock`
//! (R-TEST-006), and `hc_search` for the PSR-012 findability assertions. The
//! DB, key hierarchy and repositories are the real CUT, never faked. Synthetic
//! data only (R-TEST-004). Names carry the req id (R-TEST-008).
//!
//! Red-first: the service stubs return `Err(NotFound)`/empty, so every
//! assertion below fails until `hc-core-dev` implements the service. Each test
//! asserts the resulting data/state (R-TEST-003), not merely `is_ok()`.

use hc_app::clock::Clock;
use hc_app::error::AppError;
use hc_app::patient::{
    CheckDuplicateRequest, CreatePatientRequest, ExportRequest, GetDashboardRequest,
    LinkFamilyRequest, PatientService, PermanentDeleteRequest, RestoreRequest, SoftDeleteRequest,
    UpdatePatientRequest,
};

use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::FileKeystore;
use hc_storage::Pool;

/// Deterministic clock (dependency fake, R-TEST-006): always the same instant.
struct FakeClock {
    now: String,
}
impl FakeClock {
    fn at(now: &str) -> Self {
        FakeClock {
            now: now.to_string(),
        }
    }
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.clone()
    }
}

/// The synthetic app PIN used across these tests (A3 policy: 4–6 digits).
const TEST_PIN: &str = "2468";

/// Build a ready-to-use environment: a file keystore holding a REAL DEK wrapped
/// under [`TEST_PIN`], the encrypted DB opened under that DEK and migrated
/// through 0006, and the owning temp dirs. Returns everything the test needs to
/// construct a `PatientService` and call it with the open `Pool`.
///
/// This is the production unlock path (`KeyHierarchy::initialize` → `Pool::open`
/// → `migrate::run`), so a permanent-delete test re-verifying the PIN hits the
/// same keystore record the DB was created with (no fake crypto).
fn env() -> (tempfile::TempDir, tempfile::TempDir, FileKeystore, Pool) {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");

    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(TEST_PIN)
        .expect("mint DEK");
    let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open encrypted DB");
    hc_storage::migrate::run(&pool).expect("run migrations (through 0006)");

    (ks_dir, data_dir, keystore, pool)
}

/// A minimal valid create request (name + DOB present satisfies PAT-001).
fn new_patient(name: &str) -> CreatePatientRequest {
    CreatePatientRequest {
        name: name.to_string(),
        dob: Some("1990-05-01".to_string()),
        mobile: Some("+91 98765 43210".to_string()),
        city: Some("Pune".to_string()),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// PAT-002 — monotonic, never-reused patient code.
// ---------------------------------------------------------------------------

/// PAT-002 (R-TEST-008): the assigned code is monotonic and is NEVER reused,
/// even after a soft delete + restore of the most recent patient. Catches a
/// `max(code)`-style sequence that reissues a freed number.
#[test]
fn pat037_next_code_is_monotonic_and_never_reused_after_delete_and_restore() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let a = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create A");
    let b = svc
        .create(&pool, new_patient("Test Patient 002"))
        .expect("create B");
    assert_ne!(
        a.code, b.code,
        "each patient gets a distinct code (PAT-002)"
    );

    // Soft-delete then restore B; its code must never be handed out again.
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: b.patient_id.clone(),
        },
    )
    .expect("soft delete B");
    svc.restore(
        &pool,
        RestoreRequest {
            patient_id: b.patient_id.clone(),
        },
    )
    .expect("restore B");

    let c = svc
        .create(&pool, new_patient("Test Patient 003"))
        .expect("create C");
    assert_ne!(c.code, a.code, "code C must not reuse A (PAT-002)");
    assert_ne!(
        c.code, b.code,
        "code C must not reuse B after delete+restore (PAT-002)"
    );
}

/// PAT-002 (R-TEST-008): previewing the next code does NOT consume the sequence,
/// so cancelling a new-patient form leaves no gap (S06 open-question). Catches a
/// preview that burns a number.
#[test]
fn pat037_next_code_preview_does_not_consume_the_sequence() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let preview1 = svc.next_code(&pool).expect("preview 1").code;
    let preview2 = svc.next_code(&pool).expect("preview 2").code;
    assert_eq!(
        preview1, preview2,
        "two previews with no create in between return the same code (PAT-002, no gap)"
    );

    let created = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create");
    assert_eq!(
        created.code, preview1,
        "the created code equals the previewed code (sequence consumed on Save only)"
    );
}

// ---------------------------------------------------------------------------
// PAT-004 — duplicate detection (warns, never blocks).
// ---------------------------------------------------------------------------

/// PAT-004 (R-TEST-008): a name + mobile match surfaces the existing patient as
/// a duplicate warning. Catches a silent double registration.
#[test]
fn pat004_check_duplicate_flags_name_plus_mobile_match() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let existing = svc
        .create(&pool, new_patient("Ramesh Kumar"))
        .expect("create existing");

    let resp = svc
        .check_duplicate(
            &pool,
            CheckDuplicateRequest {
                name: "Ramesh Kumar".to_string(),
                mobile: Some("9876543210".to_string()),
                dob: None,
            },
        )
        .expect("check duplicate");
    assert!(
        resp.matches
            .iter()
            .any(|m| m.patient_id == existing.patient_id),
        "name + mobile match must flag the existing patient (PAT-004)"
    );
}

/// PAT-004 (R-TEST-008): a name + DOB match surfaces the existing patient even
/// with no mobile supplied. Catches a mobile-only duplicate check.
#[test]
fn pat004_check_duplicate_flags_name_plus_dob_match() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let existing = svc
        .create(&pool, new_patient("Sita Devi"))
        .expect("create existing");

    let resp = svc
        .check_duplicate(
            &pool,
            CheckDuplicateRequest {
                name: "Sita Devi".to_string(),
                mobile: None,
                dob: Some("1990-05-01".to_string()),
            },
        )
        .expect("check duplicate");
    assert!(
        resp.matches
            .iter()
            .any(|m| m.patient_id == existing.patient_id),
        "name + DOB match must flag the existing patient (PAT-004)"
    );
}

/// PAT-004 / PSR-003 (R-TEST-008): a phonetic Indian-name variant (Sharma vs
/// Sarma) still flags the existing patient on name + mobile. Catches an
/// exact-only duplicate check that misses spelling variants.
#[test]
fn pat004_check_duplicate_flags_phonetic_name_variant() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    // Stored as "Ramesh Sharma"; the receptionist re-types "Ramesh Sarma".
    let mut p = new_patient("Ramesh Sharma");
    p.mobile = Some("98765 00001".to_string());
    let existing = svc.create(&pool, p).expect("create existing");

    let resp = svc
        .check_duplicate(
            &pool,
            CheckDuplicateRequest {
                name: "Ramesh Sarma".to_string(),
                mobile: Some("9876500001".to_string()),
                dob: None,
            },
        )
        .expect("check duplicate");
    assert!(
        resp.matches
            .iter()
            .any(|m| m.patient_id == existing.patient_id),
        "Sharma/Sarma phonetic variant must flag the existing patient (PAT-004, PSR-003)"
    );
}

/// PAT-004 (R-TEST-008): a clearly different patient yields no warning. Catches
/// a false positive that would block a genuine new registration.
#[test]
fn pat004_check_duplicate_returns_empty_for_a_clearly_new_patient() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(&pool, new_patient("Ramesh Kumar"))
        .expect("create existing");

    let resp = svc
        .check_duplicate(
            &pool,
            CheckDuplicateRequest {
                name: "Anjali Verma".to_string(),
                mobile: Some("9000000000".to_string()),
                dob: Some("1975-12-12".to_string()),
            },
        )
        .expect("check duplicate");
    assert!(
        resp.matches.is_empty(),
        "an unrelated patient must NOT be flagged as a duplicate (PAT-004)"
    );
}

// ---------------------------------------------------------------------------
// PAT-001 — create / update, with audit + instant findability.
// ---------------------------------------------------------------------------

/// PAT-001 / R-DATA-001 (R-TEST-008): create persists every supplied field and
/// writes exactly one `audit_log` row for the patient. Catches a dropped field
/// and a missing/duplicate audit row.
#[test]
fn pat001_create_persists_all_fields_and_writes_one_audit_row() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let req = CreatePatientRequest {
        name: "Test Patient 001".to_string(),
        sex: Some("M".to_string()),
        dob: Some("1988-03-15".to_string()),
        mobile: Some("+91 90000 11111".to_string()),
        mobile_alt: Some("90000 22222".to_string()),
        address: Some("1 Test Road".to_string()),
        city: Some("Nagpur".to_string()),
        occupation: Some("Teacher".to_string()),
        marital_status: Some("Married".to_string()),
        blood_group: Some("B+".to_string()),
        referred_by: Some("Dr Rao".to_string()),
        allergies: Some("Penicillin".to_string()),
        ..Default::default()
    };
    let created = svc.create(&pool, req).expect("create patient");

    // Data effects (R-TEST-003): the row read back carries the fields.
    let row = pool
        .with_reader(|c| hc_storage::patient::get_patient(c, &created.patient_id))
        .expect("read patient")
        .expect("patient row must exist after create");
    assert_eq!(row.name, "Test Patient 001");
    assert_eq!(row.sex.as_deref(), Some("M"));
    assert_eq!(row.city.as_deref(), Some("Nagpur"));
    assert_eq!(row.occupation.as_deref(), Some("Teacher"));
    assert_eq!(row.marital_status.as_deref(), Some("Married"));
    assert_eq!(row.blood_group.as_deref(), Some("B+"));
    assert_eq!(row.referred_by.as_deref(), Some("Dr Rao"));
    assert_eq!(row.allergies.as_deref(), Some("Penicillin"));

    // Exactly one audit row for this patient entity (R-DATA-001).
    let audit_count: i64 = pool
        .with_reader(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity = 'patient' AND entity_id = ?1",
                [created.patient_id.as_str()],
                |r| r.get(0),
            )
            .map_err(hc_storage::StorageError::from)
        })
        .expect("count audit rows");
    assert_eq!(
        audit_count, 1,
        "create writes exactly one patient audit row (R-DATA-001)"
    );
}

/// PSR-012 (R-TEST-008): a just-created patient is findable immediately via the
/// real search engine (the normalised columns were populated in-txn so the 0004
/// FTS triggers indexed it). Catches a writer that skips name_norm/phonetic.
#[test]
fn pat001_create_makes_the_patient_findable_immediately_via_search() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Lakshmi Narayan"))
        .expect("create");

    // Search by a name prefix must return the new patient in the SAME pool.
    let page = pool
        .with_reader(|c| hc_search::query::search(c, "lakshmi", None).map_err(to_storage_err))
        .expect("search by name");
    assert!(
        page.hits.iter().any(|h| h.patient_id == created.patient_id),
        "a newly created patient must be findable immediately (PSR-012)"
    );
}

/// PAT-001 (R-TEST-008): a blank name is rejected as a validation error. Catches
/// a required-field bypass.
#[test]
fn pat001_create_rejects_blank_name() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let mut req = new_patient("placeholder");
    req.name = "   ".to_string();
    let err = svc
        .create(&pool, req)
        .expect_err("blank name must be rejected");
    assert!(
        matches!(err, AppError::Validation(_)),
        "a blank name is a validation error, got {err:?}"
    );
}

/// PAT-001 (R-TEST-008): with neither DOB nor age supplied, create is rejected
/// (the "DOB or age, either" rule). Catches a writer that stores an age-less,
/// DOB-less patient.
#[test]
fn pat001_create_rejects_missing_dob_and_age() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let req = CreatePatientRequest {
        name: "Test Patient 001".to_string(),
        dob: None,
        age_years: None,
        ..Default::default()
    };
    let err = svc
        .create(&pool, req)
        .expect_err("missing DOB and age must be rejected");
    assert!(
        matches!(err, AppError::Validation(_)),
        "neither DOB nor age is a validation error (PAT-001), got {err:?}"
    );
}

/// PAT-001 / PSR-012 / R-DATA-001 (R-TEST-008): update changes a field, the
/// search index reflects the NEW name, and exactly one further audit row is
/// written. Catches stale FTS after a rename and a missing update audit row.
#[test]
fn pat001_update_changes_fields_and_search_reflects_the_new_name_plus_one_audit_row() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc.create(&pool, new_patient("Old Name")).expect("create");

    svc.update(
        &pool,
        UpdatePatientRequest {
            patient_id: created.patient_id.clone(),
            name: "New Name".to_string(),
            dob: Some("1990-05-01".to_string()),
            city: Some("Pune".to_string()),
            ..Default::default()
        },
    )
    .expect("update patient");

    let row = pool
        .with_reader(|c| hc_storage::patient::get_patient(c, &created.patient_id))
        .expect("read patient")
        .expect("patient row");
    assert_eq!(row.name, "New Name", "the name field is updated (PAT-001)");

    // Search reflects the new name, not the old (PSR-012: FTS synced in-txn).
    let page_new = pool
        .with_reader(|c| hc_search::query::search(c, "new name", None).map_err(to_storage_err))
        .expect("search new name");
    assert!(
        page_new
            .hits
            .iter()
            .any(|h| h.patient_id == created.patient_id),
        "search finds the patient under the new name (PSR-012)"
    );
    let page_old = pool
        .with_reader(|c| hc_search::query::search(c, "old name", None).map_err(to_storage_err))
        .expect("search old name");
    assert!(
        !page_old
            .hits
            .iter()
            .any(|h| h.patient_id == created.patient_id),
        "search no longer finds the patient under the old name (PSR-012)"
    );

    // Two audit rows total for this patient: one create, one update (R-DATA-001).
    let audit_count: i64 = pool
        .with_reader(|c| {
            c.query_row(
                "SELECT COUNT(*) FROM audit_log WHERE entity = 'patient' AND entity_id = ?1",
                [created.patient_id.as_str()],
                |r| r.get(0),
            )
            .map_err(hc_storage::StorageError::from)
        })
        .expect("count audit rows");
    assert_eq!(
        audit_count, 2,
        "create + update write one audit row each (R-DATA-001)"
    );
}

// ---------------------------------------------------------------------------
// PAT-008 — soft delete / restore / PIN-gated permanent delete.
// ---------------------------------------------------------------------------

/// PAT-008 (R-TEST-008): soft delete returns a 30-day recycle window and the
/// patient leaves normal search. Catches a wrong window and a row that stays
/// visible after deletion.
#[test]
fn pat008_soft_delete_sets_30_day_window_and_patient_leaves_normal_search() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create");

    let resp = svc
        .soft_delete(
            &pool,
            SoftDeleteRequest {
                patient_id: created.patient_id.clone(),
            },
        )
        .expect("soft delete");
    assert_eq!(
        resp.recycle_until, "2026-03-03T00:00:00Z",
        "recycle_until is deleted_at + 30 days (PAT-008)"
    );

    let page = pool
        .with_reader(|c| hc_search::query::search(c, "test patient", None).map_err(to_storage_err))
        .expect("search");
    assert!(
        !page.hits.iter().any(|h| h.patient_id == created.patient_id),
        "a soft-deleted patient must leave normal search (PAT-008)"
    );
}

/// PAT-008 (R-TEST-008): restore clears the recycle flag and the patient is
/// searchable again. Catches a restore that fails to clear `deleted_at`.
#[test]
fn pat008_restore_brings_the_patient_back_into_search() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create");
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: created.patient_id.clone(),
        },
    )
    .expect("soft delete");
    svc.restore(
        &pool,
        RestoreRequest {
            patient_id: created.patient_id.clone(),
        },
    )
    .expect("restore");

    let page = pool
        .with_reader(|c| hc_search::query::search(c, "test patient", None).map_err(to_storage_err))
        .expect("search");
    assert!(
        page.hits.iter().any(|h| h.patient_id == created.patient_id),
        "a restored patient must be searchable again (PAT-008)"
    );
}

/// PAT-008 / R-DATA-003 (R-TEST-008): a wrong PIN refuses permanent delete and
/// the row survives. Catches a bypassed PIN re-verify that would erase data
/// without authorisation.
#[test]
fn pat008_permanent_delete_without_correct_pin_is_refused_and_keeps_the_row() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create");
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: created.patient_id.clone(),
        },
    )
    .expect("soft delete");

    let err = svc
        .permanent_delete(
            &pool,
            PermanentDeleteRequest {
                patient_id: created.patient_id.clone(),
                pin: "0000".to_string(), // wrong PIN
            },
        )
        .expect_err("wrong PIN must refuse permanent delete");
    assert!(
        matches!(err, AppError::WrongPin),
        "a wrong PIN maps to WrongPin (PAT-008), got {err:?}"
    );

    // The row must still exist (soft-deleted), untouched by the refused erase.
    let row = pool
        .with_reader(|c| hc_storage::patient::get_patient_including_deleted(c, &created.patient_id))
        .expect("read patient (incl deleted)");
    assert!(
        row.is_some(),
        "a refused permanent delete must leave the row intact (R-DATA-003)"
    );
}

/// PAT-008 / R-DATA-003 (R-TEST-008): the correct PIN permits the one allowed
/// hard delete; the row is gone. Catches a no-op permanent delete.
#[test]
fn pat008_permanent_delete_with_correct_pin_hard_deletes_the_row() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create");
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: created.patient_id.clone(),
        },
    )
    .expect("soft delete");

    svc.permanent_delete(
        &pool,
        PermanentDeleteRequest {
            patient_id: created.patient_id.clone(),
            pin: TEST_PIN.to_string(),
        },
    )
    .expect("correct PIN permits permanent delete");

    let row = pool
        .with_reader(|c| hc_storage::patient::get_patient_including_deleted(c, &created.patient_id))
        .expect("read patient (incl deleted)");
    assert!(
        row.is_none(),
        "the correct PIN hard-deletes the row (PAT-008, R-DATA-003 exception)"
    );
}

/// PAT-002 / PAT-008 (R-TEST-008): a hard delete must NOT lower the sequence, so
/// a later patient never reuses the erased patient's code. Catches a counter
/// derived from live rows.
#[test]
fn pat002_code_not_reused_even_after_permanent_delete() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let victim = svc
        .create(&pool, new_patient("Test Patient 001"))
        .expect("create victim");
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: victim.patient_id.clone(),
        },
    )
    .expect("soft delete");
    svc.permanent_delete(
        &pool,
        PermanentDeleteRequest {
            patient_id: victim.patient_id.clone(),
            pin: TEST_PIN.to_string(),
        },
    )
    .expect("permanent delete");

    let next = svc
        .create(&pool, new_patient("Test Patient 002"))
        .expect("create next");
    assert_ne!(
        next.code, victim.code,
        "a permanently deleted patient's code is never reused (PAT-002)"
    );
}

// ---------------------------------------------------------------------------
// PAT-006 — family linking visible on the dashboard.
// ---------------------------------------------------------------------------

/// PAT-006 (R-TEST-008): a linked family member shows up in the dashboard's
/// family list. Catches a link that is not stored or not surfaced.
#[test]
fn pat006_link_family_makes_the_member_visible_on_the_dashboard() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let husband = svc
        .create(&pool, new_patient("Ramesh Kumar"))
        .expect("create husband");
    let wife = svc
        .create(&pool, new_patient("Sita Devi"))
        .expect("create wife");

    svc.link_family(
        &pool,
        LinkFamilyRequest {
            patient_id: husband.patient_id.clone(),
            related_patient_id: wife.patient_id.clone(),
            relation: "Wife".to_string(),
            share_address: true,
        },
    )
    .expect("link family");

    let dash = svc
        .get_dashboard(
            &pool,
            GetDashboardRequest {
                patient_id: husband.patient_id.clone(),
            },
        )
        .expect("dashboard");
    assert!(
        dash.family
            .iter()
            .any(|f| f.patient_id == wife.patient_id && f.relation == "Wife"),
        "the linked family member is visible on the dashboard (PAT-006)"
    );
}

// ---------------------------------------------------------------------------
// PAT-005 — dashboard: real demographics + family, honest-empty R2 fields.
// ---------------------------------------------------------------------------

/// PAT-005 / R-DEL-002 (R-TEST-008): the dashboard returns REAL demographics and
/// family while honestly reporting EMPTY visits, no last Rx and zero dues for R2
/// (visits/Rx/billing are R3/R4/R5). Catches fabricated visit data (a dead end)
/// and dropped demographics.
#[test]
fn pat005_dashboard_returns_real_demographics_and_family_and_empty_visits_dues_for_r2() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let mut req = new_patient("Ramesh Kumar");
    req.allergies = Some("Penicillin".to_string());
    let created = svc.create(&pool, req).expect("create");

    let dash = svc
        .get_dashboard(
            &pool,
            GetDashboardRequest {
                patient_id: created.patient_id.clone(),
            },
        )
        .expect("dashboard");

    // Real demographics + alerts.
    assert_eq!(
        dash.demographics.name, "Ramesh Kumar",
        "real name on the dashboard (PAT-005)"
    );
    assert_eq!(dash.demographics.city.as_deref(), Some("Pune"));
    assert_eq!(
        dash.allergies.as_deref(),
        Some("Penicillin"),
        "real alerts banner (PAT-005)"
    );

    // Honest-empty R2 fields (R-DEL-002): no fabricated visits/Rx/dues.
    assert!(
        dash.visits.is_empty(),
        "visits are EMPTY for R2 (R-DEL-002)"
    );
    assert!(
        dash.last_prescription.is_none(),
        "no last Rx for R2 (R-DEL-002)"
    );
    assert_eq!(dash.dues_paise, 0, "dues are zero for R2 (R-DEL-002)");
}

// ---------------------------------------------------------------------------
// PAT-011 — single-patient export.
// ---------------------------------------------------------------------------

/// PAT-011 (R-TEST-008): JSON export writes a file that contains the patient's
/// fields and an empty visits list (visits are R3). Catches an export missing
/// the patient record or fabricating visit data.
#[test]
fn pat011_export_json_contains_the_patient_fields_and_empty_visits() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(&pool, new_patient("Ramesh Kumar"))
        .expect("create");

    let resp = svc
        .export_json(
            &pool,
            ExportRequest {
                patient_id: created.patient_id.clone(),
            },
        )
        .expect("export json");
    let body = std::fs::read_to_string(&resp.file_path).expect("export file must exist");
    let json: serde_json::Value = serde_json::from_str(&body).expect("export is valid JSON");

    assert_eq!(
        json["patient"]["name"].as_str(),
        Some("Ramesh Kumar"),
        "the JSON export contains the patient's name (PAT-011)"
    );
    assert_eq!(
        json["patient"]["code"].as_str(),
        Some(created.code.as_str()),
        "the JSON export contains the patient's code (PAT-011)"
    );
    assert!(
        json["visits"]
            .as_array()
            .map(|a| a.is_empty())
            .unwrap_or(false),
        "visits are present but EMPTY for R2 (PAT-011, R-DEL-002)"
    );
}

/// Adapt a `SearchError` to a `StorageError` so `with_reader` closures can run
/// the real search engine inside the pool. (Search normally runs on its own
/// reader; here we only need a Connection, which `with_reader` provides.)
fn to_storage_err(_e: hc_search::SearchError) -> hc_storage::StorageError {
    hc_storage::StorageError::Key
}
