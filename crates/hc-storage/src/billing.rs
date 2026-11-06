//! Billing repository (BILL-001..005; R5 design §5): receipt sequence,
//! invoice / invoice_line / payment rows, dues recompute and report reads.
//! All SQL parameterised (R-SEC-001). Writers take `&Transaction` and never
//! commit; each use case writes exactly one audit row (R-DATA-001) through
//! [`write_billing_audit`], called once by the `hc-app` service. Every list
//! read is bounded (R-DATA-007).

use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Row, Transaction};
use serde_json::Value;

use crate::audit::{write_audit, AuditAction, AuditEntry};
use crate::error::StorageError;
use crate::patient::{get_patient, get_patient_including_deleted, PatientRow};
use crate::profile::{get_clinic_profile, get_doctor_profile, ClinicProfile, DoctorProfile};
use crate::settings::read_upi_vpa;
use crate::visit::{get_visit, VisitRow};

/// One `invoice` row.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InvoiceRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// Owning patient id.
    pub patient_id: String,
    /// Billed visit id (always set in R5).
    pub visit_id: Option<String>,
    /// Financial year label, e.g. `2026-27`.
    pub fy: String,
    /// Sequence number within the FY (>= 1).
    pub seq: i64,
    /// Display receipt number `2026-27/0142`.
    pub number: String,
    /// Clinic-local issue date `YYYY-MM-DD`.
    pub issued_on: String,
    /// UTC issue instant.
    pub issued_at: String,
    /// `issued` or `void`.
    pub status: String,
    /// `none`, `amount` or `percent`.
    pub discount_kind: String,
    /// Paise (amount) or basis points (percent).
    pub discount_value: i64,
    /// Sum of line amounts.
    pub subtotal_paise: i64,
    /// Discount in paise.
    pub discount_paise: i64,
    /// subtotal - discount.
    pub total_paise: i64,
    /// Sum of live payments.
    pub paid_paise: i64,
    /// total - paid.
    pub balance_paise: i64,
    /// Clinic GSTIN at issue, if set.
    pub gstin_snapshot: Option<String>,
    /// UTC void instant.
    pub voided_at: Option<String>,
    /// Void reason.
    pub void_reason: Option<String>,
    /// Optimistic-concurrency version.
    pub row_version: i64,
}

/// One `invoice_line` row.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct InvoiceLineRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// Owning invoice id.
    pub invoice_id: String,
    /// 0-based display order.
    pub position: i64,
    /// `consultation`, `medicine` or `other`.
    pub kind: String,
    /// Free-text description.
    pub description: String,
    /// Quantity (>= 1).
    pub qty: i64,
    /// Rate per unit in paise.
    pub rate_paise: i64,
    /// qty * rate.
    pub amount_paise: i64,
}

/// One `payment` row.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PaymentRow {
    /// UUIDv7 primary key.
    pub id: String,
    /// Invoice the payment is against.
    pub invoice_id: String,
    /// Patient (denormalised).
    pub patient_id: String,
    /// Clear-dues allocation group, if any.
    pub batch_id: Option<String>,
    /// Clinic-local date the money was received.
    pub paid_on: String,
    /// UTC instant of entry.
    pub recorded_at: String,
    /// Amount in paise (> 0).
    pub amount_paise: i64,
    /// `cash`, `upi`, `card` or `other`.
    pub mode: String,
    /// Optional UTR / slip reference.
    pub reference: Option<String>,
    /// UTC void instant.
    pub voided_at: Option<String>,
    /// Void reason.
    pub void_reason: Option<String>,
}

/// Per-mode collection total for one day.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ModeTotal {
    /// Payment mode.
    pub mode: String,
    /// Number of live payments.
    pub count: i64,
    /// Sum in paise.
    pub amount_paise: i64,
}

/// Per-day, per-mode collection total.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DayModeTotal {
    /// Local payment date.
    pub paid_on: String,
    /// Payment mode.
    pub mode: String,
    /// Number of live payments.
    pub count: i64,
    /// Sum in paise.
    pub amount_paise: i64,
}

const INVOICE_COLS: &str =
    "id, patient_id, visit_id, fy, seq, number, issued_on, issued_at, status, \
    discount_kind, discount_value, subtotal_paise, discount_paise, total_paise, paid_paise, \
    balance_paise, gstin_snapshot, voided_at, void_reason, row_version";

const LINE_COLS: &str =
    "id, invoice_id, position, kind, description, qty, rate_paise, amount_paise";

const PAYMENT_COLS: &str = "id, invoice_id, patient_id, batch_id, paid_on, recorded_at, \
    amount_paise, mode, reference, voided_at, void_reason";

/// Upper bound on the visit ids accepted by [`live_invoices_for_visits`].
pub const MAX_VISIT_IDS: usize = 500;

fn invoice_from(r: &Row<'_>) -> rusqlite::Result<InvoiceRow> {
    Ok(InvoiceRow {
        id: r.get(0)?,
        patient_id: r.get(1)?,
        visit_id: r.get(2)?,
        fy: r.get(3)?,
        seq: r.get(4)?,
        number: r.get(5)?,
        issued_on: r.get(6)?,
        issued_at: r.get(7)?,
        status: r.get(8)?,
        discount_kind: r.get(9)?,
        discount_value: r.get(10)?,
        subtotal_paise: r.get(11)?,
        discount_paise: r.get(12)?,
        total_paise: r.get(13)?,
        paid_paise: r.get(14)?,
        balance_paise: r.get(15)?,
        gstin_snapshot: r.get(16)?,
        voided_at: r.get(17)?,
        void_reason: r.get(18)?,
        row_version: r.get(19)?,
    })
}

fn line_from(r: &Row<'_>) -> rusqlite::Result<InvoiceLineRow> {
    Ok(InvoiceLineRow {
        id: r.get(0)?,
        invoice_id: r.get(1)?,
        position: r.get(2)?,
        kind: r.get(3)?,
        description: r.get(4)?,
        qty: r.get(5)?,
        rate_paise: r.get(6)?,
        amount_paise: r.get(7)?,
    })
}

fn payment_from(r: &Row<'_>) -> rusqlite::Result<PaymentRow> {
    Ok(PaymentRow {
        id: r.get(0)?,
        invoice_id: r.get(1)?,
        patient_id: r.get(2)?,
        batch_id: r.get(3)?,
        paid_on: r.get(4)?,
        recorded_at: r.get(5)?,
        amount_paise: r.get(6)?,
        mode: r.get(7)?,
        reference: r.get(8)?,
        voided_at: r.get(9)?,
        void_reason: r.get(10)?,
    })
}

fn not_found() -> StorageError {
    StorageError::Db(rusqlite::Error::QueryReturnedNoRows)
}

/// Increment and return the FY counter inside the issuing transaction
/// (`INSERT … ON CONFLICT(fy) DO UPDATE … RETURNING last_seq`). A rollback
/// leaves no gap; the single writer serialises concurrent issuers.
pub fn next_receipt_seq(tx: &Transaction<'_>, fy: &str, now: &str) -> Result<i64, StorageError> {
    let id = uuid::Uuid::now_v7().to_string();
    let n = tx.query_row(
        "INSERT INTO receipt_sequence (id, fy, last_seq, created_at, updated_at) \
         VALUES (?1, ?2, 1, ?3, ?3) \
         ON CONFLICT(fy) DO UPDATE SET last_seq = last_seq + 1, \
           updated_at = excluded.updated_at, row_version = row_version + 1 \
         RETURNING last_seq",
        params![id, fy, now],
        |r| r.get(0),
    )?;
    Ok(n)
}

fn insert_line(tx: &Transaction<'_>, l: &InvoiceLineRow, now: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO invoice_line (id, invoice_id, position, kind, description, qty, rate_paise, \
           amount_paise, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9)",
        params![
            l.id,
            l.invoice_id,
            l.position,
            l.kind,
            l.description,
            l.qty,
            l.rate_paise,
            l.amount_paise,
            now
        ],
    )?;
    Ok(())
}

/// Insert an issued invoice + its lines (no audit row; the service writes it).
pub fn insert_invoice(
    tx: &Transaction<'_>,
    inv: &InvoiceRow,
    lines: &[InvoiceLineRow],
    now: &str,
) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO invoice (id, patient_id, visit_id, fy, seq, number, issued_on, issued_at, \
           status, discount_kind, discount_value, subtotal_paise, discount_paise, total_paise, \
           paid_paise, balance_paise, gstin_snapshot, voided_at, void_reason, created_at, \
           updated_at, row_version) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, \
           ?18, ?19, ?20, ?20, 0)",
        params![
            inv.id,
            inv.patient_id,
            inv.visit_id,
            inv.fy,
            inv.seq,
            inv.number,
            inv.issued_on,
            inv.issued_at,
            inv.status,
            inv.discount_kind,
            inv.discount_value,
            inv.subtotal_paise,
            inv.discount_paise,
            inv.total_paise,
            inv.paid_paise,
            inv.balance_paise,
            inv.gstin_snapshot,
            inv.voided_at,
            inv.void_reason,
            now
        ],
    )?;
    for l in lines {
        insert_line(tx, l, now)?;
    }
    Ok(())
}

/// Upsert lines by id and soft-delete the invoice's live lines that are not
/// in `lines` (a removed line keeps its history).
pub fn replace_lines(
    tx: &Transaction<'_>,
    invoice_id: &str,
    lines: &[InvoiceLineRow],
    now: &str,
) -> Result<(), StorageError> {
    let existing: Vec<String> = {
        let mut st = tx.prepare(
            "SELECT id FROM invoice_line WHERE invoice_id = ?1 AND deleted_at IS NULL LIMIT 500",
        )?;
        let ids = st
            .query_map([invoice_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        ids
    };
    for id in &existing {
        if !lines.iter().any(|l| &l.id == id) {
            tx.execute(
                "UPDATE invoice_line SET deleted_at = ?2, updated_at = ?2, \
                   row_version = row_version + 1 WHERE id = ?1",
                params![id, now],
            )?;
        }
    }
    for l in lines {
        if existing.contains(&l.id) {
            tx.execute(
                "UPDATE invoice_line SET position = ?2, kind = ?3, description = ?4, qty = ?5, \
                   rate_paise = ?6, amount_paise = ?7, updated_at = ?8, \
                   row_version = row_version + 1 WHERE id = ?1 AND invoice_id = ?9",
                params![
                    l.id,
                    l.position,
                    l.kind,
                    l.description,
                    l.qty,
                    l.rate_paise,
                    l.amount_paise,
                    now,
                    invoice_id
                ],
            )?;
        } else {
            insert_line(tx, l, now)?;
        }
    }
    Ok(())
}

/// Update the money/discount header with a row_version check. A stale
/// `expected_row_version` (or a missing / void row) changes nothing and
/// returns `QueryReturnedNoRows`; the service maps it to a conflict.
pub fn update_invoice_header(
    tx: &Transaction<'_>,
    inv: &InvoiceRow,
    expected_row_version: i64,
    now: &str,
) -> Result<(), StorageError> {
    let n = tx.execute(
        "UPDATE invoice SET discount_kind = ?2, discount_value = ?3, subtotal_paise = ?4, \
           discount_paise = ?5, total_paise = ?6, paid_paise = ?7, balance_paise = ?8, \
           updated_at = ?9, row_version = row_version + 1 \
         WHERE id = ?1 AND row_version = ?10 AND status = 'issued'",
        params![
            inv.id,
            inv.discount_kind,
            inv.discount_value,
            inv.subtotal_paise,
            inv.discount_paise,
            inv.total_paise,
            inv.paid_paise,
            inv.balance_paise,
            now,
            expected_row_version
        ],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    Ok(())
}

/// Insert one payment row (paid / balance are refreshed separately).
pub fn insert_payment(tx: &Transaction<'_>, p: &PaymentRow, now: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT INTO payment (id, invoice_id, patient_id, batch_id, paid_on, recorded_at, \
           amount_paise, mode, reference, voided_at, void_reason, created_at, updated_at) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12)",
        params![
            p.id,
            p.invoice_id,
            p.patient_id,
            p.batch_id,
            p.paid_on,
            p.recorded_at,
            p.amount_paise,
            p.mode,
            p.reference,
            p.voided_at,
            p.void_reason,
            now
        ],
    )?;
    Ok(())
}

fn get_payment(conn: &Connection, id: &str) -> Result<Option<PaymentRow>, StorageError> {
    Ok(conn
        .query_row(
            &format!("SELECT {PAYMENT_COLS} FROM payment WHERE id = ?1"),
            [id],
            payment_from,
        )
        .optional()?)
}

/// Read one payment by id (including voided ones).
pub fn get_payment_by_id(conn: &Connection, id: &str) -> Result<Option<PaymentRow>, StorageError> {
    get_payment(conn, id)
}

/// Void one live payment; returns the updated row. A missing or already
/// voided payment returns `QueryReturnedNoRows`.
pub fn void_payment(
    tx: &Transaction<'_>,
    payment_id: &str,
    reason: &str,
    now: &str,
) -> Result<PaymentRow, StorageError> {
    let n = tx.execute(
        "UPDATE payment SET voided_at = ?2, void_reason = ?3, updated_at = ?2, \
           row_version = row_version + 1 WHERE id = ?1 AND voided_at IS NULL",
        params![payment_id, now, reason],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    get_payment(tx, payment_id)?.ok_or_else(not_found)
}

/// Void an issued invoice (the number is kept) and its live payments, then
/// refresh its paid / balance. Returns the voided payment ids.
pub fn void_invoice(
    tx: &Transaction<'_>,
    invoice_id: &str,
    reason: &str,
    now: &str,
) -> Result<Vec<String>, StorageError> {
    let ids: Vec<String> = {
        let mut st = tx.prepare(
            "SELECT id FROM payment WHERE invoice_id = ?1 AND voided_at IS NULL \
             ORDER BY paid_on, recorded_at LIMIT 500",
        )?;
        let v = st
            .query_map([invoice_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        v
    };
    tx.execute(
        "UPDATE payment SET voided_at = ?2, void_reason = ?3, updated_at = ?2, \
           row_version = row_version + 1 WHERE invoice_id = ?1 AND voided_at IS NULL",
        params![invoice_id, now, reason],
    )?;
    let n = tx.execute(
        "UPDATE invoice SET status = 'void', voided_at = ?2, void_reason = ?3, paid_paise = 0, \
           balance_paise = total_paise, updated_at = ?2, row_version = row_version + 1 \
         WHERE id = ?1 AND status = 'issued'",
        params![invoice_id, now, reason],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    Ok(ids)
}

/// paid = SUM(live payments); balance = total - paid. When paid changes the
/// row version is bumped too, so a void / edit from a screen loaded before a
/// payment was added or cancelled is refused as stale (r5-review-6).
pub fn refresh_invoice_paid(
    tx: &Transaction<'_>,
    invoice_id: &str,
    now: &str,
) -> Result<(), StorageError> {
    let n = tx.execute(
        "WITH live AS (SELECT COALESCE(SUM(amount_paise), 0) AS paid FROM payment \
                       WHERE invoice_id = ?1 AND voided_at IS NULL) \
         UPDATE invoice SET \
           row_version = row_version + \
             (CASE WHEN paid_paise <> (SELECT paid FROM live) THEN 1 ELSE 0 END), \
           paid_paise = (SELECT paid FROM live), \
           balance_paise = total_paise - (SELECT paid FROM live), \
           updated_at = ?2 \
         WHERE id = ?1",
        params![invoice_id, now],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    Ok(())
}

/// Recompute `patient.balance_paise` from its issued invoices (R-DATA-009,
/// in-transaction); returns the new dues.
pub fn refresh_patient_balance(
    tx: &Transaction<'_>,
    patient_id: &str,
    now: &str,
) -> Result<i64, StorageError> {
    let n = tx.execute(
        "UPDATE patient SET balance_paise = (SELECT COALESCE(SUM(balance_paise), 0) FROM invoice \
           WHERE patient_id = ?1 AND status = 'issued'), updated_at = ?2 WHERE id = ?1",
        params![patient_id, now],
    )?;
    if n == 0 {
        return Err(not_found());
    }
    let dues = tx.query_row(
        "SELECT balance_paise FROM patient WHERE id = ?1",
        [patient_id],
        |r| r.get(0),
    )?;
    Ok(dues)
}

/// Write the single audit row of a billing use case.
pub fn write_billing_audit(
    tx: &Transaction<'_>,
    entity: &str,
    entity_id: &str,
    action: AuditAction,
    diff: Value,
    now: &str,
) -> Result<(), StorageError> {
    write_audit(
        tx,
        &AuditEntry {
            user_id: None,
            entity,
            entity_id,
            action,
            diff,
        },
        now,
    )?;
    Ok(())
}

/// Read one invoice.
pub fn get_invoice(conn: &Connection, id: &str) -> Result<Option<InvoiceRow>, StorageError> {
    Ok(conn
        .query_row(
            &format!("SELECT {INVOICE_COLS} FROM invoice WHERE id = ?1 AND deleted_at IS NULL"),
            [id],
            invoice_from,
        )
        .optional()?)
}

/// The live (issued) invoice of a visit.
pub fn live_invoice_for_visit(
    conn: &Connection,
    visit_id: &str,
) -> Result<Option<InvoiceRow>, StorageError> {
    Ok(conn
        .query_row(
            &format!(
                "SELECT {INVOICE_COLS} FROM invoice WHERE visit_id = ?1 AND status = 'issued' \
                 AND deleted_at IS NULL"
            ),
            [visit_id],
            invoice_from,
        )
        .optional()?)
}

/// Live lines by position.
pub fn lines_for_invoice(
    conn: &Connection,
    invoice_id: &str,
) -> Result<Vec<InvoiceLineRow>, StorageError> {
    let mut st = conn.prepare(&format!(
        "SELECT {LINE_COLS} FROM invoice_line WHERE invoice_id = ?1 AND deleted_at IS NULL \
         ORDER BY position, id LIMIT 500"
    ))?;
    let rows = st
        .query_map([invoice_id], line_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// All payments incl. voided, by paid_on, recorded_at.
pub fn payments_for_invoice(
    conn: &Connection,
    invoice_id: &str,
) -> Result<Vec<PaymentRow>, StorageError> {
    let mut st = conn.prepare(&format!(
        "SELECT {PAYMENT_COLS} FROM payment WHERE invoice_id = ?1 AND deleted_at IS NULL \
         ORDER BY paid_on, recorded_at, id LIMIT 500"
    ))?;
    let rows = st
        .query_map([invoice_id], payment_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Issued invoices with balance > 0, oldest first (`issued_on`, `seq`).
pub fn open_invoices_for_patient(
    conn: &Connection,
    patient_id: &str,
    limit: i64,
) -> Result<Vec<InvoiceRow>, StorageError> {
    let mut st = conn.prepare(&format!(
        "SELECT {INVOICE_COLS} FROM invoice WHERE patient_id = ?1 AND status = 'issued' \
         AND balance_paise > 0 AND deleted_at IS NULL ORDER BY issued_on, fy, seq LIMIT ?2"
    ))?;
    let rows = st
        .query_map(params![patient_id, limit], invoice_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Live invoices for a bounded set of visits (at most [`MAX_VISIT_IDS`]; any
/// ids beyond that are ignored).
pub fn live_invoices_for_visits(
    conn: &Connection,
    visit_ids: &[String],
) -> Result<Vec<InvoiceRow>, StorageError> {
    let ids = &visit_ids[..visit_ids.len().min(MAX_VISIT_IDS)];
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let placeholders = vec!["?"; ids.len()].join(",");
    let mut st = conn.prepare(&format!(
        "SELECT {INVOICE_COLS} FROM invoice WHERE status = 'issued' AND deleted_at IS NULL \
         AND visit_id IN ({placeholders}) LIMIT {MAX_VISIT_IDS}"
    ))?;
    let rows = st
        .query_map(params_from_iter(ids.iter()), invoice_from)?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Live payments of one local day, grouped by mode.
pub fn collection_by_mode(
    conn: &Connection,
    paid_on: &str,
) -> Result<Vec<ModeTotal>, StorageError> {
    let mut st = conn.prepare(
        "SELECT mode, COUNT(*), COALESCE(SUM(amount_paise), 0) FROM payment \
         WHERE paid_on = ?1 AND voided_at IS NULL AND deleted_at IS NULL \
         GROUP BY mode ORDER BY mode LIMIT 200",
    )?;
    let rows = st
        .query_map([paid_on], |r| {
            Ok(ModeTotal {
                mode: r.get(0)?,
                count: r.get(1)?,
                amount_paise: r.get(2)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// Live payments in `[from, to_inclusive]`, grouped by day + mode.
pub fn collection_by_day_mode(
    conn: &Connection,
    from: &str,
    to_inclusive: &str,
) -> Result<Vec<DayModeTotal>, StorageError> {
    let mut st = conn.prepare(
        "SELECT paid_on, mode, COUNT(*), COALESCE(SUM(amount_paise), 0) FROM payment \
         WHERE paid_on >= ?1 AND paid_on <= ?2 AND voided_at IS NULL AND deleted_at IS NULL \
         GROUP BY paid_on, mode ORDER BY paid_on, mode LIMIT 200",
    )?;
    let rows = st
        .query_map(params![from, to_inclusive], |r| {
            Ok(DayModeTotal {
                paid_on: r.get(0)?,
                mode: r.get(1)?,
                count: r.get(2)?,
                amount_paise: r.get(3)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;
    Ok(rows)
}

/// SUM(balance) of issued invoices issued that local day.
pub fn outstanding_issued_on(conn: &Connection, issued_on: &str) -> Result<i64, StorageError> {
    Ok(conn.query_row(
        "SELECT COALESCE(SUM(balance_paise), 0) FROM invoice \
         WHERE issued_on = ?1 AND status = 'issued' AND deleted_at IS NULL",
        [issued_on],
        |r| r.get(0),
    )?)
}

/// The patient's running dues (`patient.balance_paise`), or `None` when the
/// patient does not exist or is soft-deleted.
pub fn patient_balance(conn: &Connection, patient_id: &str) -> Result<Option<i64>, StorageError> {
    Ok(conn
        .query_row(
            "SELECT balance_paise FROM patient WHERE id = ?1 AND deleted_at IS NULL",
            [patient_id],
            |r| r.get(0),
        )
        .optional()?)
}

// ---------------------------------------------------------------------------
// Read models (R-ARCH-009): every row a billing read needs, gathered on ONE
// connection here, so the hc-app service maps plain rows and never holds or
// names the database connection itself.
// ---------------------------------------------------------------------------

/// One invoice with its live lines and all its payments (incl. voided).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceBundle {
    /// The invoice header.
    pub invoice: InvoiceRow,
    /// Live lines by position.
    pub lines: Vec<InvoiceLineRow>,
    /// All payments, by paid_on, recorded_at.
    pub payments: Vec<PaymentRow>,
}

/// Everything the S15 invoice screen shows for one visit.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceScreenRows {
    /// The visit being billed.
    pub visit: VisitRow,
    /// Its (live) patient.
    pub patient: PatientRow,
    /// The patient's running dues, paise.
    pub patient_dues_paise: i64,
    /// The clinic profile (fees, GSTIN, name), when set up.
    pub clinic: Option<ClinicProfile>,
    /// The clinic UPI VPA, when set.
    pub upi_vpa: Option<String>,
    /// The invoice shown, or `None` for an unbilled visit.
    pub invoice: Option<InvoiceBundle>,
}

/// Everything a receipt prints for one invoice.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReceiptRows {
    /// The invoice with lines and payments.
    pub invoice: InvoiceBundle,
    /// Its patient (a soft-deleted patient still prints).
    pub patient: PatientRow,
    /// The visit date-time, when the invoice has a live visit.
    pub visit_at: Option<String>,
    /// The clinic profile.
    pub clinic: Option<ClinicProfile>,
    /// The doctor profile.
    pub doctor: Option<DoctorProfile>,
    /// The clinic UPI VPA, when set.
    pub upi_vpa: Option<String>,
}

/// The rows behind a clinic UPI QR: the invoice, the VPA and the clinic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UpiRows {
    /// The invoice.
    pub invoice: InvoiceRow,
    /// The clinic UPI VPA, when set.
    pub upi_vpa: Option<String>,
    /// The clinic name ("" when no profile).
    pub clinic_name: String,
}

/// An invoice with its lines and payments.
pub fn invoice_bundle(
    conn: &Connection,
    invoice: InvoiceRow,
) -> Result<InvoiceBundle, StorageError> {
    let lines = lines_for_invoice(conn, &invoice.id)?;
    let payments = payments_for_invoice(conn, &invoice.id)?;
    Ok(InvoiceBundle {
        invoice,
        lines,
        payments,
    })
}

/// The S15 rows for a visit: its live invoice, or none (a proposal). `None`
/// when the visit or its patient does not exist.
pub fn invoice_screen_rows_for_visit(
    conn: &Connection,
    visit_id: &str,
) -> Result<Option<InvoiceScreenRows>, StorageError> {
    let invoice = live_invoice_for_visit(conn, visit_id)?;
    screen_rows(conn, visit_id, invoice)
}

/// The S15 rows for an invoice (re-read after a write). `None` when the
/// invoice, its visit or its patient does not exist.
pub fn invoice_screen_rows_for_invoice(
    conn: &Connection,
    invoice_id: &str,
) -> Result<Option<InvoiceScreenRows>, StorageError> {
    let Some(invoice) = get_invoice(conn, invoice_id)? else {
        return Ok(None);
    };
    let Some(visit_id) = invoice.visit_id.clone() else {
        return Ok(None);
    };
    screen_rows(conn, &visit_id, Some(invoice))
}

fn screen_rows(
    conn: &Connection,
    visit_id: &str,
    invoice: Option<InvoiceRow>,
) -> Result<Option<InvoiceScreenRows>, StorageError> {
    let Some(visit) = get_visit(conn, visit_id)? else {
        return Ok(None);
    };
    let Some(patient) = get_patient(conn, &visit.patient_id)? else {
        return Ok(None);
    };
    let patient_dues_paise = patient_balance(conn, &patient.id)?.unwrap_or(0);
    let invoice = match invoice {
        Some(inv) => Some(invoice_bundle(conn, inv)?),
        None => None,
    };
    Ok(Some(InvoiceScreenRows {
        visit,
        patient,
        patient_dues_paise,
        clinic: get_clinic_profile(conn)?,
        upi_vpa: read_upi_vpa(conn)?,
        invoice,
    }))
}

/// The receipt rows for an invoice. `None` when the invoice or its patient
/// does not exist.
pub fn receipt_rows(
    conn: &Connection,
    invoice_id: &str,
) -> Result<Option<ReceiptRows>, StorageError> {
    let Some(invoice) = get_invoice(conn, invoice_id)? else {
        return Ok(None);
    };
    let Some(patient) = get_patient_including_deleted(conn, &invoice.patient_id)? else {
        return Ok(None);
    };
    let visit_at = match invoice.visit_id.as_deref() {
        Some(v) => get_visit(conn, v)?.map(|v| v.visit_at),
        None => None,
    };
    Ok(Some(ReceiptRows {
        invoice: invoice_bundle(conn, invoice)?,
        patient,
        visit_at,
        clinic: get_clinic_profile(conn)?,
        doctor: get_doctor_profile(conn)?,
        upi_vpa: read_upi_vpa(conn)?,
    }))
}

/// The UPI QR rows for an invoice, or `None` when it does not exist.
pub fn upi_rows(conn: &Connection, invoice_id: &str) -> Result<Option<UpiRows>, StorageError> {
    let Some(invoice) = get_invoice(conn, invoice_id)? else {
        return Ok(None);
    };
    Ok(Some(UpiRows {
        invoice,
        upi_vpa: read_upi_vpa(conn)?,
        clinic_name: get_clinic_profile(conn)?
            .map(|c| c.name)
            .unwrap_or_default(),
    }))
}
