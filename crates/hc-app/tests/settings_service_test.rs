//! MS (S18 Settings) use-case tests: `SettingsService::{get, save_general}`
//! (SET-002/003/004/005/007, PAT-002, LIC-006, ADM-001; design §3.1) and the
//! four new error codes (design §1.3).
//!
//! CUT: the REAL `hc_app::settings::SettingsService` over a REAL migrated
//! SQLCipher temp DB seeded with one synthetic doctor + clinic
//! (`hc_storage::testing::seeded_data_dir`), and the REAL `PatientService` for
//! the prefix behaviour. Dependency fakes only (R-TEST-002): a fixed clock and
//! `FakeIdentityLock(bool)` standing in for the R8 licence guard. Synthetic
//! data only (R-TEST-004). Each test asserts data effects (R-TEST-003).

use hc_app::clock::Clock;
use hc_app::error::{map_error, AppError, ErrorCode};
use hc_app::patient::{CreatePatientRequest, PatientService};
use hc_app::settings::{
    AppPrefs, CameraChoice, ClinicSettings, DoctorSettings, IdentityLock,
    SaveGeneralSettingsRequest, SettingsService,
};
use hc_app::setup::FontSize;
use hc_storage::profile::{get_clinic_profile, get_doctor_profile};
use hc_storage::relocate::TargetProblem;
use hc_storage::testing::{seeded_data_dir, temp_file_keystore};
use hc_storage::{Pool, StorageError};

struct FixedClock;
impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        "2026-11-04T12:00:00Z".to_string()
    }
}

/// Dependency fake for the LIC-006 guard (R8 fills in the real one).
struct FakeIdentityLock(bool);
impl IdentityLock for FakeIdentityLock {
    fn is_locked(&self, _pool: &Pool) -> Result<bool, AppError> {
        Ok(self.0)
    }
}

const UNLOCKED: FakeIdentityLock = FakeIdentityLock(false);
const LOCKED: FakeIdentityLock = FakeIdentityLock(true);

/// The seeded values, as the S18 form would send them unchanged.
fn base_request() -> SaveGeneralSettingsRequest {
    SaveGeneralSettingsRequest {
        doctor: DoctorSettings {
            name: "Test Doctor 001".to_string(),
            qualification: "BHMS".to_string(),
            reg_no: "TESTREG-001".to_string(),
            reg_council: "Test Council".to_string(),
            phone: None,
            email: None,
        },
        clinic: ClinicSettings {
            name: "Test Clinic 001".to_string(),
            address: "1 Test Street".to_string(),
            timings: None,
            gstin: None,
            fee_first_paise: 50_000,
            fee_followup_paise: 30_000,
            upi_vpa: None,
        },
        app: AppPrefs {
            id_prefix: "HC-".to_string(),
            autolock_minutes: 15,
            font_size: FontSize::Normal,
            default_camera: None,
        },
    }
}

fn audit_count(pool: &Pool) -> i64 {
    pool.with_reader(|c| Ok(c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))?))
        .expect("count audit rows")
}

fn settings_audit_count(pool: &Pool) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT COUNT(*) FROM audit_log WHERE entity = 'settings' AND entity_id = 'general'",
            [],
            |r| r.get(0),
        )?)
    })
    .expect("count settings audit rows")
}

/// Assert `req` is refused with `Validation` and nothing was written.
fn assert_rejected(pool: &Pool, dir: &std::path::Path, req: SaveGeneralSettingsRequest, why: &str) {
    let clock = FixedClock;
    let before = audit_count(pool);
    let doctor = pool.with_reader(get_doctor_profile).unwrap();
    let clinic = pool.with_reader(get_clinic_profile).unwrap();
    let r = SettingsService::new(&clock, &UNLOCKED).save_general(pool, dir, req);
    assert!(
        matches!(r, Err(AppError::Validation(_))),
        "{why}: expected Validation, got {r:?}"
    );
    assert_eq!(audit_count(pool), before, "{why}: no audit row");
    assert_eq!(
        pool.with_reader(get_doctor_profile).unwrap(),
        doctor,
        "{why}"
    );
    assert_eq!(
        pool.with_reader(get_clinic_profile).unwrap(),
        clinic,
        "{why}"
    );
}

/// Assert `req` is accepted (boundary values).
fn assert_accepted(pool: &Pool, dir: &std::path::Path, req: SaveGeneralSettingsRequest, why: &str) {
    let clock = FixedClock;
    let r = SettingsService::new(&clock, &UNLOCKED).save_general(pool, dir, req);
    assert!(r.is_ok(), "{why}: expected Ok, got {r:?}");
}

// ---------------------------------------------------------------------------
// get
// ---------------------------------------------------------------------------

/// Bug caught: S18 opens with wrong current values or wrong defaults (fees,
/// prefix, next number, autolock 15, Normal, system camera, unlocked).
#[test]
fn set002_get_returns_current_profiles_fees_prefix_and_defaults() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let view = SettingsService::new(&clock, &UNLOCKED)
        .get(&pool, dir.path())
        .expect("settings_get");

    let base = base_request();
    assert_eq!(view.doctor, base.doctor);
    assert_eq!(view.clinic, base.clinic);
    assert_eq!(view.app, base.app);
    assert_eq!(view.next_number, "000001");
    assert_eq!(view.data_folder, dir.path().display().to_string());
    assert!(!view.identity_locked);
}

/// LIC-006 bug caught: the UI is told identity is editable while a licence
/// binds it (or the reverse).
#[test]
fn lic006_get_reports_identity_locked_from_the_guard() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let view = SettingsService::new(&clock, &LOCKED)
        .get(&pool, dir.path())
        .expect("settings_get");
    assert!(view.identity_locked);
}

/// LIC-006 (MS): with no licence import before R8 the production guard
/// reports unlocked, so a trial doctor can still fix a typo in their name.
#[test]
fn lic006_licence_identity_lock_reports_unlocked_in_ms() {
    let (_dir, pool, _) = seeded_data_dir();
    let locked = hc_app::settings::LicenceIdentityLock
        .is_locked(&pool)
        .expect("guard read");
    assert!(!locked);
}

// ---------------------------------------------------------------------------
// save_general: persist + one audit row
// ---------------------------------------------------------------------------

/// Bug caught: some edited field is not saved, the save writes several audit
/// rows, or the response does not reflect the stored values.
#[test]
fn set002_save_general_persists_every_field_with_exactly_one_audit_row() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let svc = SettingsService::new(&clock, &UNLOCKED);
    let before = audit_count(&pool);

    let mut req = base_request();
    req.doctor.name = "Test Doctor 002".to_string();
    req.doctor.qualification = "MD (Hom)".to_string();
    req.doctor.reg_no = "TESTREG-002".to_string();
    req.doctor.reg_council = "Other Test Council".to_string();
    req.doctor.phone = Some("9876500001".to_string());
    req.doctor.email = Some("doctor001@example.test".to_string());
    req.clinic.name = "Test Clinic 002".to_string();
    req.clinic.address = "2 Test Road".to_string();
    req.clinic.timings = Some("Morning 9:00 AM - 1:00 PM".to_string());
    req.clinic.gstin = Some("27AAAAA0000A1Z5".to_string());
    req.clinic.fee_first_paise = 75_000;
    req.clinic.fee_followup_paise = 40_000;
    req.app.autolock_minutes = 30;
    req.app.font_size = FontSize::Large;
    req.app.default_camera = Some(CameraChoice {
        device_id: "cam-2".to_string(),
        label: "Test Camera 2".to_string(),
    });

    let resp = svc
        .save_general(&pool, dir.path(), req.clone())
        .expect("save ok");

    assert!(resp.changed);
    assert_eq!(resp.settings.doctor, req.doctor);
    assert_eq!(resp.settings.clinic, req.clinic);
    assert_eq!(resp.settings.app, req.app);
    let fresh = svc.get(&pool, dir.path()).expect("re-read");
    assert_eq!(fresh, resp.settings, "values match on reopen");
    assert_eq!(audit_count(&pool), before + 1, "one save = one audit row");
    assert_eq!(settings_audit_count(&pool), 1);
}

/// Bug caught: "phone asked once" only updates the doctor, so prints still
/// show the old clinic phone.
#[test]
fn set003_save_general_saves_the_single_phone_as_doctor_and_clinic_phone() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let mut req = base_request();
    req.doctor.phone = Some(" 9876500002 ".to_string());
    SettingsService::new(&clock, &UNLOCKED)
        .save_general(&pool, dir.path(), req)
        .expect("save ok");

    let doctor = pool.with_reader(get_doctor_profile).unwrap().unwrap();
    let clinic = pool.with_reader(get_clinic_profile).unwrap().unwrap();
    assert_eq!(doctor.phone.as_deref(), Some("9876500002"), "trimmed");
    assert_eq!(clinic.phone.as_deref(), Some("9876500002"), "same phone");
}

/// Bug caught: Save with nothing changed writes an audit row.
#[test]
fn set002_save_general_with_no_change_writes_nothing() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let before = audit_count(&pool);
    let resp = SettingsService::new(&clock, &UNLOCKED)
        .save_general(&pool, dir.path(), base_request())
        .expect("save ok");
    assert!(!resp.changed);
    assert_eq!(audit_count(&pool), before);
}

/// PAT-002 bug caught: a prefix change rewrites existing patient codes, or new
/// patients keep the old prefix, or the number restarts.
#[test]
fn pat002_save_general_new_prefix_is_used_by_the_next_patient_and_old_codes_are_unchanged() {
    let (dir, pool, _) = seeded_data_dir();
    let (_ks_dir, keystore) = temp_file_keystore();
    let clock = FixedClock;
    let patients = PatientService::new(&keystore, &clock, dir.path());
    let patient = |name: &str| CreatePatientRequest {
        name: name.to_string(),
        sex: Some("F".to_string()),
        age_years: Some(40),
        ..Default::default()
    };
    let first = patients
        .create(&pool, patient("Test Patient 001"))
        .expect("create first");
    assert_eq!(first.code, "HC-000001");

    let mut req = base_request();
    req.app.id_prefix = "kc-".to_string();
    let resp = SettingsService::new(&clock, &UNLOCKED)
        .save_general(&pool, dir.path(), req)
        .expect("save ok");
    assert_eq!(resp.settings.app.id_prefix, "KC-", "prefix is uppercased");
    assert_eq!(resp.settings.next_number, "000002");

    let second = patients
        .create(&pool, patient("Test Patient 002"))
        .expect("create second");
    assert_eq!(second.code, "KC-000002");
    let first_code: String = pool
        .with_reader(|c| {
            Ok(c.query_row(
                "SELECT code FROM patient WHERE id = ?1",
                [&first.patient_id],
                |r| r.get(0),
            )?)
        })
        .unwrap();
    assert_eq!(first_code, "HC-000001", "existing code never rewritten");
}

// ---------------------------------------------------------------------------
// save_general: validation
// ---------------------------------------------------------------------------

/// Bug caught: a negative fee (typo) is stored and later printed on bills.
#[test]
fn set003_save_general_rejects_negative_fees() {
    let (dir, pool, _) = seeded_data_dir();
    let mut a = base_request();
    a.clinic.fee_first_paise = -1;
    assert_rejected(&pool, dir.path(), a, "negative consultation fee");
    let mut b = base_request();
    b.clinic.fee_followup_paise = -1;
    assert_rejected(&pool, dir.path(), b, "negative follow-up fee");
}

/// Bug caught: an extra-zeros typo above Rs 10 lakh is accepted; or a free
/// consultation (0) / the cap itself is refused.
#[test]
fn set003_save_general_fee_boundaries_zero_and_cap_ok_above_cap_rejected() {
    let (dir, pool, _) = seeded_data_dir();
    let mut over = base_request();
    over.clinic.fee_first_paise = 100_000_001;
    assert_rejected(&pool, dir.path(), over, "consult fee above cap");
    let mut over_f = base_request();
    over_f.clinic.fee_followup_paise = 100_000_001;
    assert_rejected(&pool, dir.path(), over_f, "follow-up fee above cap");

    let mut zero = base_request();
    zero.clinic.fee_first_paise = 0;
    zero.clinic.fee_followup_paise = 0;
    assert_accepted(&pool, dir.path(), zero, "zero fees");
    let mut cap = base_request();
    cap.clinic.fee_first_paise = 100_000_000;
    cap.clinic.fee_followup_paise = 100_000_000;
    assert_accepted(&pool, dir.path(), cap, "fees at the cap");
}

/// Bug caught: a blank required field (name, reg no, clinic address ...) is
/// saved and prints on documents.
#[test]
fn set002_save_general_rejects_blank_required_fields() {
    let (dir, pool, _) = seeded_data_dir();
    type Edit = fn(&mut SaveGeneralSettingsRequest);
    let cases: [(&str, Edit); 6] = [
        ("doctor name", |r| r.doctor.name = "  ".to_string()),
        ("qualification", |r| r.doctor.qualification = String::new()),
        ("reg no", |r| r.doctor.reg_no = " ".to_string()),
        ("council", |r| r.doctor.reg_council = String::new()),
        ("clinic name", |r| r.clinic.name = String::new()),
        ("clinic address", |r| r.clinic.address = "\t".to_string()),
    ];
    for (why, edit) in cases {
        let mut req = base_request();
        edit(&mut req);
        assert_rejected(&pool, dir.path(), req, why);
    }
}

/// PAT-002 / A9 bug caught: a prefix that makes codes ambiguous (ends in a
/// digit), has spaces / symbols / non-ASCII, or is too long is accepted.
#[test]
fn pat002_save_general_validates_the_id_prefix() {
    let (dir, pool, _) = seeded_data_dir();
    for bad in ["", "   ", "HC1", "H C", "HC_", "ABCDEFG", "डॉ-"] {
        let mut req = base_request();
        req.app.id_prefix = bad.to_string();
        assert_rejected(&pool, dir.path(), req, &format!("prefix {bad:?}"));
    }
    for good in ["A", "ABCDEF", "AB12C", "K-"] {
        let mut req = base_request();
        req.app.id_prefix = good.to_string();
        assert_accepted(&pool, dir.path(), req, &format!("prefix {good:?}"));
    }
}

/// SET-004 / A10 bug caught: auto-lock 0 (never locks) or an absurd value is
/// stored; the range ends 1 and 120 are refused.
#[test]
fn set004_save_general_enforces_the_autolock_range() {
    let (dir, pool, _) = seeded_data_dir();
    for bad in [0u16, 121] {
        let mut req = base_request();
        req.app.autolock_minutes = bad;
        assert_rejected(&pool, dir.path(), req, &format!("autolock {bad}"));
    }
    for good in [1u16, 120] {
        let mut req = base_request();
        req.app.autolock_minutes = good;
        assert_accepted(&pool, dir.path(), req, &format!("autolock {good}"));
    }
}

/// SET-007 bug caught: an empty or oversized camera id/label from a broken
/// webview is stored.
#[test]
fn set007_save_general_validates_the_camera_choice() {
    let (dir, pool, _) = seeded_data_dir();
    let cam = |id: usize, label: usize| CameraChoice {
        device_id: "d".repeat(id),
        label: "l".repeat(label),
    };
    for (why, c) in [
        ("empty id", cam(0, 4)),
        ("id 513", cam(513, 4)),
        ("label 257", cam(8, 257)),
    ] {
        let mut req = base_request();
        req.app.default_camera = Some(c);
        assert_rejected(&pool, dir.path(), req, why);
    }
    let mut ok = base_request();
    ok.app.default_camera = Some(cam(512, 256));
    assert_accepted(&pool, dir.path(), ok, "id 512 + label 256");
    let mut unnamed = base_request();
    unnamed.app.default_camera = Some(cam(8, 0));
    assert_accepted(&pool, dir.path(), unnamed, "unnamed camera");
}

// ---------------------------------------------------------------------------
// save_general: identity lock (LIC-006)
// ---------------------------------------------------------------------------

/// LIC-006 bug caught: a licensed doctor can change the printed name /
/// registration number / council (licence binding defeated).
#[test]
fn lic006_save_general_refuses_identity_changes_while_locked_and_writes_nothing() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    type Edit = fn(&mut SaveGeneralSettingsRequest);
    let cases: [(&str, Edit); 3] = [
        ("name", |r| r.doctor.name = "Test Doctor 999".to_string()),
        ("reg no", |r| r.doctor.reg_no = "TESTREG-999".to_string()),
        ("council", |r| {
            r.doctor.reg_council = "Changed Council".to_string()
        }),
    ];
    for (why, edit) in cases {
        let before = audit_count(&pool);
        let mut req = base_request();
        req.clinic.fee_first_paise = 60_000; // also an allowed edit
        edit(&mut req);
        let r = SettingsService::new(&clock, &LOCKED).save_general(&pool, dir.path(), req);
        assert!(
            matches!(r, Err(AppError::IdentityLocked)),
            "{why}: expected IdentityLocked, got {r:?}"
        );
        assert_eq!(audit_count(&pool), before, "{why}: nothing written");
        let clinic = pool.with_reader(get_clinic_profile).unwrap().unwrap();
        assert_eq!(clinic.fee_first_paise, 50_000, "{why}: no partial save");
    }
}

/// LIC-006 bug caught: the lock blocks every edit (the clinic stays editable),
/// or untrimmed identical identity values are treated as a change.
#[test]
fn lic006_save_general_allows_other_edits_while_locked_when_identity_is_unchanged() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let mut req = base_request();
    req.doctor.name = " Test Doctor 001 ".to_string();
    req.doctor.qualification = "MD (Hom)".to_string();
    req.clinic.fee_first_paise = 60_000;
    let resp = SettingsService::new(&clock, &LOCKED)
        .save_general(&pool, dir.path(), req)
        .expect("allowed while locked");
    assert!(resp.changed);
    let doctor = pool.with_reader(get_doctor_profile).unwrap().unwrap();
    assert_eq!(doctor.name, "Test Doctor 001");
    assert_eq!(doctor.qualification, "MD (Hom)");
}

// ---------------------------------------------------------------------------
// Error codes (design §1.3)
// ---------------------------------------------------------------------------

/// Bug caught: the UI cannot tell the MS failures apart (wrong inline / banner
/// / route-to-lock), or a message leaks a path.
#[test]
fn set002_ms_errors_map_to_distinct_codes_with_safe_messages() {
    for (err, code) in [
        (AppError::IdentityLocked, ErrorCode::IdentityLocked),
        (AppError::DataFolderInvalid, ErrorCode::DataFolderInvalid),
        (
            AppError::DataFolderMoveFailed,
            ErrorCode::DataFolderMoveFailed,
        ),
        (
            AppError::DataFolderReopenFailed,
            ErrorCode::DataFolderReopenFailed,
        ),
    ] {
        let ufe = map_error(&err);
        assert_eq!(ufe.code, code, "{err:?}");
        assert!(!ufe.message.is_empty() && !ufe.suggested_action.is_empty());
        assert!(!ufe.message.contains('/') && !ufe.message.contains("clinic.db"));
    }
}

/// Bug caught: relocation storage errors surface as a generic "something went
/// wrong" instead of the inline invalid-folder / moved-nothing messages.
#[test]
fn set006_relocate_storage_errors_map_to_data_folder_errors() {
    let invalid = AppError::from(StorageError::RelocateTarget(TargetProblem::NotEmpty));
    assert!(
        matches!(invalid, AppError::DataFolderInvalid),
        "got {invalid:?}"
    );
    let failed = AppError::from(StorageError::RelocateCopyFailed);
    assert!(
        matches!(failed, AppError::DataFolderMoveFailed),
        "got {failed:?}"
    );
}

// ---------------------------------------------------------------------------
// R5 (BILL-005, HC-MVP1-151): clinic UPI ID in the same single-audit Save
// (R5 design §6.3 "Settings delta").
// ---------------------------------------------------------------------------

/// Bug caught: the clinic UPI ID is not saved (no QR ever shows), is saved
/// with stray spaces, or the save writes more than one audit row.
#[test]
fn r5_save_general_persists_the_clinic_upi_id_trimmed_with_one_audit_row() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let svc = SettingsService::new(&clock, &UNLOCKED);
    let before = settings_audit_count(&pool);

    let mut req = base_request();
    req.clinic.upi_vpa = Some("  testclinic@upi ".to_string());
    let resp = svc.save_general(&pool, dir.path(), req).expect("save ok");
    assert!(resp.changed);
    assert_eq!(
        resp.settings.clinic.upi_vpa.as_deref(),
        Some("testclinic@upi")
    );
    assert_eq!(
        settings_audit_count(&pool),
        before + 1,
        "exactly one audit row"
    );

    let view = svc.get(&pool, dir.path()).expect("get");
    assert_eq!(
        view.clinic.upi_vpa.as_deref(),
        Some("testclinic@upi"),
        "read back after reload"
    );
}

/// Bug caught: clearing the UPI ID leaves the old one stored (QR keeps
/// showing a VPA the doctor removed).
#[test]
fn r5_save_general_clears_the_clinic_upi_id_on_none() {
    let (dir, pool, _) = seeded_data_dir();
    let clock = FixedClock;
    let svc = SettingsService::new(&clock, &UNLOCKED);
    let mut req = base_request();
    req.clinic.upi_vpa = Some("testclinic@upi".to_string());
    svc.save_general(&pool, dir.path(), req.clone())
        .expect("set");
    assert_eq!(
        svc.get(&pool, dir.path())
            .unwrap()
            .clinic
            .upi_vpa
            .as_deref(),
        Some("testclinic@upi"),
        "precondition: stored"
    );

    req.clinic.upi_vpa = None;
    svc.save_general(&pool, dir.path(), req).expect("clear");
    assert_eq!(svc.get(&pool, dir.path()).unwrap().clinic.upi_vpa, None);
}

/// Bug caught: a malformed UPI ID is saved and every QR is unpayable.
#[test]
fn r5_save_general_rejects_a_malformed_clinic_upi_id() {
    let (dir, pool, _) = seeded_data_dir();
    for bad in ["testclinic", "test clinic@upi", "a@upi"] {
        let mut req = base_request();
        req.clinic.upi_vpa = Some(bad.to_string());
        assert_rejected(&pool, dir.path(), req, bad);
    }
}
