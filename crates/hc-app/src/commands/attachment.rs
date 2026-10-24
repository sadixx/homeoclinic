//! Typed visit lab-report attachment commands (PAT-009, HC-MVP1-M3ux3).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005). Each reads the shell-managed [`AppState`], builds an
//! [`AttachmentService`] over the injected clock, and — for the use cases that
//! touch the encrypted store — reads the open [`hc_storage::Pool`] AND the
//! install [`hc_storage::key::DekKeyProvider`] together from the lock flag
//! (sealed ⇒ `NotFound`), mirroring `get_licence_status` / `restore_apply`.
//! Returns `Result<Resp, UserFacingError>` via [`to_user_result`] so no raw
//! internal error crosses the boundary (R-ARCH-006, R-UI-008).

use std::sync::Arc;

use tauri::State;

use crate::attachment::{
    AttachReportRequest, AttachReportResponse, AttachmentService, DeleteAttachmentRequest,
    DeleteAttachmentResponse, ListAttachmentsRequest, ListAttachmentsResponse,
    OpenAttachmentRequest, OpenAttachmentResponse, PatientListAttachmentsRequest,
    PickReportFileResponse,
};
use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::state::AppState;

/// Build an [`AttachmentService`] over the managed state's injected clock.
fn service(state: &AppState) -> AttachmentService<'_> {
    AttachmentService::new(state.clock.as_ref())
}

/// Clone the open pool handle + the install DEK provider out from under the
/// lock, or `NotFound` if sealed. The pool is used read/write; the provider
/// opens the encrypted `AttachmentStore` rooted at `data_dir`.
fn with_pool_and_key<T>(
    state: &AppState,
    f: impl FnOnce(&hc_storage::Pool, &hc_storage::key::DekKeyProvider) -> Result<T, AppError>,
) -> Result<T, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match (lock.pool.as_ref(), lock.key.as_ref()) {
        (Some(pool), Some(key)) => {
            let key: Arc<hc_storage::key::DekKeyProvider> = Arc::clone(key);
            to_user_result(f(pool, key.as_ref()))
        }
        _ => Err(map_error(&AppError::NotFound)),
    }
}

/// Run `f` with the open pool only (read-only use cases), or `NotFound`.
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

/// Attach a PDF/image report to a visit (PAT-009).
#[tauri::command]
#[specta::specta]
pub fn visit_attach_report(
    state: State<'_, AppState>,
    req: AttachReportRequest,
) -> Result<AttachReportResponse, UserFacingError> {
    let data_dir = state.data_dir.clone();
    with_pool_and_key(&state, |pool, key| {
        service(&state).attach_report(pool, key, &data_dir, req)
    })
}

/// List a visit's attachments (PAT-009).
#[tauri::command]
#[specta::specta]
pub fn visit_list_attachments(
    state: State<'_, AppState>,
    req: ListAttachmentsRequest,
) -> Result<ListAttachmentsResponse, UserFacingError> {
    with_pool(&state, |pool| service(&state).list_attachments(pool, req))
}

/// List ALL of a patient's attachments across visits (M3-RWv4 §5.4) — the
/// shared two-way store behind the Lab reports & Scans dashboard panel and the
/// Submitted pick-existing list. Read-only (`with_pool`), bounded (R-DATA-007).
#[tauri::command]
#[specta::specta]
pub fn patient_list_attachments(
    state: State<'_, AppState>,
    req: PatientListAttachmentsRequest,
) -> Result<ListAttachmentsResponse, UserFacingError> {
    with_pool(&state, |pool| {
        service(&state).list_attachments_for_patient(pool, req)
    })
}

/// Open (decrypt) an attachment for in-app preview (PAT-009, ADR 0017).
#[tauri::command]
#[specta::specta]
pub fn visit_open_attachment(
    state: State<'_, AppState>,
    req: OpenAttachmentRequest,
) -> Result<OpenAttachmentResponse, UserFacingError> {
    let data_dir = state.data_dir.clone();
    with_pool_and_key(&state, |pool, key| {
        service(&state).open_attachment(pool, key, &data_dir, req)
    })
}

/// Delete an attachment row + its encrypted blob (PAT-009).
#[tauri::command]
#[specta::specta]
pub fn visit_delete_attachment(
    state: State<'_, AppState>,
    req: DeleteAttachmentRequest,
) -> Result<DeleteAttachmentResponse, UserFacingError> {
    let data_dir = state.data_dir.clone();
    with_pool_and_key(&state, |pool, key| {
        service(&state).delete_attachment(pool, key, &data_dir, req)
    })
}

/// Open the OS file-open dialog filtered to PDF/image and return the chosen
/// path (PAT-009). Lets the UI obtain a `source_path` without constructing a
/// filesystem path (architecture rule).
///
/// Uses `tauri-plugin-dialog`'s native picker, filtered to the supported report
/// extensions, gated by the `dialog:allow-open` capability only (no fs/shell/
/// opener scope). The dialog ONLY returns a chosen path; it grants no
/// filesystem read — `visit_attach_report` reads the bytes itself. Interactive,
/// so E2E/UI-tested, not cargo-tested. The chosen path is never logged
/// (R-PRIV-001).
///
/// Determinism seam (DEV/E2E ONLY, feature `e2e-test-keys` — ADR 0017): the
/// native GTK file chooser cannot be driven by webdriver, so under the
/// E2E-only build feature this command FIRST consults the `HC_E2E_REPORT_FILE`
/// env var; if it is set to a path that exists, that path is returned as the
/// picked file and the native dialog is skipped. This mirrors the webcam
/// precedent (`window.__HC_E2E_CAMERA__` in `apps/desktop/src/patients/photo.ts`)
/// and the `e2e-test-keys` gating of `patient_import_fixture`. The seam is
/// compiled OUT of the release/public build, which always opens the native
/// picker only — behaviour unchanged for real doctors.
#[tauri::command]
#[specta::specta]
pub fn visit_pick_report_file(
    app: tauri::AppHandle,
) -> Result<PickReportFileResponse, UserFacingError> {
    use tauri_plugin_dialog::DialogExt as _;

    // DEV/E2E ONLY (feature e2e-test-keys): deterministic headless seam. The
    // native dialog is uninteractable under webdriver, so return the fixture
    // path named by HC_E2E_REPORT_FILE when it exists, skipping the dialog.
    // Compiled out of release (ADR 0017); the chosen path is never logged
    // (R-PRIV-001).
    #[cfg(feature = "e2e-test-keys")]
    {
        if let Some(path) = std::env::var_os("HC_E2E_REPORT_FILE") {
            let path = std::path::PathBuf::from(path);
            if path.exists() {
                return Ok(PickReportFileResponse {
                    source_path: Some(path.to_string_lossy().to_string()),
                });
            }
        }
    }

    let chosen = app
        .dialog()
        .file()
        .add_filter("Reports", &["pdf", "png", "jpg", "jpeg", "webp"])
        .blocking_pick_file();

    let source_path =
        chosen.and_then(|p| p.into_path().ok().map(|p| p.to_string_lossy().to_string()));
    Ok(PickReportFileResponse { source_path })
}
