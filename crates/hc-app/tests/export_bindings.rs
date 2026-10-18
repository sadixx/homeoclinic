//! RED bindings-drift test (HC-MVP1-011, contract §1c/§1d, R-ARCH-004).
//!
//! Code under test (CUT): `hc_app::specta_builder()` and the command surface it
//! collects. This regenerates `apps/desktop/src/bindings.ts` from the real
//! command collection and asserts the generated TS contains the frozen binding
//! symbols the UI depends on. No dependency is faked (R-TEST-002). Names carry
//! the req id (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `specta_builder()` and the
//! `app_info` command, this fails to compile against the absent CUT. Once the
//! builder exists, the EXPORT writes `bindings.ts` and the assertions below
//! (which guard R-ARCH-004 parity: the `appInfo` wrapper, the `AppInfo` type,
//! and the `"debug" | "release"` union) are what must hold — a command dropped
//! from the collection or a renamed type makes an ASSERTION fail, catching the
//! hc-build TS2307/TS2339 class of break before the UI compiles.

use std::path::Path;

/// Where the generated binding is written, relative to the hc-app crate root.
const BINDINGS_PATH: &str = "../../apps/desktop/src/bindings.ts";

/// R-TEST-008: exporting the real command collection produces a `bindings.ts`
/// that declares the frozen UI contract — the camelCase `appInfo` wrapper, the
/// `AppInfo` type, and the `BuildProfile` lowercase union. Asserts on the
/// generated file CONTENT (R-TEST-003), not merely that export returned Ok.
#[test]
fn r_test_008_export_bindings_contains_app_info_contract() {
    hc_app::specta_builder()
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("failed to export typed bindings");

    let generated = std::fs::read_to_string(Path::new(BINDINGS_PATH))
        .expect("bindings.ts must exist after export");

    assert!(
        generated.contains("appInfo"),
        "bindings.ts must expose the camelCase appInfo command wrapper (contract §1d)"
    );
    assert!(
        generated.contains("AppInfo"),
        "bindings.ts must declare the AppInfo type (contract §1d)"
    );
    assert!(
        generated.contains("\"debug\"") && generated.contains("\"release\""),
        "bindings.ts must declare the BuildProfile union \"debug\" | \"release\" (contract §1d)"
    );
}

/// HC-MVP1-026/027 (R-TEST-008, R-ARCH-004): exporting the collection declares
/// the 12 new setup/auth command wrappers and their key types, so a command
/// dropped from `specta_builder()` or a renamed request/response type fails
/// HERE (an assertion) rather than later as a UI TS2307/TS2339. Asserts on the
/// generated file CONTENT (R-TEST-003).
#[test]
fn set026_027_export_bindings_contains_setup_and_auth_commands() {
    hc_app::specta_builder()
        .export(specta_typescript::Typescript::default(), BINDINGS_PATH)
        .expect("failed to export typed bindings");

    let generated = std::fs::read_to_string(Path::new(BINDINGS_PATH))
        .expect("bindings.ts must exist after export");

    for wrapper in [
        "setupGetState",
        "setupSaveDoctorProfile",
        "setupSaveClinicProfile",
        "setupSetPin",
        "setupSetDataDir",
        "setupSetFontSize",
        "setupStartTrial",
        "setupComplete",
        "authGetLockState",
        "authUnlock",
        "authLock",
        "authRecoverWithCode",
    ] {
        assert!(
            generated.contains(wrapper),
            "bindings.ts must expose the {wrapper} command wrapper (Slice C contract)"
        );
    }

    // One-time recovery code field (SET-004) and integer-paise field names
    // (R-DATA-004) must survive to TS.
    assert!(
        generated.contains("recoveryCode"),
        "SetPinResponse must expose recoveryCode (SET-004, shown once)"
    );
    assert!(
        generated.contains("feeFirstPaise") && generated.contains("feeFollowupPaise"),
        "clinic fees are integer-paise camelCase fields (R-DATA-004)"
    );

    // The two new error codes the lock UI distinguishes (SUX-007).
    assert!(
        generated.contains("wrong_pin") && generated.contains("wrong_recovery_code"),
        "ErrorCode union must include wrong_pin and wrong_recovery_code (Slice C)"
    );
}
