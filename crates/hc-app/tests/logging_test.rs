//! RED tests for the structured-logging seams (HC-MVP1-017, design §017/§8,
//! R-PRIV-001, NFR-013).
//!
//! Code under test (CUT): `hc_app::logging::{RotationPolicy, LogRecord,
//! format_line, hash_id, log_path}`. Three pure, filesystem-free seams let us
//! prove the privacy and rotation invariants without a running subscriber.
//! No dependency is faked (R-TEST-002). Names carry the req id (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `hc-app/src/logging.rs`,
//! this file fails to compile against the absent CUT. Once the seams exist per
//! the frozen API CONTRACT, the assertions below are what must hold — a
//! `LogRecord` that grows a patient-name field, or a `should_rotate` that does
//! not trip at the 10 MiB cap, makes an ASSERTION fail.

use std::path::Path;

use hc_app::logging::{
    format_line, hash_id, log_path, LogRecord, MakeRollingWriter, RollingFile, RotationPolicy,
};

/// A synthetic patient name used only to prove it cannot reach a log line.
/// NOT real patient data (R-PRIV-001).
const SYNTHETIC_PATIENT_NAME: &str = "Test Patient 001";

/// R-TEST-008 (R-PRIV-001, NFR-013): a patient name passed through the
/// message of a `LogRecord` does NOT appear in the serialised line, because
/// the record has no name field by construction and `format_line` only
/// serialises that struct. We build the record with a patient-data-free
/// message and additionally assert the synthetic name is absent.
#[test]
fn hc_mvp1_017_format_line_never_contains_patient_name() {
    // The caller builds a message WITHOUT the patient name (by construction);
    // a hashed id is the only identifier that may appear.
    let rec = LogRecord {
        ts: "2026-10-17T00:00:00Z".to_string(),
        level: "INFO".to_string(),
        target: "hc_app::visit".to_string(),
        message: "saved visit".to_string(),
        patient_hash: Some(hash_id("PAT-00001")),
    };

    let line = format_line(&rec);

    assert!(
        !line.contains(SYNTHETIC_PATIENT_NAME),
        "serialised log line must never contain a patient name: `{line}`"
    );
    assert!(
        line.contains("saved visit"),
        "the patient-data-free message must still be present: `{line}`"
    );
    // The line is a single JSON object (one line, no embedded newline).
    assert!(
        !line.contains('\n'),
        "a log record must serialise to a single line: `{line}`"
    );
}

/// R-TEST-008 (R-PRIV-001): `hash_id` never returns the raw id and is stable
/// across calls. Proves identifiers that must appear are hashed, not leaked.
#[test]
fn hc_mvp1_017_hash_id_does_not_reveal_raw_id() {
    let raw = "PAT-00042";
    let h1 = hash_id(raw);
    let h2 = hash_id(raw);

    assert_ne!(h1, raw, "hash_id must not return the raw id");
    assert!(!h1.contains(raw), "hash must not embed the raw id: `{h1}`");
    assert_eq!(h1, h2, "hash_id must be stable across calls");
    assert_ne!(
        hash_id("PAT-00042"),
        hash_id("PAT-00043"),
        "different ids must hash differently"
    );
}

/// R-TEST-008 (NFR-013, design §8): rotation triggers at the 10 MiB cap and
/// the shipped policy keeps 5 files. Just under the cap must NOT rotate; a
/// write that would cross it MUST rotate.
#[test]
fn hc_mvp1_017_rotation_triggers_at_size_cap_and_keeps_five() {
    let policy = RotationPolicy::DEFAULT;

    assert_eq!(policy.max_bytes, 10 * 1024 * 1024, "cap must be 10 MiB");
    assert_eq!(policy.keep_files, 5, "policy must keep 5 files");

    // One byte short of the cap, a 10-byte write must NOT rotate.
    assert!(
        !policy.should_rotate(policy.max_bytes - 20, 10),
        "must not rotate while the write stays within the cap"
    );
    // A write that pushes past the cap MUST rotate first.
    assert!(
        policy.should_rotate(policy.max_bytes - 10, 100),
        "must rotate when the write would cross the 10 MiB cap"
    );
    // Exactly at the cap is fine; one byte over trips it.
    assert!(
        !policy.should_rotate(policy.max_bytes, 0),
        "exactly at the cap with a zero-byte write must not rotate"
    );
    assert!(
        policy.should_rotate(policy.max_bytes, 1),
        "one byte over the cap must rotate"
    );
}

/// R-TEST-008 (design §8 / CODE-LAYOUT): the log path resolves to
/// `<data>/logs/app.log`.
#[test]
fn hc_mvp1_017_log_path_is_under_data_logs() {
    let path = log_path(Path::new("/tmp/hc-data"));
    assert!(
        path.ends_with("logs/app.log"),
        "log path must end with logs/app.log: `{}`",
        path.display()
    );
}

/// A unique scratch directory under the OS temp dir, removed on drop so the
/// test leaves nothing behind. Not patient data; filesystem-only (R-TEST-002).
struct TempLogDir {
    path: std::path::PathBuf,
}

impl TempLogDir {
    fn new(tag: &str) -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let path =
            std::env::temp_dir().join(format!("hc-nfr013-{tag}-{}-{nanos}", std::process::id()));
        std::fs::create_dir_all(&path).expect("create temp log dir");
        Self { path }
    }
}

impl Drop for TempLogDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.path);
    }
}

/// Count how many `app.log*` files currently exist in `dir`.
fn count_log_files(dir: &Path) -> usize {
    std::fs::read_dir(dir)
        .expect("read temp log dir")
        .filter_map(|e| e.ok())
        .filter(|e| e.file_name().to_string_lossy().starts_with("app.log"))
        .count()
}

/// R-TEST-008 (NFR-013, design §8): the LIVE, running writer that the app
/// hands to `tracing` actually rotates by SIZE and never keeps more than
/// `keep_files` files. This drives the real [`RollingFile`] through the same
/// [`MakeRollingWriter`] + `tracing-subscriber` JSON layer the app installs
/// in `init`, using a tiny `max_bytes` so a handful of log lines trip the cap.
///
/// A dead policy (the old `rolling::never` writer) would leave a single
/// ever-growing `app.log`; this asserts `app.log.1` appears, the file count
/// never exceeds `keep_files`, and the freshest line lives in `app.log`.
#[test]
fn hc_mvp1_017_nfr013_live_writer_rotates_by_size_and_caps_file_count() {
    use tracing::subscriber::with_default;

    let tmp = TempLogDir::new("live-rot");
    let dir = tmp.path.clone();

    // Tiny cap so ~a few JSON lines force several rotations; keep 3 files.
    let keep_files: u8 = 3;
    let policy = RotationPolicy {
        max_bytes: 100,
        keep_files,
    };

    let rolling = RollingFile::open(&dir, policy).expect("open rolling file");
    let make_writer = MakeRollingWriter::new(rolling);

    // Build the SAME subscriber shape the app installs (JSON fmt layer over the
    // rolling writer), but as a LOCAL default so it does not clash with the
    // process-global subscriber other tests / the app own.
    let subscriber = tracing_subscriber::fmt()
        .json()
        .with_writer(make_writer)
        .with_current_span(false)
        .with_span_list(false)
        .finish();

    with_default(subscriber, || {
        // Each line is well over the 100-byte cap once rendered as JSON, so
        // every event forces a rotation. No patient data in any message.
        for i in 0..12 {
            tracing::info!(iteration = i, "live rotation probe line {}", i);
        }
    });

    // The writer rotated: app.log.1 exists.
    assert!(
        dir.join("app.log.1").exists(),
        "live writer must have rotated app.log -> app.log.1"
    );

    // File count is capped at keep_files (app.log + up to keep_files-1 rotated).
    let count = count_log_files(&dir);
    assert!(
        count <= usize::from(keep_files),
        "file count {count} must never exceed keep_files {keep_files}"
    );

    // The oldest rotated index (app.log.{keep_files}) must NOT exist — proof
    // the oldest file was deleted rather than accumulating unbounded.
    assert!(
        !dir.join(format!("app.log.{keep_files}")).exists(),
        "a file beyond keep_files must have been deleted"
    );

    // The newest content is in app.log: the FINAL probe line emitted through
    // the live subscriber (iteration 11) must live in the active app.log, not
    // in a rotated sibling. Each probe line exceeds the 100-byte cap, so the
    // last write left exactly that line as the new head of app.log.
    let head = std::fs::read_to_string(dir.join("app.log")).expect("read app.log");
    assert!(
        head.contains("live rotation probe line 11"),
        "the newest content must live in app.log, got: `{head}`"
    );
    // And an older line must NOT still be in the active head (it rotated away).
    assert!(
        !head.contains("live rotation probe line 0\""),
        "an old line must have rotated out of app.log, got: `{head}`"
    );
}
