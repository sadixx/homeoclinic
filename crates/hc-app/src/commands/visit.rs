//! Typed visit + case-template use-case commands (HC-MVP1-058/061/062/063/064/
//! 068..072, CASE-001/004/005/006/009, VIS-001..005).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005). Each reads the shell-managed [`AppState`], builds a
//! [`VisitService`] over the injected clock, fetches the open [`Pool`] from the
//! lock flag (sealed ⇒ `NotFound`), performs the use case, and returns
//! `Result<Resp, UserFacingError>` via [`to_user_result`] so no raw internal
//! error crosses the boundary (R-ARCH-006, R-UI-008).

use tauri::State;

use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::state::AppState;
use crate::visit::{
    AutosaveResponse, CaseAutosaveRequest, CreateFollowupRequest, CreateFollowupResponse,
    DefaultTemplateResponse, FollowupAutosaveRequest, HasSavedFirstCaseRequest,
    HasSavedFirstCaseResponse, OkResponse, OpenOrCreateRequest, OpenOrCreateResponse,
    RubricSearchPrefillRequest, RubricSearchPrefillResponse, SetNextFollowupRequest,
    SetVisibilityRequest, SummaryRenderRequest, SummaryRenderResponse, TemplateListResponse,
    TodayOverviewRequest, TodayOverviewResponse, VisitService,
};

/// Build a [`VisitService`] over the managed state's injected clock.
fn service(state: &AppState) -> VisitService<'_> {
    VisitService::new(state.clock.as_ref())
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

/// Get the default case template (CASE-004/001).
#[tauri::command]
#[specta::specta]
pub fn case_template_get_default(
    state: State<'_, AppState>,
) -> Result<DefaultTemplateResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).template_get_default(pool))
}

/// List all case templates (CASE-004).
#[tauri::command]
#[specta::specta]
pub fn case_template_list(
    state: State<'_, AppState>,
) -> Result<TemplateListResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).template_list(pool))
}

/// Hide or show a case-template section for the doctor (CASE-002). The choice
/// persists as their template; one txn + one audit row.
#[tauri::command]
#[specta::specta]
pub fn case_template_set_visibility(
    state: State<'_, AppState>,
    req: SetVisibilityRequest,
) -> Result<OkResponse, UserFacingError> {
    with_pool(&state, |pool| {
        service(&state).template_set_visibility(pool, req)
    })
}

/// Open or create the detailed case visit for a patient (VIS-001/CASE-001).
#[tauri::command]
#[specta::specta]
pub fn case_visit_open_or_create(
    state: State<'_, AppState>,
    req: OpenOrCreateRequest,
) -> Result<OpenOrCreateResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).open_or_create(pool, req))
}

/// Autosave the case form + vitals, recomputing BMI (CASE-005).
#[tauri::command]
#[specta::specta]
pub fn case_visit_autosave(
    state: State<'_, AppState>,
    req: CaseAutosaveRequest,
) -> Result<AutosaveResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).case_autosave(pool, req))
}

/// Render the read-only case summary HTML (CASE-009).
#[tauri::command]
#[specta::specta]
pub fn case_summary_render(
    state: State<'_, AppState>,
    req: SummaryRenderRequest,
) -> Result<SummaryRenderResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).summary_render(pool, req))
}

/// Create a follow-up visit, pre-loading previous complaints (VIS-002).
#[tauri::command]
#[specta::specta]
pub fn visit_create_followup(
    state: State<'_, AppState>,
    req: CreateFollowupRequest,
) -> Result<CreateFollowupResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).create_followup(pool, req))
}

/// Autosave the follow-up fields (VIS-002/003).
#[tauri::command]
#[specta::specta]
pub fn visit_autosave(
    state: State<'_, AppState>,
    req: FollowupAutosaveRequest,
) -> Result<AutosaveResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).followup_autosave(pool, req))
}

/// Set the next follow-up date on the visit + patient (VIS-004).
#[tauri::command]
#[specta::specta]
pub fn visit_set_next_followup(
    state: State<'_, AppState>,
    req: SetNextFollowupRequest,
) -> Result<OkResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).set_next_followup(pool, req))
}

/// Whether a saved first case exists, for first-case gating (M3-RW A5). The UI
/// greys out "New visit / first case" once this is true. Read-only.
#[tauri::command]
#[specta::specta]
pub fn visit_has_saved_first_case(
    state: State<'_, AppState>,
    req: HasSavedFirstCaseRequest,
) -> Result<HasSavedFirstCaseResponse, UserFacingError> {
    with_pool(&state, |pool| {
        service(&state)
            .has_saved_first_case(pool, &req.patient_id)
            .map(|has_saved_first_case| HasSavedFirstCaseResponse {
                has_saved_first_case,
            })
    })
}

/// The Today overview: due / overdue / registered-today (VIS-005).
#[tauri::command]
#[specta::specta]
pub fn today_get_overview(
    state: State<'_, AppState>,
    req: TodayOverviewRequest,
) -> Result<TodayOverviewResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).today_overview(pool, req))
}

/// Send-to-repertory STUB (CASE-006, R7) — flagged unavailable, no dead end.
#[tauri::command]
#[specta::specta]
pub fn rubric_search_prefill(
    state: State<'_, AppState>,
    req: RubricSearchPrefillRequest,
) -> Result<RubricSearchPrefillResponse, UserFacingError> {
    with_pool(&state, |pool| {
        service(&state).rubric_search_prefill(pool, req)
    })
}
