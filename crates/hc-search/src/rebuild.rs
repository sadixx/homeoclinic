//! Search-index rebuild with progress (HC-MVP1-053, PSR-013).
//!
//! Recomputes `name_norm`/`name_phonetic`/`mobile_digits`/`code_digits` on every
//! base `patient` row and rebuilds the `patient_fts` + `patient_trgm` shadow
//! indexes from scratch, all in ONE writer transaction (R-DATA-006). Reports
//! progress via a callback. The `<60s at 50k` budget (PSR-013) is verified in
//! the M2-perf slice, not here.

use crate::error::SearchError;
use crate::{normalize, phonetic};
use rusqlite::{params, Connection};

/// Progress during a rebuild: rows processed so far out of the total.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RebuildProgress {
    /// Rows rebuilt so far.
    pub done: u64,
    /// Total rows to rebuild.
    pub total: u64,
}

/// How often (in rows) to invoke the progress callback during the row pass, in
/// addition to the guaranteed final call at `done == total`.
const PROGRESS_EVERY: u64 = 500;

/// Rebuild the patient search indexes from the base `patient` rows.
///
/// Runs inside one writer transaction, recomputing the normalised columns and
/// repopulating `patient_fts` + `patient_trgm`. `progress` is called
/// periodically and at least once at the end with `done == total`. Returns the
/// number of rows rebuilt.
///
/// All SQL is parameterised (R-SEC-001). The FTS shadow tables are cleared with
/// the external-content `delete-all` command and rebuilt via the base-table
/// insert triggers, so the index can never be left half-populated: either the
/// whole transaction commits or none of it does (R-DATA-006).
pub fn rebuild_indexes(
    conn: &mut Connection,
    mut progress: impl FnMut(RebuildProgress),
) -> Result<u64, SearchError> {
    let total: u64 = conn.query_row(
        "SELECT COUNT(*) FROM patient WHERE deleted_at IS NULL",
        [],
        |r| r.get::<_, i64>(0).map(|v| v as u64),
    )?;

    let tx = conn.transaction()?;

    // Restore the shadow indexes to a state consistent with the current base
    // content FIRST, using the FTS5 external-content 'rebuild' command. This
    // works whether the index was intact, emptied ('delete-all') or left
    // malformed: 'rebuild' discards whatever is there and reconstructs from the
    // `patient` content rows. Doing this before any UPDATE means the AFTER
    // UPDATE triggers below always find a valid old shadow row to delete, so the
    // recompute pass can never corrupt an out-of-sync index (R-DATA-006).
    tx.execute_batch(
        "INSERT INTO patient_fts(patient_fts) VALUES('rebuild');\n\
         INSERT INTO patient_trgm(patient_trgm) VALUES('rebuild');",
    )?;

    let mut done: u64 = 0;
    {
        // Collect the base rows first, then recompute + rewrite. Collecting
        // avoids holding a read statement open across the writes on the same
        // connection.
        let rows: Vec<(i64, String, String, Option<String>)> = {
            let mut stmt = tx.prepare(
                "SELECT rowid, name, code, mobile \
                 FROM patient WHERE deleted_at IS NULL ORDER BY rowid",
            )?;
            let mapped = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, i64>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                ))
            })?;
            mapped.collect::<Result<Vec<_>, _>>()?
        };

        for (rowid, name, code, mobile) in rows {
            let name_norm = normalize::name_norm(&name);
            let name_phonetic = phonetic::phonetic_key(&name);
            let mobile_digits = mobile.as_deref().map(normalize::mobile_digits);
            let code_digits = normalize::code_digits(&code);

            // Recompute the normalised columns on the base row. The AFTER UPDATE
            // trigger re-populates both shadow indexes in this same transaction.
            tx.execute(
                "UPDATE patient \
                 SET name_norm = ?1, name_phonetic = ?2, mobile_digits = ?3, \
                     code_digits = ?4 \
                 WHERE rowid = ?5",
                params![name_norm, name_phonetic, mobile_digits, code_digits, rowid],
            )?;

            done += 1;
            if done.is_multiple_of(PROGRESS_EVERY) {
                progress(RebuildProgress { done, total });
            }
        }
    }

    tx.commit()?;

    // Guarantee a final report at completion (done == total), even for small
    // row counts that never hit the periodic threshold (PSR-013).
    progress(RebuildProgress { done, total });

    Ok(done)
}
