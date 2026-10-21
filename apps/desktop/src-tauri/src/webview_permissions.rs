//! Native webview camera-permission wiring for patient photo capture
//! (HC-MVP1-038, PAT-001).
//!
//! The frontend captures a patient photo from the DEFAULT camera with
//! `navigator.mediaDevices.getUserMedia` (`apps/desktop/src/patients/photo.ts`
//! `captureWebcamPhoto`). On WebKitGTK (Linux, Tauri 2.12) `getUserMedia` is
//! DENIED by default unless the embedding app answers the webview's
//! `permission-request` signal. This module reaches the platform webview via
//! the Tauri 2 [`tauri::webview::Webview::with_webview`] escape hatch and grants
//! **only** camera / user-media requests; every other permission class
//! (geolocation, notifications, pointer lock, …) is left to the webview default
//! so the grant is strictly scoped to the feature that needs it.
//!
//! Camera *selection / switching* (choosing among multiple devices) is deferred
//! to the Settings milestone (`docs/milestones/MS-settings-brief.md`, SET-007);
//! here the webview always uses the browser's default video input.
//!
//! This path is hardware-dependent: it cannot be exercised in the headless CI
//! sandbox (no camera). It is verified by a human on a laptop with a webcam.
//! No patient data, path or stack is touched here (product rule 2, R-PRIV-001).
//!
//! Platform notes:
//! - **Linux** (WebKitGTK): connect to the WebView `permission-request` signal
//!   and `allow()` a [`UserMediaPermissionRequest`] that is for a video device;
//!   deny a user-media request that is audio-only (MVP1 captures video only),
//!   and leave every other request unhandled (webview default). Pure safe
//!   `webkit2gtk` / `glib` API — no `unsafe`.
//! - **Windows** (WebView2): answer `PermissionRequested` and `Allow` the
//!   `Camera` permission kind, leaving other kinds at their default. Uses COM
//!   via `webview2-com` / `windows`, which requires a narrowly-scoped `unsafe`
//!   block (see `docs/adr/0015-webview-camera-permission.md`). `#[cfg(windows)]`
//!   so it never compiles — and the `unsafe` never applies — on Linux/macOS.
//! - **macOS** (WKWebView): the system prompts for camera access via the
//!   standard TCC flow, so no code is needed here.

use tauri::{Runtime, WebviewWindow};

/// Grant camera / user-media permission requests for the given window's
/// platform webview, scoped strictly to media capture for patient photos
/// (HC-MVP1-038).
///
/// Best-effort and non-fatal: if the platform webview handle cannot be reached
/// the app still starts (the doctor can fall back to "Choose file"); the error
/// is returned to the caller to log, never surfaced as a hard startup failure.
/// Runs the platform closure on the main thread (Tauri requirement).
pub fn grant_camera_permission<R: Runtime>(window: &WebviewWindow<R>) -> tauri::Result<()> {
    window.with_webview(|_webview| {
        #[cfg(target_os = "linux")]
        linux::connect_user_media(&_webview);

        #[cfg(windows)]
        windows_impl::connect_camera(&_webview);

        // macOS: WKWebView prompts via the system TCC flow; nothing to wire.
    })
}

#[cfg(target_os = "linux")]
mod linux {
    use tauri::webview::PlatformWebview;
    use webkit2gtk::glib::prelude::{Cast, ObjectExt, ToValue};
    use webkit2gtk::{
        PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
        UserMediaPermissionRequestExt, WebViewExt,
    };

    /// Connect the WebKitGTK `permission-request` signal and allow only
    /// user-media (camera) requests.
    ///
    /// Returning `true` from the handler marks the request as handled;
    /// returning `false` lets WebKit apply its default (deny) policy, which is
    /// exactly what we want for every non-camera permission class.
    pub(super) fn connect_user_media(webview: &PlatformWebview) {
        let wv = webview.inner();

        // WebKitGTK gates getUserMedia BEFORE any permission-request behind
        // WebKitSettings that are OFF by default. Without enable-media-stream
        // the webview never even fires a user-media permission request and
        // getUserMedia rejects immediately ("no camera"). Turn on the media
        // capture settings so the camera path is reachable; the
        // permission-request handler below then grants the specific request.
        if let Some(settings) = WebViewExt::settings(&wv) {
            settings.set_enable_media_stream(true);
            // enable-webrtc exists only on newer WebKitGTK; set it via the
            // glib property so older bindings/runtimes don't break the build.
            settings.set_property_from_value(
                "enable-webrtc",
                &true.to_value(),
            );
        }

        wv.connect_permission_request(|_webview, request| {
                // Only user-media (getUserMedia) requests are in scope. Anything
                // else (geolocation, notifications, pointer lock, …) is left to
                // the webview default — we do not handle it.
                let Some(user_media) = request.downcast_ref::<UserMediaPermissionRequest>() else {
                    return false;
                };
                // MVP1 captures a still photo: allow a video-device request and
                // deny an audio-only one. getUserMedia({video:true}) yields a
                // video request, so the real capture path is granted.
                if user_media.is_for_video_device() {
                    tracing::info!("granting webview camera (user-media) permission");
                    user_media.allow();
                } else {
                    user_media.deny();
                }
                true
            });
    }
}

#[cfg(windows)]
mod windows_impl {
    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2PermissionRequestedEventArgs, COREWEBVIEW2_PERMISSION_KIND_CAMERA,
        COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    use webview2_com::PermissionRequestedEventHandler;

    /// Answer the WebView2 `PermissionRequested` event and allow only the
    /// `Camera` permission kind; every other kind is left at its default.
    ///
    /// # Safety / ADR
    /// WebView2 is a COM surface, so adding the event handler and reading the
    /// args requires FFI. The `unsafe` is confined to these WebView2 COM calls
    /// and is justified in `docs/adr/0015-webview-camera-permission.md`
    /// (TAM/security reviewed, scoped to media/camera only).
    #[allow(unsafe_code)]
    pub(super) fn connect_camera(webview: &PlatformWebview) {
        // SAFETY: WebView2 COM interop. `controller()` yields a live
        // ICoreWebView2Controller for the app's own window; we only subscribe
        // to PermissionRequested and allow the Camera kind. No pointer is
        // retained beyond the handler and no other permission is touched.
        unsafe {
            let controller = webview.controller();
            if let Ok(core) = controller.CoreWebView2() {
                let mut token = Default::default();
                let _ = core.add_PermissionRequested(
                    &PermissionRequestedEventHandler::create(Box::new(
                        |_sender, args: Option<ICoreWebView2PermissionRequestedEventArgs>| {
                            if let Some(args) = args {
                                let mut kind = Default::default();
                                if args.PermissionKind(&mut kind).is_ok()
                                    && kind == COREWEBVIEW2_PERMISSION_KIND_CAMERA
                                {
                                    let _ = args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW);
                                }
                            }
                            Ok(())
                        },
                    )),
                    &mut token,
                );
            }
        }
    }
}
