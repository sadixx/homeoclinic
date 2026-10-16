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
/// Mounts the single typed command surface from `hc-app` into the Tauri
/// invoke handler and runs the event loop. Panics only if the Tauri runtime
/// itself fails to start — a non-recoverable startup invariant.
pub fn run() {
    let builder = hc_app::specta_builder();

    tauri::Builder::default()
        .invoke_handler(builder.invoke_handler())
        .setup(move |app| {
            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HomeoClinic desktop application");
}
