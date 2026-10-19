//! LIC-005 clock-rollback guard: a monotonic max-seen UTC anchor authenticated
//! with an HMAC-SHA256 tag keyed from an HKDF subkey of the DEK.
//!
//! The trial/licence expiry is checked against `effective_now = max(system_now,
//! max_seen - 48h)` (design §6 / diagram 12-state-licence), so moving the
//! system clock backward cannot extend the trial, while a <48h benign drift
//! (NTP / timezone) is tolerated. A tampered `last_seen_at` (its MAC fails to
//! verify) is treated as a rollback: the stored value is only ever used as the
//! `-48h` floor, never trusted to increase days remaining.
//!
//! Parameterised SQL only (R-SEC-001); each advance writes exactly one
//! `audit_log` row in the caller's transaction (R-DATA-001). The HMAC key lives
//! in a `Zeroizing` buffer and is never logged (R-SEC-006, R-PRIV-001).

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::clock::{format_rfc3339_utc, parse_rfc3339_utc};
use crate::error::StorageError;
use crate::key::DekKeyProvider;
use crate::pool::Pool;
use hmac::{Hmac, Mac};
use serde_json::json;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// The 48-hour grace band that tolerates benign backward drift (LIC-005).
pub const GRACE_SECS: i64 = 48 * 3_600;

/// Domain prefix bound into the authenticated message, so the tag cannot be
/// lifted onto another field with the same key.
pub const MAX_SEEN_MAC_DOMAIN: &[u8] = b"hc-licence-max-seen-v1\n";

/// The fixed singleton row id in `licence_state`.
pub const SINGLETON_ID: &str = "singleton";

/// The persisted clock-guard anchor read back from `licence_state`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MaxSeen {
    /// The monotonic max-seen instant, RFC3339 UTC.
    pub last_seen_at: String,
    /// Whether the stored HMAC tag verified under the DEK-derived key.
    ///
    /// `false` means the `last_seen_at`/MAC was tampered with (or is otherwise
    /// unauthenticated): the value is treated as a rollback and is NOT trusted
    /// to extend the trial — the guard ignores it and re-seals.
    pub mac_ok: bool,
}

/// Compute the HMAC-SHA256 tag (lowercase hex) over the authenticated max-seen
/// message `MAX_SEEN_MAC_DOMAIN || last_seen_at`, keyed by the DEK-derived
/// clock-guard key.
///
/// The key material lives in a `Zeroizing` buffer and is never logged
/// (R-SEC-006, R-PRIV-001). HMAC construction cannot fail for a 32-byte key.
pub fn compute_max_seen_mac(dek: &DekKeyProvider, last_seen_at: &str) -> String {
    let key = dek.licence_hmac_key();
    // `new_from_slice` only errors for an invalid key length; our key is a
    // fixed 32 bytes, so on the impossible error path fall closed with an empty
    // tag (which never verifies) rather than panicking (R-RUST-002).
    let mut mac = match HmacSha256::new_from_slice(key.as_ref()) {
        Ok(m) => m,
        Err(_) => return String::new(),
    };
    mac.update(MAX_SEEN_MAC_DOMAIN);
    mac.update(last_seen_at.as_bytes());
    let tag = mac.finalize().into_bytes();
    hex::encode(tag)
}

/// Constant-time comparison of two hex MAC strings. Returns `false` on any
/// length mismatch or decode failure (fail-closed, R-SEC-006).
fn mac_verify(expected_hex: &str, stored_hex: &str) -> bool {
    // Both are lowercase-hex tags we produced / read; compare the decoded bytes
    // in constant time to avoid leaking where a forged tag first diverges.
    let (Ok(a), Ok(b)) = (hex::decode(expected_hex), hex::decode(stored_hex)) else {
        return false;
    };
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Read the `licence_state` singleton and verify its MAC. `Ok(None)` when no
/// row exists yet (the first observe right after trial start writes it).
///
/// Parameterised SQL on a reader connection (R-SEC-001). The verify is
/// constant-time; a mismatch surfaces as `mac_ok == false` (not an error) so
/// the guard can treat a tampered value as a rollback.
pub fn read_max_seen(pool: &Pool, dek: &DekKeyProvider) -> Result<Option<MaxSeen>, StorageError> {
    pool.with_reader(|conn| {
        let mut stmt = conn.prepare(
            "SELECT last_seen_at, last_seen_mac FROM licence_state \
             WHERE id = ?1 AND deleted_at IS NULL LIMIT 1",
        )?;
        let mut rows = stmt.query(rusqlite::params![SINGLETON_ID])?;
        match rows.next()? {
            Some(r) => {
                let last_seen_at: String = r.get(0)?;
                let stored_mac: String = r.get(1)?;
                let expected = compute_max_seen_mac(dek, &last_seen_at);
                let mac_ok = !expected.is_empty() && mac_verify(&expected, &stored_mac);
                Ok(Some(MaxSeen {
                    last_seen_at,
                    mac_ok,
                }))
            }
            None => Ok(None),
        }
    })
}

/// Persist (insert/replace) the `licence_state` singleton with `last_seen_at`
/// and a fresh MAC, writing one `audit_log` row (R-DATA-001). `now` stamps the
/// audit + row columns.
///
/// One transaction, parameterised SQL (R-SEC-001, R-DATA-001). The stored
/// `last_seen_at` carries no patient data; the audit diff records only the
/// anchor instant (never the key or the raw MAC bytes — R-PRIV-001).
pub fn write_max_seen(
    pool: &Pool,
    dek: &DekKeyProvider,
    last_seen_at: &str,
    now: &str,
) -> Result<(), StorageError> {
    let mac = compute_max_seen_mac(dek, last_seen_at);
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        // `licence_blob` is reserved NULL in R1 (M9 .hclic). Single logical row
        // keyed by the fixed singleton id.
        tx.execute(
            "INSERT OR REPLACE INTO licence_state (\
                id, licence_blob, last_seen_at, last_seen_mac, \
                created_at, updated_at, deleted_at, created_by, updated_by, row_version\
            ) VALUES (?1, NULL, ?2, ?3, ?4, ?4, NULL, NULL, NULL, 0)",
            rusqlite::params![SINGLETON_ID, last_seen_at, mac, now],
        )?;
        write_audit(
            &tx,
            &AuditEntry {
                user_id: None,
                entity: "licence_state",
                entity_id: SINGLETON_ID,
                action: AuditAction::Update,
                // Record only the advanced anchor instant — never the MAC bytes
                // or any key material (R-PRIV-001).
                diff: json!({ "last_seen_at": { "new": last_seen_at } }),
            },
            now,
        )?;
        tx.commit()?;
        Ok(())
    })
}

/// The LIC-005 clock guard over the `licence_state` anchor.
pub struct ClockGuard;

impl ClockGuard {
    /// Observe the wall clock: read (and MAC-verify) the stored max-seen, apply
    /// the `effective_now = max(system_now, max_seen - 48h)` rule, advance the
    /// stored max-seen monotonically to the latest effective instant, and
    /// return `effective_now` (RFC3339 UTC).
    ///
    /// - No stored row -> `effective_now = system_now`, write it.
    /// - MAC ok -> `floor = last_seen_at - 48h`; `effective = max(now, floor)`.
    /// - MAC FAILS (tampered) -> treat as a rollback: the unauthenticated value
    ///   is NOT trusted as the floor (a forged future must never extend the
    ///   trial); `effective = system_now` and the row is re-sealed with a valid
    ///   MAC over the trustworthy instant.
    /// - Advance `max_seen = max(old_max_seen, effective)` (monotonic). The
    ///   stored anchor therefore never regresses, so a backward clock jump can
    ///   never raise days remaining.
    ///
    /// `system_now` is the wall-clock read; `audit_now` stamps the audit/row
    /// columns on any re-seal (the caller passes the same clock instant for
    /// both in R1).
    pub fn observe(
        pool: &Pool,
        dek: &DekKeyProvider,
        system_now: &str,
        audit_now: &str,
    ) -> Result<String, StorageError> {
        // A system_now we cannot parse is treated as the epoch (fail-closed:
        // the trial counts, never extends — R-RUST-002). Valid service inputs
        // always parse.
        let now_secs = parse_rfc3339_utc(system_now).unwrap_or(0);

        let stored = read_max_seen(pool, dek)?;
        let (effective_secs, old_max_secs) = match &stored {
            // No anchor yet: seed at the current wall clock.
            None => (now_secs, None),
            Some(MaxSeen {
                last_seen_at,
                mac_ok: true,
            }) => {
                let max_secs = parse_rfc3339_utc(last_seen_at).unwrap_or(now_secs);
                // Tolerate a <48h benign backward drift; a >48h rollback pins
                // effective to the max-seen floor.
                let floor = max_secs - GRACE_SECS;
                (now_secs.max(floor), Some(max_secs))
            }
            // Tampered (bad MAC): do NOT trust the stored instant at all — it is
            // never used as the floor, so a forged future cannot extend the
            // trial. Effective is the real wall clock; the row is re-sealed.
            Some(MaxSeen { mac_ok: false, .. }) => (now_secs, None),
        };

        // Monotonic advance: the anchor never regresses below its prior maximum.
        let new_max_secs = match old_max_secs {
            Some(old) => old.max(effective_secs),
            None => effective_secs,
        };

        // Write the anchor when there is no row yet, when a tampered row must be
        // re-sealed with a valid MAC, or when the monotonic anchor advanced.
        let need_write = match &stored {
            None => true,
            Some(s) if !s.mac_ok => true,
            Some(s) => parse_rfc3339_utc(&s.last_seen_at) != Some(new_max_secs),
        };
        if need_write {
            let new_max = format_rfc3339_utc(new_max_secs);
            write_max_seen(pool, dek, &new_max, audit_now)?;
        }

        Ok(format_rfc3339_utc(effective_secs))
    }

    /// The clock-guarded anchor instant (the monotonic advanced max-seen) after
    /// an [`observe`](Self::observe). This is the reference the licence service
    /// counts days against: it equals `effective_now` on honest forward motion
    /// and never regresses on a backward jump, so days remaining can never rise.
    pub fn anchor(pool: &Pool, dek: &DekKeyProvider) -> Result<Option<String>, StorageError> {
        Ok(read_max_seen(pool, dek)?.map(|m| m.last_seen_at))
    }
}
