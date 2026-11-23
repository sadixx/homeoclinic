//! MS (S18 Settings) data-folder relocation engine tests (SET-006, ADR 0020;
//! design §2.3).
//!
//! CUT: `hc_storage::relocate::{plan_target, copy_verified, copy_verified_with,
//! retire_old}` over REAL temp folders (`tempfile`), a REAL encrypted
//! `clinic.db` (`testing::seeded_data_dir`) and a REAL file keystore record
//! (`KeyHierarchy::initialize`). The only fake is a wrong-key `KeyProvider`
//! (dependency) and the `copy_verified_with` hook that corrupts one copied file
//! (the design's test seam). Synthetic data only (R-TEST-004).

use std::path::{Path, PathBuf};

use hc_storage::key::{KeyHierarchy, KeyProvider};
use hc_storage::keystore::FileKeystore;
use hc_storage::relocate::{
    copy_verified, copy_verified_with, is_clinic_entry, plan_target, retire_old, safety_dir,
    TargetProblem, DATA_DIR_NAME,
};
use hc_storage::testing::{seeded_data_dir, test_key};
use hc_storage::{Pool, StorageError};
use sha2::{Digest, Sha256};

const STAMP: &str = "20261104T154718Z";
const OLD_SAFETY: &str = "moved-out-20260101T000000Z";
const PRE_RESTORE: &str = "pre-restore-20260201T000000Z";

/// Entries the OS webview (WebKitGTK on Linux) keeps in the same app data
/// folder. They are not clinic data and the running webview owns them.
const WEBVIEW_ENTRIES: &[&str] = &[
    "CacheStorage/cache-001",
    "WebKitCache/Version 16/blob-001",
    "storage/localstorage/origin-001.sqlite3",
    "mediakeys/key-001",
    "hsts-storage.sqlite",
    "doctor-notes.txt",
];

/// Add the webview / stray entries to `root`.
fn add_webview_entries(root: &Path) {
    for rel in WEBVIEW_ENTRIES {
        write_file(&root.join(rel), b"not clinic data");
    }
}

/// A data folder as a real install leaves it, with every entry class the
/// engine must treat differently. All pools are dropped before returning.
fn populated_data_dir() -> (tempfile::TempDir, String) {
    let (dir, pool, (doctor_id, _)) = seeded_data_dir();
    drop(pool);
    let root = dir.path();
    let ks = FileKeystore::open(root).expect("file keystore");
    KeyHierarchy::new(&ks)
        .initialize("2468")
        .expect("keystore record");
    write_file(
        &root.join("files/blob-001.bin"),
        b"synthetic attachment 001",
    );
    write_file(
        &root.join("backups/daily-001.hcbak"),
        b"synthetic backup 001",
    );
    write_file(
        &root.join("clinic.db.pre-migration.v3.bak"),
        b"synthetic pre-migration copy",
    );
    write_file(
        &root.join(PRE_RESTORE).join("clinic.db"),
        b"synthetic pre-restore copy",
    );
    write_file(&root.join("exports/patient-list.csv"), b"code,name\n");
    write_file(&root.join("logs/app.log"), b"log line");
    write_file(&root.join("data-location.json"), br#"{"version":1}"#);
    write_file(
        &root.join(OLD_SAFETY).join("old.txt"),
        b"earlier safety copy",
    );
    (dir, doctor_id)
}

fn write_file(path: &Path, bytes: &[u8]) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, bytes).unwrap();
}

/// (relative path, sha256) of every file under `root`, sorted.
fn fingerprint(root: &Path) -> Vec<(String, String)> {
    fn walk(base: &Path, dir: &Path, out: &mut Vec<(String, String)>) {
        for e in std::fs::read_dir(dir).expect("read dir").flatten() {
            let p = e.path();
            if p.is_dir() {
                walk(base, &p, out);
            } else {
                let hash = Sha256::digest(std::fs::read(&p).expect("read file"));
                let hex: String = hash.iter().map(|b| format!("{b:02x}")).collect();
                let rel = p.strip_prefix(base).unwrap().to_string_lossy().into_owned();
                out.push((rel, hex));
            }
        }
    }
    let mut v = Vec::new();
    walk(root, root, &mut v);
    v.sort();
    v
}

fn top_names(dir: &Path) -> Vec<String> {
    let mut v: Vec<String> = std::fs::read_dir(dir)
        .expect("read dir")
        .flatten()
        .map(|e| e.file_name().to_string_lossy().into_owned())
        .collect();
    v.sort();
    v
}

fn doctor_names(db: &Path) -> Vec<String> {
    let key = test_key();
    let pool = Pool::open(db, &key as &dyn KeyProvider).expect("open copied DB");
    pool.with_reader(|c| {
        let mut st = c.prepare("SELECT name FROM doctor_profile")?;
        let v = st
            .query_map([], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(v)
    })
    .expect("read doctors")
}

fn problem(r: Result<PathBuf, StorageError>) -> TargetProblem {
    match r {
        Err(StorageError::RelocateTarget(p)) => p,
        other => panic!("expected RelocateTarget, got {other:?}"),
    }
}

/// A key that is not the DB's key (dependency fake).
struct WrongKey;
impl KeyProvider for WrongKey {
    fn key(&self) -> Result<zeroize::Zeroizing<Vec<u8>>, StorageError> {
        Ok(zeroize::Zeroizing::new(vec![0x22; 32]))
    }
}

// ---------------------------------------------------------------------------
// plan_target
// ---------------------------------------------------------------------------

/// Bug caught: data is spilled straight into the chosen folder (mixing with
/// the doctor's files) or the planner creates folders before the confirm.
#[test]
fn set006_plan_target_returns_homeoclinic_inside_an_empty_parent_and_creates_nothing() {
    let current = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    let target = plan_target(current.path(), parent.path()).expect("valid parent");
    assert_eq!(target, parent.path().join(DATA_DIR_NAME));
    assert!(top_names(parent.path()).is_empty(), "nothing left behind");
}

/// Bug caught: a non-empty HomeoClinic folder (another install's data) is
/// silently merged into or overwritten.
#[test]
fn set006_plan_target_refuses_a_non_empty_homeoclinic_folder() {
    let current = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    write_file(&parent.path().join(DATA_DIR_NAME).join("x.txt"), b"x");
    assert_eq!(
        problem(plan_target(current.path(), parent.path())),
        TargetProblem::NotEmpty
    );
}

/// Bug caught: a relative path is resolved against an unpredictable CWD.
#[test]
fn set006_plan_target_refuses_a_relative_path() {
    let current = tempfile::tempdir().unwrap();
    assert_eq!(
        problem(plan_target(current.path(), Path::new("some/relative"))),
        TargetProblem::NotAbsolute
    );
}

/// Bug caught: a file is accepted as the parent folder.
#[test]
fn set006_plan_target_refuses_a_file() {
    let current = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    let file = other.path().join("not-a-folder.txt");
    write_file(&file, b"x");
    assert_eq!(
        problem(plan_target(current.path(), &file)),
        TargetProblem::NotADirectory
    );
}

/// Bug caught: "moving" onto the current folder copies the data onto itself.
#[test]
fn set006_plan_target_refuses_the_current_folder() {
    let base = tempfile::tempdir().unwrap();
    let current = base.path().join(DATA_DIR_NAME);
    std::fs::create_dir_all(&current).unwrap();
    write_file(&current.join("clinic.db"), b"db");
    assert_eq!(
        problem(plan_target(&current, base.path())),
        TargetProblem::SameAsCurrent
    );
}

/// Bug caught: a target inside the current folder makes the copy recurse into
/// itself and fill the disk.
#[test]
fn set006_plan_target_refuses_a_folder_inside_the_current_one() {
    let current = tempfile::tempdir().unwrap();
    let inner = current.path().join("sub");
    std::fs::create_dir_all(&inner).unwrap();
    assert_eq!(
        problem(plan_target(current.path(), &inner)),
        TargetProblem::InsideCurrent
    );
}

/// Bug caught: a target that contains the current folder is "retired" later
/// together with the new data.
#[test]
fn set006_plan_target_refuses_a_folder_that_contains_the_current_one() {
    let base = tempfile::tempdir().unwrap();
    let current = base.path().join(DATA_DIR_NAME).join("data");
    std::fs::create_dir_all(&current).unwrap();
    assert_eq!(
        problem(plan_target(&current, base.path())),
        TargetProblem::ContainsCurrent
    );
}

/// Bug caught: a read-only folder is accepted and the move fails half-way.
#[cfg(unix)]
#[test]
fn set006_plan_target_refuses_a_read_only_parent() {
    use std::os::unix::fs::PermissionsExt;
    let current = tempfile::tempdir().unwrap();
    let parent = tempfile::tempdir().unwrap();
    std::fs::set_permissions(parent.path(), std::fs::Permissions::from_mode(0o555)).unwrap();
    let r = plan_target(current.path(), parent.path());
    std::fs::set_permissions(parent.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert_eq!(problem(r), TargetProblem::NotWritable);
}

// ---------------------------------------------------------------------------
// copy_verified
// ---------------------------------------------------------------------------

/// Bug caught: the move loses the licence/keystore, attachments or backups,
/// copies logs / the pointer / old safety copies, or produces a DB that does
/// not open with the install key (patient data unreadable after a move).
#[test]
fn set006_copy_verified_copies_every_data_entry_skips_home_entries_and_db_opens() {
    let (current, _doctor_id) = populated_data_dir();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join(DATA_DIR_NAME);
    let before = fingerprint(current.path());

    let report = copy_verified(current.path(), &target, &test_key()).expect("copy ok");

    assert!(
        target.is_dir(),
        "the target folder exists after a good copy"
    );
    let copied: Vec<(String, String)> = fingerprint(&target)
        .into_iter()
        .filter(|(n, _)| !n.ends_with("-wal") && !n.ends_with("-shm"))
        .collect();
    let names: Vec<&str> = copied.iter().map(|(n, _)| n.as_str()).collect();
    for want in [
        "clinic.db",
        "licence/state.bin",
        "files/blob-001.bin",
        "backups/daily-001.hcbak",
        "clinic.db.pre-migration.v3.bak",
        "pre-restore-20260201T000000Z/clinic.db",
        "exports/patient-list.csv",
    ] {
        assert!(names.contains(&want), "{want} copied, got {names:?}");
    }
    for (name, hash) in &copied {
        let src = before.iter().find(|(n, _)| n == name).expect("source file");
        assert_eq!(&src.1, hash, "{name} byte-identical");
    }
    let tops = top_names(&target);
    assert!(
        !tops.iter().any(|n| n == "logs"),
        "logs stay home: {tops:?}"
    );
    assert!(!tops.iter().any(|n| n.starts_with("data-location")));
    assert!(!tops.iter().any(|n| n.starts_with("moved-out-")));
    assert!(
        report.files >= copied.len() as u64,
        "every data file counted"
    );
    assert!(report.bytes > 0);
    assert_eq!(
        doctor_names(&target.join("clinic.db")),
        vec!["Test Doctor 001"]
    );
    assert_eq!(fingerprint(current.path()), before, "source never modified");
    assert_eq!(top_names(parent.path()), vec![DATA_DIR_NAME.to_string()]);
}

/// Bug caught: a corrupted copy (bad USB stick, flaky disk) is accepted and
/// the app switches to damaged data; or a half-copied folder is left behind.
#[test]
fn set006_copy_verified_rejects_a_corrupted_copy_and_leaves_no_partial_folder() {
    let (current, _) = populated_data_dir();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join(DATA_DIR_NAME);
    let before = fingerprint(current.path());
    let hook_ran = std::cell::Cell::new(false);

    let r = copy_verified_with(current.path(), &target, &test_key(), |partial: &Path| {
        hook_ran.set(true);
        std::fs::write(partial.join("files/blob-001.bin"), b"tampered!").unwrap();
    });

    assert!(hook_ran.get(), "the copy ran up to verification");
    assert!(
        matches!(r, Err(StorageError::RelocateCopyFailed)),
        "corruption must fail the move, got {r:?}"
    );
    assert!(!target.exists(), "no target folder after a failed copy");
    assert!(
        top_names(parent.path()).is_empty(),
        "no partial folder left"
    );
    assert_eq!(fingerprint(current.path()), before, "source untouched");
}

/// Bug caught: a copy whose DB cannot be opened with the install key is
/// accepted (the doctor would be locked out of the moved data).
#[test]
fn set006_copy_verified_fails_when_the_copied_db_does_not_open_with_the_key() {
    let (current, _) = populated_data_dir();
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join(DATA_DIR_NAME);

    let r = copy_verified(current.path(), &target, &WrongKey);

    assert!(
        matches!(r, Err(StorageError::RelocateCopyFailed)),
        "got {r:?}"
    );
    assert!(!target.exists());
    assert!(top_names(parent.path()).is_empty());
}

// ---------------------------------------------------------------------------
// retire_old
// ---------------------------------------------------------------------------

/// Bug caught: the old data is deleted (no safety copy), or logs / the pointer
/// / earlier safety copies are swept away with it.
#[test]
fn set006_retire_old_moves_data_into_a_safety_folder_and_keeps_home_entries() {
    let (current, _) = populated_data_dir();
    let before = fingerprint(current.path());

    let safety = retire_old(current.path(), STAMP).expect("retire ok");

    assert_eq!(safety, current.path().join(format!("moved-out-{STAMP}")));
    let mut tops = top_names(current.path());
    tops.sort();
    assert_eq!(
        tops,
        vec![
            "data-location.json".to_string(),
            "logs".to_string(),
            OLD_SAFETY.to_string(),
            format!("moved-out-{STAMP}"),
        ]
    );
    let kept = fingerprint(&safety);
    let names: Vec<&str> = kept.iter().map(|(n, _)| n.as_str()).collect();
    assert!(names.contains(&"clinic.db"));
    assert!(names.contains(&"licence/state.bin"));
    assert!(names.contains(&"files/blob-001.bin"));
    for (name, hash) in &kept {
        let src = before
            .iter()
            .find(|(n, _)| n == name)
            .expect("moved file existed");
        assert_eq!(&src.1, hash, "{name} unchanged in the safety copy");
    }
    assert!(current.path().join("logs/app.log").exists());
    assert!(current.path().join(OLD_SAFETY).join("old.txt").exists());
}

// ---------------------------------------------------------------------------
// allowlist (ms-review-1): the folder is shared with the webview on Linux
// ---------------------------------------------------------------------------

/// ms-review-1 bug caught: the move copies (and hashes) files the running
/// webview is still writing (random SHA mismatch) or carries the doctor's own
/// unrelated files along, because it copies "everything except a denylist".
/// Only HomeoClinic's own entries may be copied, and every one must be.
#[test]
fn set006_copy_verified_copies_only_the_clinics_own_entries_and_leaves_webview_files() {
    let (current, _) = populated_data_dir();
    add_webview_entries(current.path());
    let parent = tempfile::tempdir().unwrap();
    let target = parent.path().join(DATA_DIR_NAME);
    let before = fingerprint(current.path());

    copy_verified(current.path(), &target, &test_key()).expect("copy ok");

    let tops: Vec<String> = top_names(&target)
        .into_iter()
        .filter(|n| !n.ends_with("-wal") && !n.ends_with("-shm"))
        .collect();
    assert_eq!(
        tops,
        vec![
            "backups".to_string(),
            "clinic.db".to_string(),
            "clinic.db.pre-migration.v3.bak".to_string(),
            "exports".to_string(),
            "files".to_string(),
            "licence".to_string(),
            PRE_RESTORE.to_string(),
        ],
        "exactly the clinic's own entries are copied"
    );
    for rel in WEBVIEW_ENTRIES {
        assert!(!target.join(rel).exists(), "{rel} must not be copied");
    }
    assert_eq!(
        doctor_names(&target.join("clinic.db")),
        vec!["Test Doctor 001"]
    );
    assert_eq!(fingerprint(current.path()), before, "source never modified");
}

/// ms-review-1 bug caught: retiring the old data renames the live webview's
/// storage (localStorage, caches, media-device salts) out from under it, so
/// zoom / font mirror / the saved camera id are lost.
#[test]
fn set006_retire_old_moves_only_the_clinics_own_entries_and_leaves_webview_files_in_place() {
    let (current, _) = populated_data_dir();
    add_webview_entries(current.path());
    let before = fingerprint(current.path());

    let safety = retire_old(current.path(), STAMP).expect("retire ok");

    for rel in WEBVIEW_ENTRIES {
        let path = current.path().join(rel);
        assert!(path.is_file(), "{rel} stays where the webview keeps it");
        let hash = before.iter().find(|(n, _)| n == rel).expect("existed");
        let now = fingerprint(current.path());
        assert!(now.contains(hash), "{rel} unchanged");
        assert!(!safety.join(rel).exists(), "{rel} not in the safety copy");
    }
    for rel in [
        "clinic.db",
        "licence/state.bin",
        "files/blob-001.bin",
        "backups/daily-001.hcbak",
        "clinic.db.pre-migration.v3.bak",
        "pre-restore-20260201T000000Z/clinic.db",
        "exports/patient-list.csv",
    ] {
        assert!(
            safety.join(rel).is_file(),
            "{rel} retired into the safety copy"
        );
        assert!(!current.path().join(rel).exists(), "{rel} no longer live");
    }
}

/// ms-review-1 bug caught: the allowlist matcher accepts webview / stray
/// names (or bare prefixes), or rejects one of the app's own entry names.
#[test]
fn set006_is_clinic_entry_accepts_only_the_apps_own_names() {
    for yes in [
        "clinic.db",
        "clinic.db-wal",
        "clinic.db-shm",
        "files",
        "licence",
        "backups",
        "exports",
        "clinic.db.pre-migration.v3.bak",
        "pre-restore-20260201T000000Z",
    ] {
        assert!(is_clinic_entry(yes), "{yes} is clinic data");
    }
    for no in [
        "CacheStorage",
        "WebKitCache",
        "storage",
        "mediakeys",
        "hsts-storage.sqlite",
        "logs",
        "data-location.json",
        "data-location.json.tmp",
        "moved-out-20260101T000000Z",
        ".hc-restore-staging",
        ".hc-snapshot-tmp",
        "pre-restore-",
        "clinic.db.pre-migration.v.bak",
        "clinic.db.other",
        "doctor-notes.txt",
    ] {
        assert!(!is_clinic_entry(no), "{no} is not clinic data");
    }
}

/// ms-review-6 bug caught: the reported safety folder differs from the one
/// `retire_old` fills, so a partial-retire banner points at the wrong place.
#[test]
fn set006_safety_dir_is_the_folder_retire_old_creates() {
    let (current, _) = populated_data_dir();
    let expected = safety_dir(current.path(), STAMP);
    assert_eq!(
        retire_old(current.path(), STAMP).expect("retire ok"),
        expected
    );
}
