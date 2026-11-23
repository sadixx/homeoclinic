//! MS (S18 Settings) storage tests: the General settings record read and its
//! one-transaction-one-audit write (SET-002/003/004/005/007, PAT-002,
//! R-DATA-001; design §2.2).
//!
//! CUT: `hc_storage::settings::{read_general, write_general, peek_next_seq,
//! read_autolock_minutes}` over a REAL migrated SQLCipher temp DB
//! (`hc_storage::testing::{temp_db, seeded_data_dir}`). The patient-code path is
//! the REAL `patient::next_patient_code`. Nothing in the CUT is faked.
//! Synthetic data only (R-TEST-004). Each test asserts data effects
//! (R-TEST-003).

use hc_storage::patient::next_patient_code;
use hc_storage::profile::put_setting;
use hc_storage::settings::{
    peek_next_seq, read_autolock_minutes, read_general, write_general, GeneralSettingsRecord,
};
use hc_storage::testing::{seed_patient, seeded_data_dir, temp_db};
use hc_storage::Pool;

const T1: &str = "2026-11-04T10:00:00Z";
const T2: &str = "2026-11-04T11:00:00Z";

fn general(pool: &Pool) -> GeneralSettingsRecord {
    pool.with_reader(read_general)
        .expect("read_general")
        .expect("profiles exist")
}

/// Run `write_general(old, new)` in ONE committed transaction.
fn write(pool: &Pool, old: &GeneralSettingsRecord, new: &GeneralSettingsRecord) -> bool {
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let changed = write_general(&tx, old, new, T2)?;
        tx.commit()?;
        Ok(changed)
    })
    .expect("write_general")
}

fn audit_count(pool: &Pool) -> i64 {
    pool.with_reader(|c| Ok(c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))?))
        .expect("count audit rows")
}

/// (entity, entity_id, action, diff_json) of the single `settings` audit row
/// (the seed writes only doctor_profile / clinic_profile rows).
fn last_audit(pool: &Pool) -> (String, String, String, serde_json::Value) {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT entity, entity_id, action, diff_json FROM audit_log \
             WHERE entity = 'settings'",
            [],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, String>(3)?,
                ))
            },
        )?)
    })
    .map(|(e, id, a, d)| (e, id, a, serde_json::from_str(&d).expect("diff json")))
    .expect("read last audit row")
}

/// (created_at, updated_at, row_version) of a profile table's only row.
fn row_meta(pool: &Pool, table: &str) -> (String, String, i64) {
    let sql = format!("SELECT created_at, updated_at, row_version FROM {table} LIMIT 1");
    pool.with_reader(|c| Ok(c.query_row(&sql, [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?))
        .expect("read row meta")
}

fn setting(pool: &Pool, key: &str) -> Option<String> {
    pool.with_reader(|c| hc_storage::profile::get_setting(c, key))
        .expect("get_setting")
}

fn put(pool: &Pool, key: &str, value_json: &str) {
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        put_setting(&tx, key, value_json, T1)?;
        tx.commit()?;
        Ok(())
    })
    .expect("put_setting");
}

fn assign_code(pool: &Pool) -> String {
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let code = next_patient_code(&tx, T1)?;
        tx.commit()?;
        Ok(code)
    })
    .expect("next_patient_code")
}

fn patient_codes(pool: &Pool) -> Vec<String> {
    pool.with_reader(|c| {
        let mut st = c.prepare("SELECT code FROM patient ORDER BY code")?;
        let v = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    })
    .expect("list codes")
}

// ---------------------------------------------------------------------------
// read_general / peek / autolock
// ---------------------------------------------------------------------------

/// Bug caught: S18 opened before setup (no profile) crashes or shows blanks
/// as if saved, instead of "nothing to edit".
#[test]
fn set002_read_general_is_none_before_profiles_exist() {
    let (_dir, pool) = temp_db();
    let rec = pool.with_reader(read_general).expect("read_general");
    assert!(
        rec.is_none(),
        "no doctor/clinic profile -> None, got {rec:?}"
    );
}

/// Bug caught: S18 shows wrong current values (fees, prefix) or wrong
/// defaults for keys setup never wrote (autolock 15, Normal, system camera).
#[test]
fn set003_read_general_returns_profiles_prefix_and_defaults() {
    let (_dir, pool, (doctor_id, clinic_id)) = seeded_data_dir();
    let rec = general(&pool);
    assert_eq!(rec.doctor.id, doctor_id);
    assert_eq!(rec.doctor.name, "Test Doctor 001");
    assert_eq!(rec.clinic.id, clinic_id);
    assert_eq!(rec.clinic.fee_first_paise, 50_000);
    assert_eq!(rec.clinic.fee_followup_paise, 30_000);
    assert_eq!(rec.id_prefix, "HC-");
    assert_eq!(rec.autolock_minutes, 15, "absent key defaults to 15");
    assert_eq!(rec.font_size, "normal", "absent key defaults to normal");
    assert_eq!(rec.default_camera_json, None);
}

/// Bug caught: the values setup persisted (autolock "30", font "\"large\"")
/// are not read back, so S18 shows defaults after relaunch.
#[test]
fn set004_read_general_reads_persisted_autolock_font_and_camera() {
    let (_dir, pool, _) = seeded_data_dir();
    put(&pool, "autolock_minutes", "30");
    put(&pool, "font_size", "\"large\"");
    put(
        &pool,
        "default_camera",
        r#"{"deviceId":"cam-2","label":"Test Camera 2"}"#,
    );
    let rec = general(&pool);
    assert_eq!(rec.autolock_minutes, 30);
    assert_eq!(rec.font_size, "large");
    let cam: serde_json::Value =
        serde_json::from_str(rec.default_camera_json.as_deref().expect("camera set"))
            .expect("camera json");
    assert_eq!(cam["deviceId"], "cam-2");
    assert_eq!(cam["label"], "Test Camera 2");
}

/// Bug caught (F5): unlock cannot restore the saved auto-lock because the
/// reader ignores the key or misparses it.
#[test]
fn set004_read_autolock_minutes_is_none_when_unset_and_the_value_when_set() {
    let (_dir, pool) = temp_db();
    assert_eq!(pool.with_reader(read_autolock_minutes).unwrap(), None);
    put(&pool, "autolock_minutes", "15");
    assert_eq!(pool.with_reader(read_autolock_minutes).unwrap(), Some(15));
    put(&pool, "autolock_minutes", "30");
    assert_eq!(pool.with_reader(read_autolock_minutes).unwrap(), Some(30));
}

/// Bug caught: the S18 "Next ID" preview consumes the sequence (gaps) or shows
/// the wrong number.
#[test]
fn pat002_peek_next_seq_reports_next_number_without_consuming_it() {
    let (_dir, pool) = temp_db();
    assert_eq!(pool.with_reader(peek_next_seq).unwrap(), 1);
    assert_eq!(
        pool.with_reader(peek_next_seq).unwrap(),
        1,
        "peek never bumps"
    );
    assert_eq!(assign_code(&pool), "HC-000001");
    assert_eq!(pool.with_reader(peek_next_seq).unwrap(), 2);
}

// ---------------------------------------------------------------------------
// write_general: persist + one audit row
// ---------------------------------------------------------------------------

/// Bug caught: a Save rewrites the profiles with INSERT OR REPLACE (new
/// created_at, row_version reset), writes several audit rows, or audits
/// unchanged fields (R-DATA-001, design F3).
#[test]
fn set002_write_general_updates_in_place_and_writes_exactly_one_audit_row_with_changed_keys() {
    let (_dir, pool, (doctor_id, clinic_id)) = seeded_data_dir();
    let old = general(&pool);
    let (doc_created, _, doc_ver) = row_meta(&pool, "doctor_profile");
    let (cli_created, _, cli_ver) = row_meta(&pool, "clinic_profile");
    let audits_before = audit_count(&pool);

    let mut new = old.clone();
    new.doctor.qualification = "MD (Hom)".to_string();
    new.clinic.fee_first_paise = 75_000;
    let changed = write(&pool, &old, &new);

    assert!(changed, "a real change reports changed = true");
    let back = general(&pool);
    assert_eq!(back, new, "every edited value reads back");
    assert_eq!(back.doctor.id, doctor_id, "doctor row keeps its id");
    assert_eq!(back.clinic.id, clinic_id, "clinic row keeps its id");

    let (doc_created2, doc_updated2, doc_ver2) = row_meta(&pool, "doctor_profile");
    assert_eq!(doc_created2, doc_created, "created_at is kept");
    assert_eq!(doc_updated2, T2, "updated_at = now");
    assert_eq!(doc_ver2, doc_ver + 1, "row_version bumps by one");
    let (cli_created2, _, cli_ver2) = row_meta(&pool, "clinic_profile");
    assert_eq!(cli_created2, cli_created);
    assert_eq!(cli_ver2, cli_ver + 1);

    assert_eq!(
        audit_count(&pool),
        audits_before + 1,
        "exactly one audit row"
    );
    let (entity, entity_id, action, diff) = last_audit(&pool);
    assert_eq!(
        (entity.as_str(), entity_id.as_str(), action.as_str()),
        ("settings", "general", "update")
    );
    let mut keys: Vec<&str> = diff
        .as_object()
        .expect("diff object")
        .keys()
        .map(String::as_str)
        .collect();
    keys.sort_unstable();
    assert_eq!(keys, vec!["clinic.fee_first_paise", "doctor.qualification"]);
    assert_eq!(diff["clinic.fee_first_paise"]["old"], 50_000);
    assert_eq!(diff["clinic.fee_first_paise"]["new"], 75_000);
}

/// Bug caught: a Save with nothing changed still writes rows and an audit
/// entry (audit-log noise, row_version churn).
#[test]
fn set002_write_general_with_no_change_writes_nothing() {
    let (_dir, pool, _) = seeded_data_dir();
    let old = general(&pool);
    let meta_before = row_meta(&pool, "doctor_profile");
    let audits_before = audit_count(&pool);

    let changed = write(&pool, &old, &old.clone());

    assert!(!changed, "no difference -> changed = false");
    assert_eq!(audit_count(&pool), audits_before, "no audit row");
    assert_eq!(
        row_meta(&pool, "doctor_profile"),
        meta_before,
        "row untouched"
    );
}

/// Bug caught: app prefs (autolock, font size, camera) are not persisted by
/// the Save, or "System default" leaves the old camera stored.
#[test]
fn set007_write_general_persists_app_prefs_and_clears_camera_on_none() {
    let (_dir, pool, _) = seeded_data_dir();
    let old = general(&pool);
    let mut new = old.clone();
    new.autolock_minutes = 30;
    new.font_size = "xlarge".to_string();
    new.default_camera_json = Some(r#"{"deviceId":"cam-1","label":"Test Camera 1"}"#.to_string());
    assert!(write(&pool, &old, &new));

    assert_eq!(setting(&pool, "autolock_minutes").as_deref(), Some("30"));
    assert_eq!(setting(&pool, "font_size").as_deref(), Some("\"xlarge\""));
    assert!(setting(&pool, "default_camera").is_some(), "camera stored");
    assert_eq!(general(&pool), new);

    let mut sys_default = new.clone();
    sys_default.default_camera_json = None;
    assert!(write(&pool, &new, &sys_default));
    assert_eq!(
        setting(&pool, "default_camera"),
        None,
        "key removed on None"
    );
    assert_eq!(general(&pool).default_camera_json, None);
}

/// PAT-002 bug caught: changing the prefix rewrites existing patient codes, or
/// new codes keep the old prefix, or the running number restarts (duplicates).
#[test]
fn pat002_write_general_prefix_change_applies_to_new_codes_only_and_keeps_counting() {
    let (_dir, pool, _) = seeded_data_dir();
    let first = assign_code(&pool);
    assert_eq!(first, "HC-000001");
    seed_patient(&pool, &first, "Test Patient 001");

    let old = general(&pool);
    let mut new = old.clone();
    new.id_prefix = "KC-".to_string();
    assert!(write(&pool, &old, &new));

    assert_eq!(general(&pool).id_prefix, "KC-");
    assert_eq!(
        patient_codes(&pool),
        vec!["HC-000001".to_string()],
        "existing code is never rewritten"
    );
    assert_eq!(
        assign_code(&pool),
        "KC-000002",
        "new prefix, counter continues"
    );
}
