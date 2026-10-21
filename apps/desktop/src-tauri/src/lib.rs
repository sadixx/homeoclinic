// `unsafe` is denied crate-wide and may only be re-enabled with a narrowly
// scoped `#[allow(unsafe_code)]` plus an ADR note. The single current use is
// the Windows-only (`#[cfg(windows)]`) WebView2 COM call that grants the camera
// permission request (see `webview_permissions`, ADR 0015). `deny` (not
// `forbid`) is required so that scoped allow can apply on Windows; the Linux
// and macOS builds contain no `unsafe` at all.
#![deny(unsafe_code)]
//! HomeoClinic desktop shell: app setup, state, capabilities and command
//! registration for the Tauri 2 application.
//!
//! Commands themselves live in `hc-app`; this crate wires the shared
//! [`hc_app::specta_builder`] command collection into the Tauri runtime and
//! mounts its events. It adds no network client, server or socket (product
//! rule 1): the only non-workspace runtime deps are `tauri` and, on Linux /
//! Windows, the platform webview crate used to grant the camera permission
//! request for patient photo capture (HC-MVP1-038).

mod webview_permissions;

/// Build and run the HomeoClinic desktop application.
///
/// Initialises structured JSON logging (HC-MVP1-017) and mounts the single
/// typed command surface from `hc-app` into the Tauri invoke handler before
/// running the event loop. The logging [`WorkerGuard`] is held for the whole
/// app lifetime so buffered lines are flushed on exit. Adds no network client,
/// server or socket (product rule 1). Panics only if the Tauri runtime itself
/// fails to start — a non-recoverable startup invariant.
pub fn run() {
    // Linux/WebKitGTK camera enumeration (HC-MVP1-038): WebKitGTK 2.5x prefers
    // the PipeWire GStreamer device provider, which returns zero cameras when
    // the xdg-desktop-portal camera service is not running — getUserMedia then
    // reports "no device found amongst 0 devices" even though a V4L2 webcam
    // (/dev/video0) is present. Rank the V4L2 provider above PipeWire so the
    // webview enumerates the real camera directly via V4L2, independent of the
    // portal. Set only when the operator has not overridden it, before any
    // webview/GStreamer init. No effect on non-Linux targets.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GST_PLUGIN_FEATURE_RANK").is_none() {
        // SAFETY note: set_var is process-global; done once at startup before
        // any thread/webview touches GStreamer.
        std::env::set_var(
            "GST_PLUGIN_FEATURE_RANK",
            "pipewiredeviceprovider:0,v4l2deviceprovider:MAX",
        );
    }

    // The AppImage bundles GStreamer core libs but NOT the plugin scanner dir
    // (gstreamer-1.0/), so inside the app elements like `appsink` and the V4L2
    // source are not found ("GStreamer element appsink not found") and camera
    // capture fails. Point GStreamer at the host's system plugin dir (which is
    // complete) when the operator has not already set a plugin path. Picks the
    // first existing standard location; harmless if none match.
    #[cfg(target_os = "linux")]
    if std::env::var_os("GST_PLUGIN_SYSTEM_PATH_1_0").is_none()
        && std::env::var_os("GST_PLUGIN_PATH_1_0").is_none()
    {
        const SYSTEM_GST_DIRS: [&str; 3] = [
            "/usr/lib/x86_64-linux-gnu/gstreamer-1.0",
            "/usr/lib64/gstreamer-1.0",
            "/usr/lib/gstreamer-1.0",
        ];
        if let Some(dir) = SYSTEM_GST_DIRS
            .iter()
            .find(|d| std::path::Path::new(d).is_dir())
        {
            std::env::set_var("GST_PLUGIN_SYSTEM_PATH_1_0", dir);
        }
    }

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

            // Build the shell-managed application state (HC-MVP1-026/027):
            // the data dir, a keystore backend, and the runtime clock. On
            // headless Linux / E2E the keystore resolves to the always-present
            // encrypted-file fallback (NFR-020); no network, no socket.
            let state = hc_app::state::AppState::with_file_keystore(data_dir)?;
            app.manage(state);

            // Grant the native webview's camera permission request so real
            // patient photo capture works on a laptop (HC-MVP1-038). Scoped
            // strictly to media/camera; no network, no socket. Best-effort:
            // if the platform webview handle is unavailable the app still
            // starts and the doctor can use "Choose file". This is lazy work
            // off the critical startup path (no DB / IO), so it does not affect
            // the cold-start budget (NFR-009).
            if let Some(main_window) = app.get_webview_window("main") {
                if let Err(error) = webview_permissions::grant_camera_permission(&main_window) {
                    tracing::warn!(
                        error = %error,
                        "could not wire webview camera permission; \
                         patient photo capture may require file upload"
                    );
                }
            }

            builder.mount_events(app);
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running HomeoClinic desktop application");
}
