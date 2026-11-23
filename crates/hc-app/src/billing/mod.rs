//! R5 billing use cases (BILL-001..006; HC-MVP1-148..152; R5 design §6).
//!
//! Invoice per visit (lines, discount, payments by mode, balance in paise),
//! gap-free FY receipt numbers, patient running dues + Clear dues, receipt
//! document, clinic UPI QR. Every write = one transaction + one audit row
//! (R-DATA-001). No patient data in logs (R-PRIV-001).
//!
//! Business-rule failures detected inside a write transaction are returned as
//! `Ok(Err(AppError))` from the writer closure, so the transaction is dropped
//! (rolled back) without committing: a failed save never consumes a receipt
//! number and never leaves a row behind.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use hc_domain::billing::{
    self as rules, Discount, FinancialYear, LineInput, LineKind, PaymentMode, MAX_REFERENCE_CHARS,
    MAX_VOID_REASON_CHARS,
};
use hc_domain::error::DomainError;
use hc_domain::money::Money;
use hc_storage::audit::AuditAction;
use hc_storage::billing::{
    self as repo, InvoiceBundle, InvoiceLineRow, InvoiceRow, InvoiceScreenRows, PaymentRow,
    ReceiptRows, UpiRows,
};
use hc_storage::profile::ClinicProfile;
use hc_storage::Pool;

use crate::clock::Clock;
use crate::error::AppError;

// ---------------------------------------------------------------------------
// Wire types (design §6.2). serde camelCase, specta::Type, money as i64 paise.
// ---------------------------------------------------------------------------

/// One invoice line on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LineDto {
    /// Stored line id (`Some` once saved).
    pub id: Option<String>,
    /// Line kind.
    pub kind: LineKind,
    /// Description.
    pub description: String,
    /// Quantity.
    pub qty: u32,
    /// Rate per unit, paise.
    #[specta(type = specta_typescript::Number)]
    pub rate_paise: i64,
}

/// Discount on the wire.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum DiscountDto {
    /// No discount.
    None,
    /// Fixed amount.
    Amount {
        /// Paise.
        #[specta(type = specta_typescript::Number)]
        paise: i64,
    },
    /// Percent in basis points.
    Percent {
        /// 1% = 100.
        #[serde(rename = "basisPoints")]
        basis_points: u32,
    },
}

/// A payment as entered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    /// Amount, paise (1..=balance).
    #[specta(type = specta_typescript::Number)]
    pub amount_paise: i64,
    /// Mode.
    pub mode: PaymentMode,
    /// Optional UTR / slip reference.
    pub reference: Option<String>,
    /// Local date `YYYY-MM-DD` the money was received.
    pub paid_on: String,
}

/// Computed totals.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TotalsView {
    /// Per-line amounts, input order.
    #[specta(type = Vec<specta_typescript::Number>)]
    pub line_amounts_paise: Vec<i64>,
    /// Subtotal.
    #[specta(type = specta_typescript::Number)]
    pub subtotal_paise: i64,
    /// Discount.
    #[specta(type = specta_typescript::Number)]
    pub discount_paise: i64,
    /// Total.
    #[specta(type = specta_typescript::Number)]
    pub total_paise: i64,
}

/// One payment as shown.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PaymentView {
    /// Payment id.
    pub payment_id: String,
    /// Local date.
    pub paid_on: String,
    /// Amount.
    #[specta(type = specta_typescript::Number)]
    pub amount_paise: i64,
    /// Mode.
    pub mode: PaymentMode,
    /// Reference.
    pub reference: Option<String>,
    /// Cancelled (payment void).
    pub voided: bool,
}

/// Invoice status.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InvoiceStatus {
    /// Issued (live).
    Issued,
    /// Cancelled; number kept.
    Void,
}

/// One saved invoice.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceView {
    /// Invoice id.
    pub invoice_id: String,
    /// Optimistic-concurrency version.
    #[specta(type = specta_typescript::Number)]
    pub row_version: i64,
    /// Receipt number `2026-27/0001`.
    pub number: String,
    /// FY label.
    pub fy: String,
    /// Local issue date.
    pub issued_on: String,
    /// Status.
    pub status: InvoiceStatus,
    /// Live lines (ids set).
    pub lines: Vec<LineDto>,
    /// Discount.
    pub discount: DiscountDto,
    /// Totals.
    pub totals: TotalsView,
    /// Paid (live payments).
    #[specta(type = specta_typescript::Number)]
    pub paid_paise: i64,
    /// Balance.
    #[specta(type = specta_typescript::Number)]
    pub balance_paise: i64,
    /// All payments incl. cancelled.
    pub payments: Vec<PaymentView>,
    /// Void reason when void.
    pub void_reason: Option<String>,
}

/// Patient header of the invoice screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BillPatient {
    /// Patient id.
    pub patient_id: String,
    /// Patient code.
    pub code: String,
    /// Display name.
    pub name: String,
}

/// Visit header of the invoice screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BillVisit {
    /// Visit id.
    pub visit_id: String,
    /// RFC3339 visit instant.
    pub visit_at: String,
    /// Visit type code.
    pub visit_type: String,
}

/// The whole S15 screen payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceScreen {
    /// Patient.
    pub patient: BillPatient,
    /// Visit.
    pub visit: BillVisit,
    /// The live (or just-voided) invoice; `None` = unbilled.
    pub invoice: Option<InvoiceView>,
    /// Prefilled lines when unbilled.
    pub proposal: Option<Vec<LineDto>>,
    /// Patient running dues after this operation.
    #[specta(type = specta_typescript::Number)]
    pub patient_dues_paise: i64,
    /// Clinic VPA is set.
    pub upi_configured: bool,
    /// GSTIN (snapshot if issued, else current).
    pub gstin: Option<String>,
}

/// Bill summary of one visit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitBill {
    /// Invoice id.
    pub invoice_id: String,
    /// Receipt number.
    pub number: String,
    /// Total.
    #[specta(type = specta_typescript::Number)]
    pub total_paise: i64,
    /// Balance.
    #[specta(type = specta_typescript::Number)]
    pub balance_paise: i64,
}

/// `billing_visit_status` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitBillingStatus {
    /// Visit id.
    pub visit_id: String,
    /// Patient id.
    pub patient_id: String,
    /// Patient running dues.
    #[specta(type = specta_typescript::Number)]
    pub patient_dues_paise: i64,
    /// This visit's live bill, if any.
    pub bill: Option<VisitBill>,
}

/// One open invoice (dues dialog).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenInvoice {
    /// Invoice id.
    pub invoice_id: String,
    /// Receipt number.
    pub number: String,
    /// Local issue date.
    pub issued_on: String,
    /// Balance.
    #[specta(type = specta_typescript::Number)]
    pub balance_paise: i64,
}

/// `patient_dues_get` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatientDues {
    /// Patient id.
    pub patient_id: String,
    /// Running dues.
    #[specta(type = specta_typescript::Number)]
    pub dues_paise: i64,
    /// Open invoices, oldest first.
    pub open_invoices: Vec<OpenInvoice>,
}

/// One Clear-dues allocation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Allocation {
    /// Invoice id.
    pub invoice_id: String,
    /// Receipt number.
    pub number: String,
    /// Amount allocated.
    #[specta(type = specta_typescript::Number)]
    pub amount_paise: i64,
}

/// `patient_clear_dues` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClearDuesResult {
    /// Shared batch id.
    pub batch_id: String,
    /// Allocations, oldest first.
    pub allocations: Vec<Allocation>,
    /// Dues after.
    #[specta(type = specta_typescript::Number)]
    pub dues_paise: i64,
}

/// `invoice_upi_qr` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UpiQrView {
    /// A QR can be shown.
    pub available: bool,
    /// `upi://pay?...`.
    pub upi_url: Option<String>,
    /// `data:image/svg+xml;base64,...`.
    pub qr_data_url: Option<String>,
    /// Amount encoded (the balance).
    #[specta(type = specta_typescript::Number)]
    pub amount_paise: i64,
}

/// `receipt_get` response: everything the receipt prints.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReceiptDoc {
    /// Clinic name.
    pub clinic_name: String,
    /// Clinic address.
    pub clinic_address: String,
    /// Clinic phone, if set.
    pub clinic_phone: Option<String>,
    /// Clinic GSTIN snapshot at issue (printed only when set, BILL-006).
    pub gstin: Option<String>,
    /// Doctor name.
    pub doctor_name: String,
    /// Doctor qualification.
    pub doctor_qualification: String,
    /// Doctor registration number.
    pub doctor_reg_no: String,
    /// Receipt number `2026-27/0001`.
    pub number: String,
    /// Local issue date `YYYY-MM-DD`.
    pub issued_on: String,
    /// Patient display name.
    pub patient_name: String,
    /// Patient code.
    pub patient_code: String,
    /// RFC3339 visit instant.
    pub visit_on: String,
    /// Invoice lines.
    pub lines: Vec<LineDto>,
    /// Totals.
    pub totals: TotalsView,
    /// Discount.
    pub discount: DiscountDto,
    /// Live payments only.
    pub payments: Vec<PaymentView>,
    /// Paid (live payments), paise.
    #[specta(type = specta_typescript::Number)]
    pub paid_paise: i64,
    /// Balance, paise.
    #[specta(type = specta_typescript::Number)]
    pub balance_paise: i64,
    /// `amount_in_words(paid_paise)`.
    pub paid_in_words: String,
    /// CANCELLED watermark.
    pub void: bool,
    /// UPI QR when balance > 0 and a VPA is set.
    pub upi_qr_data_url: Option<String>,
}

// ---------------------------------------------------------------------------
// Requests (design §6.3).
// ---------------------------------------------------------------------------

/// `invoice_get_for_visit`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceGetForVisitRequest {
    /// Visit id.
    pub visit_id: String,
    /// The clinic-local date `YYYY-MM-DD` (±1 day of the clock).
    pub local_today: String,
}

/// `invoice_compute_totals`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ComputeTotalsRequest {
    /// Invoice lines.
    pub lines: Vec<LineDto>,
    /// Discount.
    pub discount: DiscountDto,
}

/// `invoice_save` (create when `invoice_id` is `None`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceSaveRequest {
    /// Visit id.
    pub visit_id: String,
    /// Invoice id.
    pub invoice_id: Option<String>,
    /// Row version the editor loaded (stale = conflict).
    #[specta(type = Option<specta_typescript::Number>)]
    pub expected_row_version: Option<i64>,
    /// Invoice lines.
    pub lines: Vec<LineDto>,
    /// Discount.
    pub discount: DiscountDto,
    /// The payment.
    pub payment: Option<PaymentInput>,
    /// The clinic-local date `YYYY-MM-DD` (±1 day of the clock).
    pub local_today: String,
}

/// `payment_add`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PaymentAddRequest {
    /// Invoice id.
    pub invoice_id: String,
    /// The payment.
    pub payment: PaymentInput,
}

/// `payment_void`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PaymentVoidRequest {
    /// Payment id.
    pub payment_id: String,
    /// Why (required, <= 200 chars).
    pub reason: String,
}

/// `invoice_void`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceVoidRequest {
    /// Invoice id.
    pub invoice_id: String,
    /// Why (required, <= 200 chars).
    pub reason: String,
    /// Row version the editor loaded (stale = conflict).
    #[specta(type = specta_typescript::Number)]
    pub expected_row_version: i64,
}

/// `invoice_upi_qr` / `receipt_get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct InvoiceIdRequest {
    /// Invoice id.
    pub invoice_id: String,
}

/// `billing_visit_status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct VisitIdRequest {
    /// Visit id.
    pub visit_id: String,
}

/// `patient_dues_get`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PatientIdRequest {
    /// Patient id.
    pub patient_id: String,
}

/// `patient_clear_dues`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ClearDuesRequest {
    /// Patient id.
    pub patient_id: String,
    /// The payment.
    pub payment: PaymentInput,
    /// Dues the dialog opened with (stale = conflict).
    #[specta(type = specta_typescript::Number)]
    pub expected_dues_paise: i64,
}

// ---------------------------------------------------------------------------
// Helpers (pure).
// ---------------------------------------------------------------------------

/// Upper bound on the open invoices one Clear-dues allocation reads.
const OPEN_INVOICE_LIMIT: i64 = 500;

fn invalid() -> AppError {
    AppError::Validation(DomainError::Invalid)
}

fn line_kind_str(k: LineKind) -> &'static str {
    match k {
        LineKind::Consultation => "consultation",
        LineKind::Medicine => "medicine",
        LineKind::Other => "other",
    }
}

fn line_kind_from(s: &str) -> LineKind {
    match s {
        "consultation" => LineKind::Consultation,
        "medicine" => LineKind::Medicine,
        _ => LineKind::Other,
    }
}

fn mode_str(m: PaymentMode) -> &'static str {
    match m {
        PaymentMode::Cash => "cash",
        PaymentMode::Upi => "upi",
        PaymentMode::Card => "card",
        PaymentMode::Other => "other",
    }
}

fn mode_from(s: &str) -> PaymentMode {
    match s {
        "cash" => PaymentMode::Cash,
        "upi" => PaymentMode::Upi,
        "card" => PaymentMode::Card,
        _ => PaymentMode::Other,
    }
}

/// Days since 1970-01-01 of a proleptic Gregorian date (Hinnant's algorithm).
fn day_number(y: i32, m: u32, d: u32) -> i64 {
    let y = i64::from(if m <= 2 { y - 1 } else { y });
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let m = i64::from(m);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + i64::from(d) - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Day number of a strict `YYYY-MM-DD`, or `Validation`.
fn parse_day(s: &str) -> Result<i64, AppError> {
    let (y, m, d) = rules::parse_iso_date(s).ok_or_else(invalid)?;
    Ok(day_number(y, m, d))
}

/// Day number of a stored (validated-on-write) local date; an unreadable
/// value imposes no lower bound.
fn stored_day(s: &str) -> i64 {
    parse_day(s).unwrap_or(i64::MIN)
}

/// Day number of the UTC date of the clock instant.
fn clock_day(now: &str) -> Result<i64, AppError> {
    parse_day(now.get(..10).ok_or_else(invalid)?)
}

/// A15: the UI's local date must be within ±1 day of the clock's UTC date.
fn check_local_today(local_today: &str, now: &str) -> Result<(), AppError> {
    let day = parse_day(local_today)?;
    let clock = clock_day(now)?;
    if (day - clock).abs() > 1 {
        return Err(invalid());
    }
    Ok(())
}

fn money(p: i64) -> Result<Money, AppError> {
    Ok(Money::from_paise(p)?)
}

fn discount_from(d: &DiscountDto) -> Result<Discount, AppError> {
    Ok(match d {
        DiscountDto::None => Discount::None,
        DiscountDto::Amount { paise } => Discount::Amount(money(*paise)?),
        DiscountDto::Percent { basis_points } => Discount::Percent {
            basis_points: *basis_points,
        },
    })
}

fn discount_kind_value(d: &DiscountDto) -> (&'static str, i64) {
    match d {
        DiscountDto::None => ("none", 0),
        DiscountDto::Amount { paise } => ("amount", *paise),
        DiscountDto::Percent { basis_points } => ("percent", i64::from(*basis_points)),
    }
}

fn discount_dto_from(kind: &str, value: i64) -> DiscountDto {
    match kind {
        "amount" => DiscountDto::Amount { paise: value },
        "percent" => DiscountDto::Percent {
            basis_points: u32::try_from(value).unwrap_or(0),
        },
        _ => DiscountDto::None,
    }
}

/// Validate + compute totals over wire lines (the single money path).
fn totals_for(lines: &[LineDto], discount: &DiscountDto) -> Result<rules::InvoiceTotals, AppError> {
    let inputs = lines
        .iter()
        .map(|l| {
            Ok(LineInput {
                kind: l.kind,
                description: l.description.clone(),
                qty: l.qty,
                rate: money(l.rate_paise)?,
            })
        })
        .collect::<Result<Vec<_>, AppError>>()?;
    Ok(rules::compute_totals(&inputs, &discount_from(discount)?)?)
}

fn totals_view(t: &rules::InvoiceTotals) -> TotalsView {
    TotalsView {
        line_amounts_paise: t.lines.iter().map(|m| m.paise()).collect(),
        subtotal_paise: t.subtotal.paise(),
        discount_paise: t.discount.paise(),
        total_paise: t.total.paise(),
    }
}

/// A payment that passed the input rules (amount > 0, reference <= 64 chars,
/// strict date not after the clock date + 1).
struct CheckedPayment {
    amount: i64,
    mode: PaymentMode,
    reference: Option<String>,
    paid_on: String,
    day: i64,
}

fn check_payment(p: &PaymentInput, now: &str) -> Result<CheckedPayment, AppError> {
    if p.amount_paise <= 0 {
        return Err(invalid());
    }
    let reference = p
        .reference
        .as_deref()
        .map(str::trim)
        .filter(|r| !r.is_empty())
        .map(str::to_string);
    if reference
        .as_deref()
        .is_some_and(|r| r.chars().count() > MAX_REFERENCE_CHARS)
    {
        return Err(invalid());
    }
    let day = parse_day(&p.paid_on)?;
    if day > clock_day(now)? + 1 {
        return Err(invalid());
    }
    Ok(CheckedPayment {
        amount: p.amount_paise,
        mode: p.mode,
        reference,
        paid_on: p.paid_on.clone(),
        day,
    })
}

/// A trimmed, non-blank void reason of at most 200 chars.
fn check_reason(raw: &str) -> Result<String, AppError> {
    let r = raw.trim();
    if r.is_empty() || r.chars().count() > MAX_VOID_REASON_CHARS {
        return Err(invalid());
    }
    Ok(r.to_string())
}

fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

fn payment_row(
    p: &CheckedPayment,
    invoice_id: &str,
    patient_id: &str,
    batch_id: Option<&str>,
    amount: i64,
    now: &str,
) -> PaymentRow {
    PaymentRow {
        id: new_id(),
        invoice_id: invoice_id.to_string(),
        patient_id: patient_id.to_string(),
        batch_id: batch_id.map(str::to_string),
        paid_on: p.paid_on.clone(),
        recorded_at: now.to_string(),
        amount_paise: amount,
        mode: mode_str(p.mode).to_string(),
        reference: p.reference.clone(),
        voided_at: None,
        void_reason: None,
    }
}

fn payment_json(p: &CheckedPayment) -> Value {
    json!({
        "amount_paise": p.amount,
        "mode": mode_str(p.mode),
        "reference": p.reference,
        "paid_on": p.paid_on,
    })
}

fn lines_json(lines: &[InvoiceLineRow]) -> Value {
    Value::Array(
        lines
            .iter()
            .map(|l| {
                json!({
                    "kind": l.kind,
                    "description": l.description,
                    "qty": l.qty,
                    "rate_paise": l.rate_paise,
                    "amount_paise": l.amount_paise,
                })
            })
            .collect(),
    )
}

fn header_json(inv: &InvoiceRow) -> Value {
    json!({
        "discount_kind": inv.discount_kind,
        "discount_value": inv.discount_value,
        "subtotal_paise": inv.subtotal_paise,
        "discount_paise": inv.discount_paise,
        "total_paise": inv.total_paise,
    })
}

/// Build the stored line rows (ids kept for existing lines, fresh otherwise).
fn line_rows(
    invoice_id: &str,
    lines: &[LineDto],
    totals: &rules::InvoiceTotals,
) -> Vec<InvoiceLineRow> {
    lines
        .iter()
        .zip(&totals.lines)
        .enumerate()
        .map(|(i, (l, amount))| InvoiceLineRow {
            id: l.id.clone().unwrap_or_else(new_id),
            invoice_id: invoice_id.to_string(),
            position: i64::try_from(i).unwrap_or(i64::MAX),
            kind: line_kind_str(l.kind).to_string(),
            description: l.description.trim().to_string(),
            qty: i64::from(l.qty),
            rate_paise: l.rate_paise,
            amount_paise: amount.paise(),
        })
        .collect()
}

/// The [`VisitBill`] of `visit_id` among already-loaded live invoices.
pub(crate) fn visit_bill_for(bills: &[InvoiceRow], visit_id: &str) -> Option<VisitBill> {
    bills
        .iter()
        .find(|b| b.visit_id.as_deref() == Some(visit_id))
        .map(|b| VisitBill {
            invoice_id: b.id.clone(),
            number: b.number.clone(),
            total_paise: b.total_paise,
            balance_paise: b.balance_paise,
        })
}

// ---------------------------------------------------------------------------
// Read helpers (one connection).
// ---------------------------------------------------------------------------

fn invoice_view(bundle: &InvoiceBundle) -> InvoiceView {
    let InvoiceBundle {
        invoice: inv,
        lines,
        payments,
    } = bundle;
    InvoiceView {
        invoice_id: inv.id.clone(),
        row_version: inv.row_version,
        number: inv.number.clone(),
        fy: inv.fy.clone(),
        issued_on: inv.issued_on.clone(),
        status: if inv.status == "void" {
            InvoiceStatus::Void
        } else {
            InvoiceStatus::Issued
        },
        totals: TotalsView {
            line_amounts_paise: lines.iter().map(|l| l.amount_paise).collect(),
            subtotal_paise: inv.subtotal_paise,
            discount_paise: inv.discount_paise,
            total_paise: inv.total_paise,
        },
        lines: lines.iter().map(line_dto).collect(),
        discount: discount_dto_from(&inv.discount_kind, inv.discount_value),
        paid_paise: inv.paid_paise,
        balance_paise: inv.balance_paise,
        payments: payments.iter().map(payment_view).collect(),
        void_reason: inv.void_reason.clone(),
    }
}

fn line_dto(l: &InvoiceLineRow) -> LineDto {
    LineDto {
        id: Some(l.id.clone()),
        kind: line_kind_from(&l.kind),
        description: l.description.clone(),
        qty: u32::try_from(l.qty).unwrap_or(0),
        rate_paise: l.rate_paise,
    }
}

fn payment_view(p: &PaymentRow) -> PaymentView {
    PaymentView {
        payment_id: p.id.clone(),
        paid_on: p.paid_on.clone(),
        amount_paise: p.amount_paise,
        mode: mode_from(&p.mode),
        reference: p.reference.clone(),
        voided: p.voided_at.is_some(),
    }
}

/// The proposal for an unbilled visit: one consultation line at the clinic
/// fee for its type, or no line when that fee is 0.
fn proposal(clinic: Option<&ClinicProfile>, visit_type: &str) -> Vec<LineDto> {
    let (desc, fee) = if visit_type == "first" {
        (
            "Consultation (first visit)",
            clinic.map_or(0, |c| c.fee_first_paise),
        )
    } else {
        (
            "Consultation (follow-up)",
            clinic.map_or(0, |c| c.fee_followup_paise),
        )
    };
    if fee <= 0 {
        return Vec::new();
    }
    vec![LineDto {
        id: None,
        kind: LineKind::Consultation,
        description: desc.to_string(),
        qty: 1,
        rate_paise: fee,
    }]
}

/// Assemble the S15 payload from the rows read for a visit; `None` (visit
/// or patient missing) is NotFound.
fn screen(rows: Option<InvoiceScreenRows>) -> Result<InvoiceScreen, AppError> {
    let InvoiceScreenRows {
        visit,
        patient,
        patient_dues_paise,
        clinic,
        upi_vpa,
        invoice,
    } = rows.ok_or(AppError::NotFound)?;
    let (invoice_view_opt, proposal_opt, gstin) = match invoice {
        Some(bundle) => {
            let gstin = bundle.invoice.gstin_snapshot.clone();
            (Some(invoice_view(&bundle)), None, gstin)
        }
        None => {
            let proposal = proposal(clinic.as_ref(), &visit.visit_type);
            (None, Some(proposal), clinic.and_then(|c| c.gstin))
        }
    };
    Ok(InvoiceScreen {
        patient: BillPatient {
            patient_id: patient.id,
            code: patient.code,
            name: patient.name,
        },
        visit: BillVisit {
            visit_id: visit.id,
            visit_at: visit.visit_at,
            visit_type: visit.visit_type,
        },
        invoice: invoice_view_opt,
        proposal: proposal_opt,
        patient_dues_paise,
        upi_configured: upi_vpa.is_some(),
        gstin,
    })
}

/// Screen for an invoice id (its visit), re-read after a write.
fn screen_for_invoice(pool: &Pool, invoice_id: &str) -> Result<InvoiceScreen, AppError> {
    screen(pool.with_reader(|c| repo::invoice_screen_rows_for_invoice(c, invoice_id))?)
}

/// The UPI link for an invoice when a VPA is set, the bill is live and has a
/// balance. Carries the clinic name and the receipt number only.
fn upi_link(
    inv: &InvoiceRow,
    upi_vpa: Option<&str>,
    clinic_name: &str,
) -> Result<Option<String>, AppError> {
    if inv.status != "issued" || inv.balance_paise <= 0 {
        return Ok(None);
    }
    let Some(vpa) = upi_vpa else {
        return Ok(None);
    };
    Ok(Some(rules::upi_pay_url(
        vpa,
        clinic_name,
        money(inv.balance_paise)?,
        &format!("Receipt {}", inv.number),
    )))
}

fn qr_data_url(url: &str) -> Result<String, AppError> {
    let svg = hc_docs::qr::qr_svg(url).map_err(|_| invalid())?;
    Ok(hc_docs::qr::svg_data_url(&svg))
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/// Billing use-case service. The open [`Pool`] is passed per call.
pub struct BillingService<'a> {
    clock: &'a dyn Clock,
}

impl<'a> BillingService<'a> {
    /// New service over the injected clock.
    pub fn new(clock: &'a dyn Clock) -> Self {
        Self { clock }
    }

    /// `invoice_get_for_visit`: the visit's live invoice, or an unsaved
    /// proposal prefilled with the clinic consultation fee.
    pub fn get_for_visit(
        &self,
        pool: &Pool,
        req: InvoiceGetForVisitRequest,
    ) -> Result<InvoiceScreen, AppError> {
        screen(pool.with_reader(|c| repo::invoice_screen_rows_for_visit(c, &req.visit_id))?)
    }

    /// `invoice_compute_totals` (pure, so the UI never does money maths).
    pub fn compute_totals(&self, req: ComputeTotalsRequest) -> Result<TotalsView, AppError> {
        Ok(totals_view(&totals_for(&req.lines, &req.discount)?))
    }

    /// `invoice_save`: create (issue + number) when `invoice_id` is `None`,
    /// else edit the issued invoice. Optional payment in the same transaction.
    pub fn save(&self, pool: &Pool, req: InvoiceSaveRequest) -> Result<InvoiceScreen, AppError> {
        let now = self.clock.now_rfc3339();
        check_local_today(&req.local_today, &now)?;
        let totals = totals_for(&req.lines, &req.discount)?;
        let payment = req
            .payment
            .as_ref()
            .map(|p| check_payment(p, &now))
            .transpose()?;
        match req.invoice_id.clone() {
            None => self.create(pool, &req, &totals, payment, &now),
            Some(id) => self.update(pool, &req, &id, &totals, payment, &now),
        }
    }

    fn create(
        &self,
        pool: &Pool,
        req: &InvoiceSaveRequest,
        totals: &rules::InvoiceTotals,
        payment: Option<CheckedPayment>,
        now: &str,
    ) -> Result<InvoiceScreen, AppError> {
        let fy = FinancialYear::of_date(&req.local_today)?;
        let issued_day = parse_day(&req.local_today)?;
        if req.lines.iter().any(|l| l.id.is_some()) {
            return Err(invalid());
        }
        if let Some(p) = &payment {
            if p.day < issued_day {
                return Err(invalid());
            }
            if p.amount > totals.total.paise() {
                return Err(AppError::PaymentExceedsBalance);
            }
        }
        let invoice_id = pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(visit) = hc_storage::visit::get_visit(&tx, &req.visit_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            if hc_storage::patient::get_patient(&tx, &visit.patient_id)?.is_none() {
                return Ok(Err(AppError::NotFound));
            }
            if repo::live_invoice_for_visit(&tx, &visit.id)?.is_some() {
                return Ok(Err(AppError::Conflict));
            }
            let gstin = hc_storage::profile::get_clinic_profile(&tx)?.and_then(|c| c.gstin);
            let label = fy.label();
            let seq = repo::next_receipt_seq(&tx, &label, now)?;
            let number = rules::receipt_number(&fy, u32::try_from(seq).unwrap_or(u32::MAX));
            let id = new_id();
            let (kind, value) = discount_kind_value(&req.discount);
            let inv = InvoiceRow {
                id: id.clone(),
                patient_id: visit.patient_id.clone(),
                visit_id: Some(visit.id.clone()),
                fy: label,
                seq,
                number: number.clone(),
                issued_on: req.local_today.clone(),
                issued_at: now.to_string(),
                status: "issued".to_string(),
                discount_kind: kind.to_string(),
                discount_value: value,
                subtotal_paise: totals.subtotal.paise(),
                discount_paise: totals.discount.paise(),
                total_paise: totals.total.paise(),
                paid_paise: 0,
                balance_paise: totals.total.paise(),
                gstin_snapshot: gstin,
                voided_at: None,
                void_reason: None,
                row_version: 0,
            };
            let lines = line_rows(&id, &req.lines, totals);
            repo::insert_invoice(&tx, &inv, &lines, now)?;
            if let Some(p) = &payment {
                let row = payment_row(p, &id, &visit.patient_id, None, p.amount, now);
                repo::insert_payment(&tx, &row, now)?;
            }
            repo::refresh_invoice_paid(&tx, &id, now)?;
            repo::refresh_patient_balance(&tx, &visit.patient_id, now)?;
            repo::write_billing_audit(
                &tx,
                "invoice",
                &id,
                AuditAction::Create,
                json!({
                    "number": {"new": number},
                    "totals": {"new": header_json(&inv)},
                    "lines": {"new": lines_json(&lines)},
                    "payment": {"new": payment.as_ref().map(payment_json)},
                }),
                now,
            )?;
            tx.commit()?;
            Ok(Ok(id))
        })??;
        screen_for_invoice(pool, &invoice_id)
    }

    fn update(
        &self,
        pool: &Pool,
        req: &InvoiceSaveRequest,
        invoice_id: &str,
        totals: &rules::InvoiceTotals,
        payment: Option<CheckedPayment>,
        now: &str,
    ) -> Result<InvoiceScreen, AppError> {
        let expected = req.expected_row_version.ok_or_else(invalid)?;
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(old) = repo::get_invoice(&tx, invoice_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            if old.status == "void" {
                return Ok(Err(AppError::InvoiceVoided));
            }
            if old.visit_id.as_deref() != Some(req.visit_id.as_str()) {
                return Ok(Err(invalid()));
            }
            if old.row_version != expected {
                return Ok(Err(AppError::Conflict));
            }
            let old_lines = repo::lines_for_invoice(&tx, invoice_id)?;
            let known = |id: &String| old_lines.iter().any(|l| &l.id == id);
            if req
                .lines
                .iter()
                .any(|l| l.id.as_ref().is_some_and(|id| !known(id)))
            {
                return Ok(Err(invalid()));
            }
            let total = totals.total.paise();
            if total < old.paid_paise {
                return Ok(Err(AppError::TotalBelowPaid));
            }
            if let Some(p) = &payment {
                if p.day < stored_day(&old.issued_on) {
                    return Ok(Err(invalid()));
                }
                if p.amount > total - old.paid_paise {
                    return Ok(Err(AppError::PaymentExceedsBalance));
                }
            }
            let (kind, value) = discount_kind_value(&req.discount);
            let new = InvoiceRow {
                discount_kind: kind.to_string(),
                discount_value: value,
                subtotal_paise: totals.subtotal.paise(),
                discount_paise: totals.discount.paise(),
                total_paise: total,
                balance_paise: total - old.paid_paise,
                ..old.clone()
            };
            let lines = line_rows(invoice_id, &req.lines, totals);
            repo::update_invoice_header(&tx, &new, expected, now)?;
            repo::replace_lines(&tx, invoice_id, &lines, now)?;
            if let Some(p) = &payment {
                let row = payment_row(p, invoice_id, &old.patient_id, None, p.amount, now);
                repo::insert_payment(&tx, &row, now)?;
            }
            repo::refresh_invoice_paid(&tx, invoice_id, now)?;
            repo::refresh_patient_balance(&tx, &old.patient_id, now)?;
            let mut diff = hc_storage::audit::diff_objects(&header_json(&old), &header_json(&new));
            if let Some(obj) = diff.as_object_mut() {
                let (ol, nl) = (lines_json(&old_lines), lines_json(&lines));
                if ol != nl {
                    obj.insert("lines".into(), json!({"old": ol, "new": nl}));
                }
                if let Some(p) = &payment {
                    obj.insert("payment".into(), json!({"new": payment_json(p)}));
                }
            }
            repo::write_billing_audit(&tx, "invoice", invoice_id, AuditAction::Update, diff, now)?;
            tx.commit()?;
            Ok(Ok(()))
        })??;
        screen_for_invoice(pool, invoice_id)
    }

    /// `payment_add`: one payment against a live invoice (<= its balance).
    pub fn payment_add(
        &self,
        pool: &Pool,
        req: PaymentAddRequest,
    ) -> Result<InvoiceScreen, AppError> {
        let now = self.clock.now_rfc3339();
        let p = check_payment(&req.payment, &now)?;
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(inv) = repo::get_invoice(&tx, &req.invoice_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            if inv.status == "void" {
                return Ok(Err(AppError::InvoiceVoided));
            }
            if p.day < stored_day(&inv.issued_on) {
                return Ok(Err(invalid()));
            }
            if p.amount > inv.balance_paise {
                return Ok(Err(AppError::PaymentExceedsBalance));
            }
            let row = payment_row(&p, &inv.id, &inv.patient_id, None, p.amount, &now);
            repo::insert_payment(&tx, &row, &now)?;
            repo::refresh_invoice_paid(&tx, &inv.id, &now)?;
            repo::refresh_patient_balance(&tx, &inv.patient_id, &now)?;
            repo::write_billing_audit(
                &tx,
                "payment",
                &row.id,
                AuditAction::Create,
                json!({
                    "invoice": {"new": inv.number},
                    "payment": {"new": payment_json(&p)},
                }),
                &now,
            )?;
            tx.commit()?;
            Ok(Ok(()))
        })??;
        screen_for_invoice(pool, &req.invoice_id)
    }

    /// `payment_void`: cancel a mistaken payment (reason required, once only).
    pub fn payment_void(
        &self,
        pool: &Pool,
        req: PaymentVoidRequest,
    ) -> Result<InvoiceScreen, AppError> {
        let now = self.clock.now_rfc3339();
        let reason = check_reason(&req.reason)?;
        let invoice_id = pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(p) = repo::get_payment_by_id(&tx, &req.payment_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            if p.voided_at.is_some() {
                return Ok(Err(invalid()));
            }
            repo::void_payment(&tx, &p.id, &reason, &now)?;
            repo::refresh_invoice_paid(&tx, &p.invoice_id, &now)?;
            repo::refresh_patient_balance(&tx, &p.patient_id, &now)?;
            repo::write_billing_audit(
                &tx,
                "payment",
                &p.id,
                AuditAction::Update,
                json!({
                    "voided": {"old": false, "new": true},
                    "reason": {"new": reason},
                }),
                &now,
            )?;
            tx.commit()?;
            Ok(Ok(p.invoice_id))
        })??;
        screen_for_invoice(pool, &invoice_id)
    }

    /// `invoice_void`: cancel a bill (number kept) and its live payments.
    pub fn invoice_void(
        &self,
        pool: &Pool,
        req: InvoiceVoidRequest,
    ) -> Result<InvoiceScreen, AppError> {
        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(inv) = repo::get_invoice(&tx, &req.invoice_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            if inv.status == "void" {
                return Ok(Err(AppError::InvoiceVoided));
            }
            let reason = match check_reason(&req.reason) {
                Ok(r) => r,
                Err(e) => return Ok(Err(e)),
            };
            if inv.row_version != req.expected_row_version {
                return Ok(Err(AppError::Conflict));
            }
            let voided = repo::void_invoice(&tx, &inv.id, &reason, &now)?;
            repo::refresh_patient_balance(&tx, &inv.patient_id, &now)?;
            repo::write_billing_audit(
                &tx,
                "invoice",
                &inv.id,
                AuditAction::Update,
                json!({
                    "status": {"old": "issued", "new": "void"},
                    "voided_payments": {"new": voided},
                    "reason": {"new": reason},
                }),
                &now,
            )?;
            tx.commit()?;
            Ok(Ok(()))
        })??;
        screen_for_invoice(pool, &req.invoice_id)
    }

    /// `invoice_upi_qr`: the clinic UPI QR for the current balance.
    pub fn upi_qr(&self, pool: &Pool, req: InvoiceIdRequest) -> Result<UpiQrView, AppError> {
        let UpiRows {
            invoice: inv,
            upi_vpa,
            clinic_name,
        } = pool
            .with_reader(|c| repo::upi_rows(c, &req.invoice_id))?
            .ok_or(AppError::NotFound)?;
        let url = upi_link(&inv, upi_vpa.as_deref(), &clinic_name)?;
        match url {
            Some(u) => Ok(UpiQrView {
                available: true,
                qr_data_url: Some(qr_data_url(&u)?),
                upi_url: Some(u),
                amount_paise: inv.balance_paise,
            }),
            None => Ok(UpiQrView {
                available: false,
                upi_url: None,
                qr_data_url: None,
                amount_paise: inv.balance_paise,
            }),
        }
    }

    /// `receipt_get`: everything the receipt prints.
    pub fn receipt(&self, pool: &Pool, req: InvoiceIdRequest) -> Result<ReceiptDoc, AppError> {
        let rows = pool
            .with_reader(|c| repo::receipt_rows(c, &req.invoice_id))?
            .ok_or(AppError::NotFound)?;
        Self::receipt_doc(rows)
    }

    /// The receipt document from the rows read for one invoice.
    fn receipt_doc(rows: ReceiptRows) -> Result<ReceiptDoc, AppError> {
        let ReceiptRows {
            invoice: bundle,
            patient,
            visit_at,
            clinic,
            doctor,
            upi_vpa,
        } = rows;
        let view = invoice_view(&bundle);
        let inv = bundle.invoice;
        let visit_on = visit_at.unwrap_or_default();
        let clinic_name = clinic.as_ref().map(|x| x.name.clone()).unwrap_or_default();
        let qr = match upi_link(&inv, upi_vpa.as_deref(), &clinic_name)? {
            Some(u) => Some(qr_data_url(&u)?),
            None => None,
        };
        Ok(ReceiptDoc {
            clinic_name: clinic.as_ref().map(|x| x.name.clone()).unwrap_or_default(),
            clinic_address: clinic
                .as_ref()
                .map(|x| x.address.clone())
                .unwrap_or_default(),
            clinic_phone: clinic.as_ref().and_then(|x| x.phone.clone()),
            gstin: inv.gstin_snapshot.clone(),
            doctor_name: doctor.as_ref().map(|d| d.name.clone()).unwrap_or_default(),
            doctor_qualification: doctor
                .as_ref()
                .map(|d| d.qualification.clone())
                .unwrap_or_default(),
            doctor_reg_no: doctor
                .as_ref()
                .map(|d| d.reg_no.clone())
                .unwrap_or_default(),
            number: inv.number.clone(),
            issued_on: inv.issued_on.clone(),
            patient_name: patient.name,
            patient_code: patient.code,
            visit_on,
            lines: view.lines,
            totals: view.totals,
            discount: view.discount,
            payments: view.payments.into_iter().filter(|p| !p.voided).collect(),
            paid_paise: inv.paid_paise,
            balance_paise: inv.balance_paise,
            paid_in_words: hc_docs::words::amount_in_words(inv.paid_paise),
            void: inv.status == "void",
            upi_qr_data_url: qr,
        })
    }

    /// `billing_visit_status`: this visit's bill + the patient's dues.
    pub fn visit_status(
        &self,
        pool: &Pool,
        req: VisitIdRequest,
    ) -> Result<VisitBillingStatus, AppError> {
        pool.with_reader(|c| {
            let Some(visit) = hc_storage::visit::get_visit(c, &req.visit_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            let Some(dues) = repo::patient_balance(c, &visit.patient_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            let live = repo::live_invoice_for_visit(c, &visit.id)?;
            Ok(Ok(VisitBillingStatus {
                bill: live
                    .as_ref()
                    .and_then(|inv| visit_bill_for(std::slice::from_ref(inv), &visit.id)),
                visit_id: visit.id,
                patient_id: visit.patient_id,
                patient_dues_paise: dues,
            }))
        })?
    }

    /// `patient_dues_get`: running dues + the open invoices, oldest first.
    pub fn patient_dues(
        &self,
        pool: &Pool,
        req: PatientIdRequest,
    ) -> Result<PatientDues, AppError> {
        pool.with_reader(|c| {
            let Some(dues) = repo::patient_balance(c, &req.patient_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            let open = repo::open_invoices_for_patient(c, &req.patient_id, OPEN_INVOICE_LIMIT)?;
            Ok(Ok(PatientDues {
                patient_id: req.patient_id.clone(),
                dues_paise: dues,
                open_invoices: open
                    .into_iter()
                    .map(|i| OpenInvoice {
                        invoice_id: i.id,
                        number: i.number,
                        issued_on: i.issued_on,
                        balance_paise: i.balance_paise,
                    })
                    .collect(),
            }))
        })?
    }

    /// `patient_clear_dues`: one payment allocated oldest invoice first (one
    /// payment row per invoice touched, shared `batch_id`), one transaction,
    /// one audit row.
    pub fn clear_dues(
        &self,
        pool: &Pool,
        req: ClearDuesRequest,
    ) -> Result<ClearDuesResult, AppError> {
        let now = self.clock.now_rfc3339();
        let p = check_payment(&req.payment, &now)?;
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            let Some(_) = repo::patient_balance(&tx, &req.patient_id)? else {
                return Ok(Err(AppError::NotFound));
            };
            let open = repo::open_invoices_for_patient(&tx, &req.patient_id, OPEN_INVOICE_LIMIT)?;
            let dues: i64 = open.iter().map(|i| i.balance_paise).sum();
            if dues != req.expected_dues_paise {
                return Ok(Err(AppError::Conflict));
            }
            let mut balances = Vec::with_capacity(open.len());
            for i in &open {
                match Money::from_paise(i.balance_paise) {
                    Ok(m) => balances.push((i.id.clone(), m)),
                    Err(e) => return Ok(Err(e.into())),
                }
            }
            let amount = match Money::from_paise(p.amount) {
                Ok(m) => m,
                Err(e) => return Ok(Err(e.into())),
            };
            let plan = match rules::allocate_oldest_first(amount, &balances) {
                Ok(v) => v,
                Err(e) => return Ok(Err(e.into())),
            };
            let batch_id = new_id();
            let mut allocations = Vec::with_capacity(plan.len());
            for (invoice_id, amt) in &plan {
                let Some(inv) = open.iter().find(|i| &i.id == invoice_id) else {
                    return Ok(Err(AppError::Conflict));
                };
                if p.day < stored_day(&inv.issued_on) {
                    return Ok(Err(invalid()));
                }
                let row = payment_row(
                    &p,
                    &inv.id,
                    &req.patient_id,
                    Some(&batch_id),
                    amt.paise(),
                    &now,
                );
                repo::insert_payment(&tx, &row, &now)?;
                repo::refresh_invoice_paid(&tx, &inv.id, &now)?;
                allocations.push(Allocation {
                    invoice_id: inv.id.clone(),
                    number: inv.number.clone(),
                    amount_paise: amt.paise(),
                });
            }
            let after = repo::refresh_patient_balance(&tx, &req.patient_id, &now)?;
            let alloc_json: Vec<Value> = allocations
                .iter()
                .map(|a| {
                    json!({"invoice_id": a.invoice_id, "number": a.number, "amount": a.amount_paise})
                })
                .collect();
            repo::write_billing_audit(
                &tx,
                "payment",
                &batch_id,
                AuditAction::Create,
                json!({
                    "allocations": {"new": alloc_json},
                    "mode": {"new": mode_str(p.mode)},
                    "paid_on": {"new": p.paid_on},
                }),
                &now,
            )?;
            tx.commit()?;
            Ok(Ok(ClearDuesResult {
                batch_id,
                allocations,
                dues_paise: after,
            }))
        })?
    }
}
