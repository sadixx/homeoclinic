//! R5 billing typed commands (BILL-001..005; R5 design §6.3 #1-11).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005), returning `Result<T, UserFacingError>` via [`to_user_result`]
//! (R-ARCH-006). No SQL, no path, no patient data in logs (R-PRIV-001).

use tauri::State;

use crate::billing::{
    BillingService, ClearDuesRequest, ClearDuesResult, ComputeTotalsRequest,
    InvoiceGetForVisitRequest, InvoiceIdRequest, InvoiceSaveRequest, InvoiceScreen,
    InvoiceVoidRequest, PatientDues, PatientIdRequest, PaymentAddRequest, PaymentVoidRequest,
    ReceiptDoc, TotalsView, UpiQrView, VisitBillingStatus, VisitIdRequest,
};
use crate::error::{to_user_result, AppError, UserFacingError};
use crate::state::AppState;

/// Run `f` with the open pool (sealed DB => `NotFound`).
fn with_pool<T>(
    state: &State<'_, AppState>,
    f: impl FnOnce(&BillingService<'_>, &hc_storage::Pool) -> Result<T, AppError>,
) -> Result<T, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = to_user_result(lock.pool.clone().ok_or(AppError::NotFound))?;
    drop(lock);
    let svc = BillingService::new(state.clock.as_ref());
    to_user_result(f(&svc, &pool))
}

/// S15 load: the visit's invoice, or an unsaved proposal.
#[tauri::command]
#[specta::specta]
pub fn invoice_get_for_visit(
    state: State<'_, AppState>,
    req: InvoiceGetForVisitRequest,
) -> Result<InvoiceScreen, UserFacingError> {
    with_pool(&state, |s, p| s.get_for_visit(p, req))
}

/// S15 live totals (pure; the UI never does money maths).
#[tauri::command]
#[specta::specta]
pub fn invoice_compute_totals(
    state: State<'_, AppState>,
    req: ComputeTotalsRequest,
) -> Result<TotalsView, UserFacingError> {
    let svc = BillingService::new(state.clock.as_ref());
    to_user_result(svc.compute_totals(req))
}

/// S15 Save: issue (first save, assigns the receipt number) or update.
#[tauri::command]
#[specta::specta]
pub fn invoice_save(
    state: State<'_, AppState>,
    req: InvoiceSaveRequest,
) -> Result<InvoiceScreen, UserFacingError> {
    with_pool(&state, |s, p| s.save(p, req))
}

/// Record one payment against a saved invoice.
#[tauri::command]
#[specta::specta]
pub fn payment_add(
    state: State<'_, AppState>,
    req: PaymentAddRequest,
) -> Result<InvoiceScreen, UserFacingError> {
    with_pool(&state, |s, p| s.payment_add(p, req))
}

/// Cancel a mistaken payment (with a reason).
#[tauri::command]
#[specta::specta]
pub fn payment_void(
    state: State<'_, AppState>,
    req: PaymentVoidRequest,
) -> Result<InvoiceScreen, UserFacingError> {
    with_pool(&state, |s, p| s.payment_void(p, req))
}

/// Cancel a bill (keeps its number; voids its payments).
#[tauri::command]
#[specta::specta]
pub fn invoice_void(
    state: State<'_, AppState>,
    req: InvoiceVoidRequest,
) -> Result<InvoiceScreen, UserFacingError> {
    with_pool(&state, |s, p| s.invoice_void(p, req))
}

/// Clinic UPI QR for the invoice balance.
#[tauri::command]
#[specta::specta]
pub fn invoice_upi_qr(
    state: State<'_, AppState>,
    req: InvoiceIdRequest,
) -> Result<UpiQrView, UserFacingError> {
    with_pool(&state, |s, p| s.upi_qr(p, req))
}

/// The receipt document (S14-lite print route).
#[tauri::command]
#[specta::specta]
pub fn receipt_get(
    state: State<'_, AppState>,
    req: InvoiceIdRequest,
) -> Result<ReceiptDoc, UserFacingError> {
    with_pool(&state, |s, p| s.receipt(p, req))
}

/// Billing state of one visit + patient dues (case strip, chips).
#[tauri::command]
#[specta::specta]
pub fn billing_visit_status(
    state: State<'_, AppState>,
    req: VisitIdRequest,
) -> Result<VisitBillingStatus, UserFacingError> {
    with_pool(&state, |s, p| s.visit_status(p, req))
}

/// Patient dues + open invoices (Clear-dues dialog).
#[tauri::command]
#[specta::specta]
pub fn patient_dues_get(
    state: State<'_, AppState>,
    req: PatientIdRequest,
) -> Result<PatientDues, UserFacingError> {
    with_pool(&state, |s, p| s.patient_dues(p, req))
}

/// Clear dues: one payment allocated oldest-first, one audit row.
#[tauri::command]
#[specta::specta]
pub fn patient_clear_dues(
    state: State<'_, AppState>,
    req: ClearDuesRequest,
) -> Result<ClearDuesResult, UserFacingError> {
    with_pool(&state, |s, p| s.clear_dues(p, req))
}
