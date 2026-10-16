#![forbid(unsafe_code)]
//! HomeoClinic desktop shell: app setup, state, capabilities and command
//! registration for the Tauri 2 application.
//!
//! Commands themselves live in `hc-app`; this crate wires the shared
//! [`hc_app::specta_builder`] command collection into the Tauri runtime and
//! mounts its events. It adds no network client, server or socket (product
//! rule 1): the only non-workspace runtime dep is `tauri`.

/// Build and run the HomeoClinic desktop application.
///
/// Initialises structured JSON logging (HC-MVP1-017) and mounts the single
/// typed command surface from `hc-app` into the Tauri invoke handler before
/// running the event loop. The logging [`WorkerGuard`] is held for the whole
/// app lifetime so buffered lines are flushed on exit. Adds no network client,
/// server or socket (product rule 1). Panics only if the Tauri runtime itself
/// fails to start — a non-recoverable startup invariant.
pub fn run() {
    let builder = hc_app::specta_builder();

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            // Resolve the per-user app data dir and initialise logging before
            // anything else writes diagnostics. The guard must outlive the
            // app, so it is stashed in managed state.
            use tauri::Manager as _;
            let data_dir = app.path().app_data_dir()?;
            let guard = hc_app::logging::init(&data_dir, hc_app::logging::RotationPolicy::DEFAULT)?;
            app.manage(guard);

            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HomeoClinic desktop application");
}
