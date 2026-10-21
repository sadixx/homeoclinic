# ADR 0015: Native webview camera permission for patient photo capture

Date: 2026-10-21. Status: accepted.

Relates to: HC-MVP1-038 (PAT-001 patient photo). Deferred follow-up:
camera selection / switching is the Settings milestone
(`docs/milestones/MS-settings-brief.md`, SET-007).

## Context

Patient registration captures a photo from the DEFAULT camera in the webview
with `navigator.mediaDevices.getUserMedia({ video: true })`
(`apps/desktop/src/patients/photo.ts` `captureWebcamPhoto`). The embedded
webview does not grant `getUserMedia` on its own:

- On **Linux / WebKitGTK** (Tauri 2.12, the primary dev + pilot target),
  `getUserMedia` is denied unless the host app answers the WebView
  `permission-request` signal and calls `allow()`.
- On **Windows / WebView2**, a `PermissionRequested` event must be answered
  with `Allow` for the `Camera` kind.
- On **macOS / WKWebView**, the system prompts via the TCC flow; no app code
  is required.

The `homeoclinic-desktop` crate previously declared `#![forbid(unsafe_code)]`.
The WebView2 (Windows) permission API is a COM surface reached through
`webview2-com` / `windows`, which needs FFI (`unsafe`). WebKitGTK (Linux) is
reached through the safe `webkit2gtk` binding and needs no `unsafe`.

## Decision

Wire the permission grant in the Tauri `setup` hook via
`Webview::with_webview` (`src-tauri/src/webview_permissions.rs`), scoped
strictly to camera / user-media:

- **Linux**: connect `WebView::connect_permission_request`; `allow()` a
  `UserMediaPermissionRequest` that `is_for_video_device()`, `deny()` an
  audio-only user-media request, and leave every other permission class
  (geolocation, notifications, pointer lock, …) unhandled so WebKit applies
  its default. Safe `webkit2gtk` API, no `unsafe`.
- **Windows** (`#[cfg(windows)]`): answer `PermissionRequested` and `SetState`
  `ALLOW` only for `COREWEBVIEW2_PERMISSION_KIND_CAMERA`. This single COM
  interop block is the only `unsafe` in the crate.
- **macOS**: no code (system prompt).

Relax the crate attribute from `#![forbid(unsafe_code)]` to
`#![deny(unsafe_code)]` so a single, Windows-only, narrowly-scoped
`#[allow(unsafe_code)]` can apply to the WebView2 COM block. Linux and macOS
builds contain no `unsafe` at all. `deny` keeps `unsafe` a hard error
everywhere else.

Pin the new deps to the exact versions already in `Cargo.lock` (transitive via
tauri/wry): `webkit2gtk = "=2.0.2"` (feature `v2_8`, unified up to the `v2_40`
wry already enables) on Linux; `webview2-com = "=0.39.1"` on Windows (its
re-exported WebView2 COM types avoid a direct `windows` dep).

The CSP is **not** changed. The capture path assigns the `MediaStream` to
`video.srcObject` (an object, not a URL — not governed by CSP `media-src`) and
the preview is a `data:` URL on an `<img>`, already allowed by the existing
`img-src 'self' asset: data:`. A `media-src 'self' blob:` entry was considered
but is not required by this code path, so per the "prove it is needed" rule it
was omitted. If a future WebKit/WebView2 version rejects the stream on CSP
grounds, add exactly `media-src 'self' blob:` (never a remote origin).

## Consequences

- Real webcam capture works in the built app on a laptop; grant is scoped to
  media/camera, honouring product rule 7 (security must not block a genuine
  doctor) and the least-privilege posture (product rule 5).
- One Windows-only `unsafe` COM block exists; it is confined to subscribing to
  `PermissionRequested` and allowing the `Camera` kind. TAM/security reviewed.
- No network, socket or new runtime sink is added (product rule 1); the grant
  is lazy, off the cold-start critical path (NFR-009).
- This path is hardware-dependent and not verifiable headless (no camera in
  CI); it is verified by a human on a laptop. CI only proves it compiles and
  passes clippy/tests.
