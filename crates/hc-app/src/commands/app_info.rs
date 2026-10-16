//! The sample `app_info` use case and its typed Tauri command (contract §1b).
//!
//! `build_app_info` is the pure, unit-testable core; `app_info` is the thin
//! `#[tauri::command]` wrapper. Build facts are supplied through the injected
//! [`AppInfoSource`] trait so the core can be exercised with a fake — no Tauri
//! runtime, no env read, no clock inside the command body (R-RUST-003).

use hc_domain::app_info::{AppInfo, BuildProfile};

/// Supplies the raw build facts used to assemble an [`AppInfo`].
///
/// Injected so [`build_app_info`] is testable with a fake dependency; the
/// command never reads the environment or a clock in its own body.
pub trait AppInfoSource: Send + Sync {
    /// Product display name, e.g. `"HomeoClinic"`.
    fn name(&self) -> &str;
    /// Semantic version from the crate/app manifest.
    fn version(&self) -> &str;
    /// Build profile the binary was compiled in.
    fn build_profile(&self) -> BuildProfile;
}

/// Assemble an [`AppInfo`] from the injected source.
///
/// Pure: given the same source it always returns an equal value, with no
/// hidden IO or state (R-ARCH-002, R-RUST-003). Infallible, so it returns
/// `AppInfo` directly rather than a `Result`.
pub fn build_app_info(src: &dyn AppInfoSource) -> AppInfo {
    AppInfo::new(src.name(), src.version(), src.build_profile())
}

/// The runtime source: compile-time constants only, no IO.
pub struct StaticAppInfoSource;

impl AppInfoSource for StaticAppInfoSource {
    fn name(&self) -> &str {
        "HomeoClinic"
    }

    fn version(&self) -> &str {
        env!("CARGO_PKG_VERSION")
    }

    fn build_profile(&self) -> BuildProfile {
        if cfg!(debug_assertions) {
            BuildProfile::Debug
        } else {
            BuildProfile::Release
        }
    }
}

/// Return the running application's build info.
///
/// Read-only, no IO, no patient data, no network. Infallible, so it returns
/// [`AppInfo`] directly rather than a `Result` (contract §1b). This is the one
/// typed command wired end to end at M0 (R-ARCH-005).
#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    build_app_info(&StaticAppInfoSource)
}
