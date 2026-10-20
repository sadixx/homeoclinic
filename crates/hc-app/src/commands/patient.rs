//! Typed patient use-case commands (HC-MVP1-036..043, PAT-001/002/004/005/006/008/011).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005). Each reads the shell-managed [`AppState`], builds a
//! [`PatientService`] over the injected keystore + clock + data dir, fetches the
//! open [`Pool`] from the lock flag (sealed ⇒ `NotFound`), performs the use
//! case, and returns `Result<Resp, UserFacingError>` via [`to_user_result`] so
//! no raw internal error crosses the boundary (R-ARCH-006, R-UI-008).

use tauri::State;

use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::patient::{
    CheckDuplicateRequest, CheckDuplicateResponse, CreatePatientRequest, CreatePatientResponse,
    ExportRequest, ExportResponse, GetDashboardRequest, LinkFamilyRequest, LinkFamilyResponse,
    ListExportCsvRequest, ListQueryRequest, ListQueryResponse, NextCodeResponse, PatientDashboard,
    PatientService, PermanentDeleteRequest, RecentRequest, RecentResponse, RestoreRequest,
    SearchRequest, SearchResponse, SoftDeleteRequest, SoftDeleteResponse, TouchRecentRequest,
    UpdatePatientRequest,
};
use crate::state::AppState;

/// Build a [`PatientService`] over the managed state's injected dependencies.
fn service(state: &AppState) -> PatientService<'_> {
    PatientService::new(
        state.keystore.as_ref(),
        state.clock.as_ref(),
        &state.data_dir,
    )
}

/// Run `f` with the open pool from the lock flag, or `NotFound` if sealed.
fn with_pool<T>(
    state: &AppState,
    f: impl FnOnce(&hc_storage::Pool) -> Result<T, AppError>,
) -> Result<T, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match lock.pool.as_ref() {
        Some(pool) => to_user_result(f(pool)),
        None => Err(map_error(&AppError::NotFound)),
    }
}

/// Preview the next patient code (PAT-002).
#[tauri::command]
#[specta::specta]
pub fn patient_next_code(state: State<'_, AppState>) -> Result<NextCodeResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).next_code(pool))
}

/// Check for duplicate patients on name + mobile / name + DOB (PAT-004).
#[tauri::command]
#[specta::specta]
pub fn patient_check_duplicate(
    state: State<'_, AppState>,
    req: CheckDuplicateRequest,
) -> Result<CheckDuplicateResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).check_duplicate(pool, req))
}

/// Register a new patient (PAT-001/002).
#[tauri::command]
#[specta::specta]
pub fn patient_create(
    state: State<'_, AppState>,
    req: CreatePatientRequest,
) -> Result<CreatePatientResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).create(pool, req))
}

/// Edit an existing patient (PAT-001).
#[tauri::command]
#[specta::specta]
pub fn patient_update(
    state: State<'_, AppState>,
    req: UpdatePatientRequest,
) -> Result<(), UserFacingError> {
    with_pool(&state, |pool| service(&state).update(pool, req))
}

/// Load the single-patient dashboard (PAT-005).
#[tauri::command]
#[specta::specta]
pub fn patient_get_dashboard(
    state: State<'_, AppState>,
    req: GetDashboardRequest,
) -> Result<PatientDashboard, UserFacingError> {
    with_pool(&state, |pool| service(&state).get_dashboard(pool, req))
}

/// Move a patient to the 30-day recycle bin (PAT-008).
#[tauri::command]
#[specta::specta]
pub fn patient_soft_delete(
    state: State<'_, AppState>,
    req: SoftDeleteRequest,
) -> Result<SoftDeleteResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).soft_delete(pool, req))
}

/// Restore a patient from the recycle bin (PAT-008).
#[tauri::command]
#[specta::specta]
pub fn patient_restore(
    state: State<'_, AppState>,
    req: RestoreRequest,
) -> Result<(), UserFacingError> {
    with_pool(&state, |pool| service(&state).restore(pool, req))
}

/// Permanently delete a patient, re-verifying the PIN (PAT-008, R-DATA-003).
#[tauri::command]
#[specta::specta]
pub fn patient_permanent_delete(
    state: State<'_, AppState>,
    req: PermanentDeleteRequest,
) -> Result<(), UserFacingError> {
    with_pool(&state, |pool| service(&state).permanent_delete(pool, req))
}

/// Link a family member (PAT-006).
#[tauri::command]
#[specta::specta]
pub fn patient_link_family(
    state: State<'_, AppState>,
    req: LinkFamilyRequest,
) -> Result<LinkFamilyResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).link_family(pool, req))
}

/// Export the single patient as PDF (PAT-011).
#[tauri::command]
#[specta::specta]
pub fn patient_export_pdf(
    state: State<'_, AppState>,
    req: ExportRequest,
) -> Result<ExportResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).export_pdf(pool, req))
}

/// Export the single patient as JSON (PAT-011).
#[tauri::command]
#[specta::specta]
pub fn patient_export_json(
    state: State<'_, AppState>,
    req: ExportRequest,
) -> Result<ExportResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).export_json(pool, req))
}

/// Global patient search (HC-MVP1-050, PSR-001..005): ranked, keyset-paginated.
#[tauri::command]
#[specta::specta]
pub fn patient_search(
    state: State<'_, AppState>,
    req: SearchRequest,
) -> Result<SearchResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).patient_search(pool, req))
}

/// Recently-opened patients for the empty search box (HC-MVP1-050, PSR-007).
#[tauri::command]
#[specta::specta]
pub fn patient_recent(
    state: State<'_, AppState>,
    req: RecentRequest,
) -> Result<RecentResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).patient_recent(pool, req))
}

/// Record that a patient was opened (HC-MVP1-050, PSR-007).
#[tauri::command]
#[specta::specta]
pub fn patient_touch_recent(
    state: State<'_, AppState>,
    req: TouchRecentRequest,
) -> Result<(), UserFacingError> {
    with_pool(&state, |pool| service(&state).touch_recent(pool, req))
}

/// Filtered, sorted, keyset-paginated patient list (HC-MVP1-052, PSR-008).
#[tauri::command]
#[specta::specta]
pub fn patient_list_query(
    state: State<'_, AppState>,
    req: ListQueryRequest,
) -> Result<ListQueryResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).list_query(pool, req))
}

/// Export the current filtered, sorted list as a CSV (HC-MVP1-052, PSR-011).
#[tauri::command]
#[specta::specta]
pub fn patient_list_export_csv(
    state: State<'_, AppState>,
    req: ListExportCsvRequest,
) -> Result<ExportResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).list_export_csv(pool, req))
}

/// Import a SYNTHETIC JSONL fixture through the real create path (DEV/E2E ONLY,
/// feature `e2e-test-keys`). Lets the E2E orchestrator seed the provisioned,
/// boot-gated app with a >=200-patient multi-disease fixture that is then
/// immediately searchable — without sharing the seed's key with the app
/// (OPTION A). Not compiled or registered in the release/public build.
#[cfg(feature = "e2e-test-keys")]
#[tauri::command]
#[specta::specta]
pub fn patient_import_fixture(
    state: State<'_, AppState>,
    req: crate::patient::ImportFixtureRequest,
) -> Result<crate::patient::ImportFixtureResponse, UserFacingError> {
    let path = std::path::PathBuf::from(&req.path);
    with_pool(&state, |pool| service(&state).import_fixture(pool, &path))
}
