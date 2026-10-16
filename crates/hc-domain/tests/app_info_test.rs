//! RED tests for the `AppInfo` value type (HC-MVP1-010, contract §1a/§1d).
//!
//! Code under test (CUT): `hc_domain::app_info::{AppInfo, BuildProfile}`.
//! These tests exercise ONLY the public API of the real CUT (R-TEST-002,
//! R-TEST-009). No dependency is faked here — `AppInfo` is a pure value type
//! with no dependencies. Test names carry the requirement id (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `app_info.rs`, this file
//! fails to compile/link against the absent CUT. Once the type exists exactly
//! as the frozen API CONTRACT specifies, the assertions below are what must
//! hold — a drift in field names, the lowercase serde rename, or the JSON key
//! set makes an ASSERTION fail, not a compile error.

use hc_domain::app_info::{AppInfo, BuildProfile};

/// R-TEST-008 (contract §1a): an `AppInfo` round-trips the three contracted
/// fields it is constructed from — catches a field being dropped, renamed, or
/// swapped in `AppInfo::new`.
#[test]
fn r_test_008_app_info_exposes_name_version_and_profile() {
    let info = AppInfo::new("HomeoClinic", "0.1.0", BuildProfile::Debug);

    assert_eq!(info.name, "HomeoClinic", "name field must round-trip");
    assert_eq!(info.version, "0.1.0", "version field must round-trip");
    assert_eq!(
        info.build_profile,
        BuildProfile::Debug,
        "build_profile field must round-trip"
    );
}

/// R-TEST-008 (contract §1a/§1d): `BuildProfile` serialises as the lowercase
/// string the generated TS union (`"debug" | "release"`) depends on. Catches a
/// missing or wrong `#[serde(rename_all = "lowercase")]`, which would silently
/// break the UI binding (R-ARCH-004).
#[test]
fn r_test_008_build_profile_serialises_as_lowercase() {
    let release =
        serde_json::to_string(&BuildProfile::Release).expect("BuildProfile must be Serialize");
    assert_eq!(
        release, "\"release\"",
        "Release must serialise as \"release\""
    );

    let debug =
        serde_json::to_string(&BuildProfile::Debug).expect("BuildProfile must be Serialize");
    assert_eq!(debug, "\"debug\"", "Debug must serialise as \"debug\"");
}

/// R-TEST-008 (contract §1d / R-ARCH-004): the serialised `AppInfo` JSON has
/// EXACTLY the keys the generated `bindings.ts` type declares
/// (`name`, `version`, `build_profile`) and nothing else. Catches a field that
/// drifts out of parity with the TS binding (hc-build TS2339).
#[test]
fn r_test_008_app_info_json_shape_matches_bindings() {
    let info = AppInfo::new("HomeoClinic", "0.1.0", BuildProfile::Release);
    let value: serde_json::Value = serde_json::to_value(&info).expect("AppInfo must be Serialize");
    let obj = value
        .as_object()
        .expect("AppInfo must serialise to a JSON object");

    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["build_profile", "name", "version"],
        "AppInfo JSON must have exactly name, version, build_profile"
    );
    assert_eq!(obj["build_profile"], serde_json::json!("release"));
}
