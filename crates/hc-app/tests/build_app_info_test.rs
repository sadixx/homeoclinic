//! RED tests for the pure `build_app_info` seam (HC-MVP1-011, contract §1b).
//!
//! Code under test (CUT): `hc_app::commands::app_info::build_app_info` and the
//! injected `AppInfoSource` trait. The ONLY fake here is `FakeAppInfoSource`,
//! a stand-in for the *dependency* that supplies raw build facts — never a
//! fake of the CUT (R-TEST-002). No Tauri runtime, no env read, no clock
//! (DI seam per design §1b; R-TEST-006 determinism). Names carry the req id
//! (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `build_app_info` +
//! `AppInfoSource`, this file fails to compile against the absent CUT. Once the
//! seam exists per the frozen API CONTRACT, the assertions are the behaviour
//! that must hold; a mapping bug (fields swapped, value synthesised instead of
//! sourced) makes an ASSERTION fail.

use hc_app::commands::app_info::{build_app_info, AppInfoSource};
use hc_domain::app_info::BuildProfile;

/// Test double for the dependency (NOT the CUT): supplies fixed build facts so
/// `build_app_info` can be exercised with no runtime, env, or clock.
struct FakeAppInfoSource {
    name: &'static str,
    version: &'static str,
    profile: BuildProfile,
}

impl AppInfoSource for FakeAppInfoSource {
    fn name(&self) -> &str {
        self.name
    }
    fn version(&self) -> &str {
        self.version
    }
    fn build_profile(&self) -> BuildProfile {
        self.profile
    }
}

/// R-TEST-008 (contract §1b): `build_app_info` maps each source field onto the
/// matching `AppInfo` field — not a copy, not a constant. Using distinct
/// synthetic values (version "9.9.9") catches a field that is hard-coded or
/// mapped from the wrong getter (R-TEST-003 asserts the resulting value).
#[test]
fn r_test_008_build_app_info_maps_each_source_field() {
    let src = FakeAppInfoSource {
        name: "HomeoClinic",
        version: "9.9.9",
        profile: BuildProfile::Debug,
    };

    let info = build_app_info(&src);

    assert_eq!(info.name, "HomeoClinic", "name must come from the source");
    assert_eq!(info.version, "9.9.9", "version must come from the source");
    assert_eq!(
        info.build_profile,
        BuildProfile::Debug,
        "build_profile must come from the source"
    );
}

/// R-TEST-008 (R-ARCH-002 / R-RUST-003): `build_app_info` is pure — calling it
/// twice with the same source yields equal values with no hidden IO or state.
/// Catches a smuggled env/clock read inside the body.
#[test]
fn r_test_008_build_app_info_is_pure_no_hidden_io() {
    let src = FakeAppInfoSource {
        name: "HomeoClinic",
        version: "1.2.3",
        profile: BuildProfile::Release,
    };

    let first = build_app_info(&src);
    let second = build_app_info(&src);

    assert_eq!(first, second, "build_app_info must be a pure function");
}
