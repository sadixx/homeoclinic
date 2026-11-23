//! Exclusive export-file writes (R5 report export, BILL-004; R-ARCH-009).
//!
//! The use-case layer builds the bytes and a plain file name; this module
//! alone joins it onto the doctor-picked folder and writes it. A file is
//! created exclusively and never overwritten: when `name` exists the first
//! free `stem (n).ext` is used. A failed write removes the partial file, so
//! a retry gets the plain name again. Errors carry no path (R-PRIV-001).

use std::io::{ErrorKind, Write as _};
use std::path::Path;

use crate::error::StorageError;

/// Highest ` (n)` suffix tried before giving up.
pub const MAX_NAME_SUFFIX: u32 = 999;

/// Write `bytes` to a NEW file `name` in `dir` and return the file name used
/// (`name` or `stem (n).ext`). `name` must be a bare file name (no path
/// separator, not `.`/`..`); anything else is refused.
pub fn write_new_export_file(dir: &Path, name: &str, bytes: &[u8]) -> Result<String, StorageError> {
    if !is_bare_file_name(name) {
        return Err(StorageError::Io(ErrorKind::InvalidInput.into()));
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((s, e)) => (s, Some(e)),
        None => (name, None),
    };
    for n in 1..=MAX_NAME_SUFFIX {
        let candidate = match (n, ext) {
            (1, _) => name.to_string(),
            (_, Some(e)) => format!("{stem} ({n}).{e}"),
            (_, None) => format!("{stem} ({n})"),
        };
        let path = dir.join(&candidate);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                let written = f.write_all(bytes).and_then(|()| f.sync_all());
                drop(f);
                return match written {
                    Ok(()) => Ok(candidate),
                    Err(e) => {
                        // Never leave a partial export behind (r5-review-9).
                        let _ = std::fs::remove_file(&path);
                        Err(StorageError::Io(e))
                    }
                };
            }
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(StorageError::Io(e)),
        }
    }
    Err(StorageError::Io(ErrorKind::AlreadyExists.into()))
}

/// A plain file name: non-empty, no separator, not a dot entry.
fn is_bare_file_name(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\'])
        && !name.contains('\0')
}
