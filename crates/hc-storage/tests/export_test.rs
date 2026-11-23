//! Exclusive export-file writes (R5 BILL-004; r5-review-9, r5-review-14).
//!
//! CUT: the REAL `hc_storage::export::write_new_export_file` writing into a
//! `TempDir` (R-TEST-006). Synthetic bytes only.

use hc_storage::export::write_new_export_file;

/// Bug caught: the plain name is not used for the first export, or the bytes
/// written differ from the bytes given.
#[test]
fn writes_the_plain_name_first() {
    let dir = tempfile::tempdir().expect("tempdir");
    let name = write_new_export_file(dir.path(), "collection.csv", b"a,b\r\n").expect("write");
    assert_eq!(name, "collection.csv");
    assert_eq!(
        std::fs::read(dir.path().join("collection.csv")).expect("read"),
        b"a,b\r\n"
    );
}

/// Bug caught: an existing export is overwritten instead of getting ` (n)`.
#[test]
fn never_overwrites_and_numbers_the_next_free_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("r.xlsx"), b"old").expect("seed");
    std::fs::write(dir.path().join("r (2).xlsx"), b"old2").expect("seed");
    let name = write_new_export_file(dir.path(), "r.xlsx", b"new").expect("write");
    assert_eq!(name, "r (3).xlsx");
    assert_eq!(
        std::fs::read(dir.path().join("r.xlsx")).expect("read"),
        b"old"
    );
    assert_eq!(
        std::fs::read(dir.path().join("r (3).xlsx")).expect("read"),
        b"new"
    );
}

/// Bug caught: a name without an extension gets a stray trailing dot.
#[test]
fn a_name_without_extension_gets_a_clean_suffix() {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("report"), b"old").expect("seed");
    let name = write_new_export_file(dir.path(), "report", b"new").expect("write");
    assert_eq!(name, "report (2)");
}

/// Bug caught: a name carrying a path escapes the picked folder.
#[test]
fn refuses_anything_but_a_bare_file_name() {
    let dir = tempfile::tempdir().expect("tempdir");
    for bad in ["", ".", "..", "../x.csv", "a/b.csv", "a\\b.csv"] {
        assert!(
            write_new_export_file(dir.path(), bad, b"x").is_err(),
            "{bad:?} must be refused"
        );
    }
    assert_eq!(std::fs::read_dir(dir.path()).expect("ls").count(), 0);
}

/// Bug caught: a missing folder is reported as success or panics.
#[test]
fn a_missing_folder_is_an_error() {
    let dir = tempfile::tempdir().expect("tempdir");
    let gone = dir.path().join("gone");
    assert!(write_new_export_file(&gone, "r.csv", b"x").is_err());
}
