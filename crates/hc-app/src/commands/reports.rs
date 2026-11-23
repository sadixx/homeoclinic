//! R5 report typed commands (BILL-004; R5 design §6.3 #12-14).
//!
//! `report_export` is async: it opens the OS folder picker itself (no path
//! from the UI), then builds + writes the file on the blocking pool and
//! returns only `{saved, file_name, row_count}`. E2E seam
//! `HC_E2E_EXPORT_FOLDER` (feature `e2e-test-keys` only). No path is logged.

use tauri::{Manager, State};

use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::reports::{
    DailyCollection, DailyCollectionRequest, MonthlySummary, MonthlySummaryRequest,
    ReportExportRequest, ReportExportResult, ReportService,
};
use crate::state::AppState;

/// Daily collection by mode (S16).
#[tauri::command]
#[specta::specta]
pub fn report_daily_collection(
    state: State<'_, AppState>,
    req: DailyCollectionRequest,
) -> Result<DailyCollection, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = to_user_result(lock.pool.clone().ok_or(AppError::NotFound))?;
    drop(lock);
    to_user_result(ReportService::new(state.clock.as_ref()).daily_collection(&pool, req))
}

/// Monthly summary (S16).
#[tauri::command]
#[specta::specta]
pub fn report_monthly_summary(
    state: State<'_, AppState>,
    req: MonthlySummaryRequest,
) -> Result<MonthlySummary, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    let pool = to_user_result(lock.pool.clone().ok_or(AppError::NotFound))?;
    drop(lock);
    to_user_result(ReportService::new(state.clock.as_ref()).monthly_summary(&pool, req))
}

/// Pick a folder and export the report as CSV / xlsx (S16).
#[tauri::command]
#[specta::specta]
pub async fn report_export(
    app: tauri::AppHandle,
    req: ReportExportRequest,
) -> Result<ReportExportResult, UserFacingError> {
    // Validate and check the database is open BEFORE asking for a folder, so
    // a request that cannot succeed never opens the picker (r5-review-9).
    to_user_result(ReportService::validate_export(&req))?;
    {
        let state = app.state::<AppState>();
        let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
        to_user_result(lock.pool.as_ref().map(|_| ()).ok_or(AppError::NotFound))?;
    }
    let dir = pick_export_folder(&app).await;
    let Some(dir) = dir else {
        return Ok(ReportExportResult {
            saved: false,
            file_name: None,
            row_count: 0,
        });
    };
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
        let pool = lock.pool.clone().ok_or(AppError::NotFound)?;
        drop(lock);
        ReportService::new(state.clock.as_ref()).export_to(&pool, &dir, req)
    })
    .await;
    match joined {
        Ok(r) => to_user_result(r),
        Err(_) => Err(map_error(&AppError::ExportFailed)),
    }
}

/// Non-blocking folder picker (oneshot bridge; never block the GTK thread).
async fn pick_export_folder(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    use tauri_plugin_dialog::DialogExt as _;

    #[cfg(feature = "e2e-test-keys")]
    {
        if let Some(path) = std::env::var_os("HC_E2E_EXPORT_FOLDER") {
            let path = std::path::PathBuf::from(path);
            if path.is_dir() {
                return Some(path);
            }
        }
    }

    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog().file().pick_folder(move |picked| {
        let _ = tx.send(picked);
    });
    rx.await.ok().flatten().and_then(|p| p.into_path().ok())
}
