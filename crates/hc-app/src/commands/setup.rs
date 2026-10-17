//! Typed first-run setup commands (HC-MVP1-026, SET-001/002/003, LIC-063).
//!
//! One thin `#[tauri::command] #[specta::specta]` wrapper per use case
//! (R-ARCH-005). Each reads the shell-managed [`AppState`], builds a
//! [`SetupService`] over the injected keystore + clock + data dir, performs the
//! use case, and returns `Result<Resp, UserFacingError>` via [`to_user_result`]
//! so no raw internal error crosses the boundary (R-ARCH-006, R-UI-008).
//!
//! The doctor/clinic steps VALIDATE and stage into [`AppState::staging`]
//! (design §3.2); `setup_set_pin` replays the staged requests into the service,
//! mints the DEK, opens the encrypted DB, flushes the rows, and stashes the
//! open pool (unlocked) into [`AppState::lock`].

use tauri::State;

use crate::error::{map_error, to_user_result, AppError, UserFacingError};
use crate::setup::{
    CompleteSetupResponse, SaveClinicProfileRequest, SaveClinicProfileResponse,
    SaveDoctorProfileRequest, SaveDoctorProfileResponse, SetDataDirRequest, SetDataDirResponse,
    SetFontSizeRequest, SetPinRequest, SetPinResponse, SetupService, SetupState,
    StartTrialResponse,
};
use crate::state::AppState;

/// Build a [`SetupService`] over the managed state's injected dependencies.
fn service(state: &AppState) -> SetupService<'_> {
    SetupService::new(
        state.keystore.as_ref(),
        state.clock.as_ref(),
        &state.data_dir,
    )
}

/// Current wizard state (`setup_get_state`).
#[tauri::command]
#[specta::specta]
pub fn setup_get_state(state: State<'_, AppState>) -> Result<SetupState, UserFacingError> {
    to_user_result(service(&state).get_state())
}

/// Validate and stage the doctor profile (SET-002).
#[tauri::command]
#[specta::specta]
pub fn setup_save_doctor_profile(
    state: State<'_, AppState>,
    req: SaveDoctorProfileRequest,
) -> Result<SaveDoctorProfileResponse, UserFacingError> {
    let resp = to_user_result(service(&state).save_doctor_profile(req.clone()))?;
    // Stage the validated request for the eventual DB flush in set_pin.
    state
        .staging
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .doctor = Some(req);
    Ok(resp)
}

/// Validate and stage the clinic profile (SET-003).
#[tauri::command]
#[specta::specta]
pub fn setup_save_clinic_profile(
    state: State<'_, AppState>,
    req: SaveClinicProfileRequest,
) -> Result<SaveClinicProfileResponse, UserFacingError> {
    let resp = to_user_result(service(&state).save_clinic_profile(req.clone()))?;
    state
        .staging
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clinic = Some(req);
    Ok(resp)
}

/// Set the app PIN (SET-004): mint the DEK + recovery code, open + migrate the
/// encrypted DB, flush staged profiles + the autolock setting, and stash the
/// open pool (unlocked) in the lock flag. Returns the one-time recovery code.
#[tauri::command]
#[specta::specta]
pub fn setup_set_pin(
    state: State<'_, AppState>,
    req: SetPinRequest,
) -> Result<SetPinResponse, UserFacingError> {
    let autolock = req.autolock_minutes;
    let svc = service(&state);

    // Replay the staged doctor/clinic requests into the service so set_pin
    // flushes them (same path as the service tests).
    {
        let staging = state.staging.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(doctor) = staging.doctor.clone() {
            to_user_result(svc.save_doctor_profile(doctor))?;
        }
        if let Some(clinic) = staging.clinic.clone() {
            to_user_result(svc.save_clinic_profile(clinic))?;
        }
    }

    let (resp, pool) = to_user_result(svc.set_pin(req))?;

    // The DB is now open: record it unlocked in the lock flag so later commands
    // reuse it, and clear the staging buffer (profiles are persisted).
    {
        let mut lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
        lock.locked = false;
        lock.pool = Some(pool);
        lock.autolock_minutes = autolock;
    }
    *state.staging.lock().unwrap_or_else(|p| p.into_inner()) = Default::default();

    Ok(resp)
}

/// Persist the chosen data dir (P1/DEFERRED minimal, A2).
#[tauri::command]
#[specta::specta]
pub fn setup_set_data_dir(
    state: State<'_, AppState>,
    req: SetDataDirRequest,
) -> Result<SetDataDirResponse, UserFacingError> {
    to_user_result(set_minimal_setting_data_dir(&state, req))
}

/// Persist the chosen font size (P1/DEFERRED minimal, A2).
#[tauri::command]
#[specta::specta]
pub fn setup_set_font_size(
    state: State<'_, AppState>,
    req: SetFontSizeRequest,
) -> Result<(), UserFacingError> {
    to_user_result(set_minimal_setting_font(&state, req))
}

/// Start the local 30-day trial (LIC-063) in the open DB.
#[tauri::command]
#[specta::specta]
pub fn setup_start_trial(
    state: State<'_, AppState>,
) -> Result<StartTrialResponse, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match lock.pool.as_ref() {
        Some(pool) => to_user_result(service(&state).start_trial(pool)),
        None => Err(map_error(&AppError::NotFound)),
    }
}

/// Mark setup complete and return the home route (`/today`).
#[tauri::command]
#[specta::specta]
pub fn setup_complete(
    state: State<'_, AppState>,
) -> Result<CompleteSetupResponse, UserFacingError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match lock.pool.as_ref() {
        Some(pool) => to_user_result(service(&state).complete(pool)),
        None => Err(map_error(&AppError::NotFound)),
    }
}

/// Persist a data-dir setting into the open DB (A2 minimal).
fn set_minimal_setting_data_dir(
    state: &AppState,
    req: SetDataDirRequest,
) -> Result<SetDataDirResponse, AppError> {
    let now = state.clock.now_rfc3339();
    let path = req.path.trim().to_string();
    if path.is_empty() {
        return Err(AppError::Validation(hc_domain::error::DomainError::Invalid));
    }
    let value = serde_json::to_string(&path).unwrap_or_else(|_| "\"\"".to_string());
    with_open_pool(state, |pool| {
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, "data_dir", &value, &now)?;
            tx.commit()?;
            Ok(())
        })
        .map_err(AppError::from)
    })?;
    Ok(SetDataDirResponse { data_dir: path })
}

/// Persist a font-size setting into the open DB (A2 minimal).
fn set_minimal_setting_font(state: &AppState, req: SetFontSizeRequest) -> Result<(), AppError> {
    let now = state.clock.now_rfc3339();
    let value = serde_json::to_string(&req.size).unwrap_or_else(|_| "\"normal\"".to_string());
    with_open_pool(state, |pool| {
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            hc_storage::profile::put_setting(&tx, "font_size", &value, &now)?;
            tx.commit()?;
            Ok(())
        })
        .map_err(AppError::from)
    })
}

/// Run `f` with the open pool from the lock flag, or `NotFound` if sealed.
fn with_open_pool<T>(
    state: &AppState,
    f: impl FnOnce(&hc_storage::Pool) -> Result<T, AppError>,
) -> Result<T, AppError> {
    let lock = state.lock.lock().unwrap_or_else(|p| p.into_inner());
    match lock.pool.as_ref() {
        Some(pool) => f(pool),
        None => Err(AppError::NotFound),
    }
}
