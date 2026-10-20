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

use tempfile::TempDir;

/// Export the real command collection to a UNIQUE per-test temp file and return
/// its content.
///
/// Each test gets its own `tempfile::TempDir` (R-TEST, filesystem fake =
/// `tempfile`), so parallel `cargo test` runs never share the destination
/// file. This removes the non-atomic shared-write race that made two tests
/// writing+reading the tracked `apps/desktop/src/bindings.ts` flake under
/// default-parallel cargo test. The tracked `bindings.ts` is generated and
/// committed by the build; these tests only need to assert on the EXPORTED
/// CONTENT of `specta_builder()`, which a temp file captures exactly.
///
/// The returned `TempDir` is dropped (and its contents deleted) when it goes
/// out of scope in the caller, so each test cleans up its own temp file.
fn export_bindings_content() -> (String, TempDir) {
    let dir = tempfile::tempdir().expect("failed to create temp dir for bindings export");
    let bindings_path = dir.path().join("bindings.ts");

    hc_app::specta_builder()
        .export(specta_typescript::Typescript::default(), &bindings_path)
        .expect("failed to export typed bindings");

    let generated =
        std::fs::read_to_string(&bindings_path).expect("bindings.ts must exist after export");

    (generated, dir)
}

/// R-TEST-008: exporting the real command collection produces a `bindings.ts`
/// that declares the frozen UI contract — the camelCase `appInfo` wrapper, the
/// `AppInfo` type, and the `BuildProfile` lowercase union. Asserts on the
/// generated file CONTENT (R-TEST-003), not merely that export returned Ok.
#[test]
fn r_test_008_export_bindings_contains_app_info_contract() {
    // `_dir` keeps the temp dir alive for the body; dropping it cleans up.
    let (generated, _dir) = export_bindings_content();

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
    // `_dir` keeps the temp dir alive for the body; dropping it cleans up.
    let (generated, _dir) = export_bindings_content();

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

/// HC-MVP1-036..043 (R-TEST-008, R-ARCH-004): exporting the collection declares
/// the eleven patient command wrappers and their key types, so a patient
/// command dropped from `specta_builder()` or a renamed request/response type
/// fails HERE (an assertion) rather than later as a UI TS2307/TS2339. Asserts
/// on the generated file CONTENT (R-TEST-003).
#[test]
fn m2c_export_bindings_contains_patient_commands() {
    // `_dir` keeps the temp dir alive for the body; dropping it cleans up.
    let (generated, _dir) = export_bindings_content();

    for wrapper in [
        "patientNextCode",
        "patientCheckDuplicate",
        "patientCreate",
        "patientUpdate",
        "patientGetDashboard",
        "patientSoftDelete",
        "patientRestore",
        "patientPermanentDelete",
        "patientLinkFamily",
        "patientExportPdf",
        "patientExportJson",
    ] {
        assert!(
            generated.contains(wrapper),
            "bindings.ts must expose the {wrapper} command wrapper (M2-C contract)"
        );
    }

    // Key camelCase field names the M2-D UI depends on must survive to TS.
    assert!(
        generated.contains("patientId") && generated.contains("recycleUntil"),
        "patient response types expose patientId + recycleUntil (PAT-002/008)"
    );
    assert!(
        generated.contains("duesPaise"),
        "the dashboard exposes the integer-paise duesPaise field (PAT-005, R-DATA-004)"
    );
}

/// HC-MVP1-050/052 (R-TEST-008, R-ARCH-004): exporting the collection declares
/// the five new M2-D search/list command wrappers and the SearchRow /
/// PatientFilter field names the S04/S05 UI depends on, so a command dropped
/// from `specta_builder()` or a renamed type fails HERE (an assertion) rather
/// than later as a UI TS2307/TS2339. Asserts on generated CONTENT (R-TEST-003).
#[test]
fn m2d_export_bindings_contains_search_and_list_commands() {
    // `_dir` keeps the temp dir alive for the body; dropping it cleans up.
    let (generated, _dir) = export_bindings_content();

    for wrapper in [
        "patientSearch",
        "patientRecent",
        "patientTouchRecent",
        "patientListQuery",
        "patientListExportCsv",
    ] {
        assert!(
            generated.contains(wrapper),
            "bindings.ts must expose the {wrapper} command wrapper (M2-D contract)"
        );
    }

    // SearchRow field names the S04 row renders (PSR-005; MVP1 no masking).
    assert!(
        generated.contains("ageLabel") && generated.contains("matchType"),
        "SearchRow exposes ageLabel + matchType for the S04 row + ranking tag (PSR-004/005)"
    );
    assert!(
        generated.contains("nextCursor"),
        "search/list responses expose nextCursor for keyset paging (PSR-005, R-DATA-007)"
    );
    // PatientFilter facets the S05 panel binds (PSR-008). R3/R4 filters are in
    // the type (rendered disabled) too; assert a couple of the R2-active ones.
    assert!(
        generated.contains("ageMin") && generated.contains("ageMax"),
        "PatientFilter exposes the R2 age-range facet (PSR-008)"
    );
    assert!(
        generated.contains("duesPositive"),
        "PatientFilter exposes the dues>0 facet (PSR-008; matches nothing at R2)"
    );
    // CSV export returns a file path only (UI reveals it; no SQL crosses).
    assert!(
        generated.contains("filePath"),
        "patientListExportCsv returns a filePath (PSR-011)"
    );
}
