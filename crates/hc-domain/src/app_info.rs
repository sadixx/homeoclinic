//! The `AppInfo` read-only value type and its `BuildProfile` enum.
//!
//! Pure value types: no IO, no clock, no filesystem (R-ARCH-002). They form
//! the typed contract carried end to end by the `app_info` command and the
//! generated `bindings.ts` (contract §1a/§1d).

use serde::{Deserialize, Serialize};
use specta::Type;

/// Read-only description of the running application build.
///
/// Pure value type: no IO, no clock, no filesystem (R-ARCH-002). Serialises to
/// a JSON object with exactly the keys `name`, `version` and `build_profile`,
/// matching the generated TypeScript `AppInfo` type (R-ARCH-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
pub struct AppInfo {
    /// Product display name, e.g. `"HomeoClinic"`.
    pub name: String,
    /// Semantic version from the crate/app manifest, e.g. `"0.1.0"`.
    pub version: String,
    /// Build profile the binary was compiled in.
    pub build_profile: BuildProfile,
}

/// Which Cargo/Vite profile produced this build.
///
/// Serialises as the lowercase string `"debug"` / `"release"`, which `specta`
/// mirrors as the TypeScript union `"debug" | "release"` (contract §1d).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "lowercase")]
pub enum BuildProfile {
    /// Compiled with debug assertions on (a development build).
    Debug,
    /// Compiled in release mode (an optimised, shipped build).
    Release,
}

impl AppInfo {
    /// Construct an [`AppInfo`] from already-resolved parts.
    ///
    /// Performs no IO: callers supply the name, version and build profile
    /// (R-ARCH-002).
    pub fn new(
        name: impl Into<String>,
        version: impl Into<String>,
        build_profile: BuildProfile,
    ) -> Self {
        Self {
            name: name.into(),
            version: version.into(),
            build_profile,
        }
    }
}
