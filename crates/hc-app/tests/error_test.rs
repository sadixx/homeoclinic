//! RED tests for the command-boundary error mapping (HC-MVP1-018, design §018,
//! NFR-033, R-ARCH-006, R-UI-008, R-ARCH-004).
//!
//! Code under test (CUT): `hc_app::error::{AppError, UserFacingError,
//! ErrorCode, map_error, to_user_result}`. The mapper must read only the
//! `AppError` *variant* and never its `Display`/`Debug` text, so no internal
//! string (SQL, boxed error detail, stack) can leak to the UI. No dependency
//! is faked (R-TEST-002). Names carry the req id (R-TEST-008).
//!
//! Red-first state: until `hc-core-dev` implements `hc-app/src/error.rs`, this
//! file fails to compile against the absent CUT. Once the types exist per the
//! frozen API CONTRACT, the assertions below are what must hold — a mapper
//! that forwards `err.to_string()` into the message makes the leak ASSERTION
//! fail.

use hc_app::error::{map_error, to_user_result, AppError, ErrorCode, UserFacingError};

/// A fake lower-layer error whose `Display`/`Debug` carry SQL-ish, stack-ish
/// detail that must NEVER cross the boundary. This is a test double for a
/// *dependency* (a boxed storage error), not a fake of the CUT (R-TEST-002).
#[derive(Debug)]
struct FakeSqlError;

impl std::fmt::Display for FakeSqlError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "SELECT * FROM patients WHERE mobile='9876543210'; database is locked at /var/lib/hc/clinic.db:42"
        )
    }
}

impl std::error::Error for FakeSqlError {}

/// R-TEST-008 (NFR-033, R-UI-008): mapping an `AppError::Storage` that wraps a
/// detailed SQL/path error produces a `UserFacingError` whose `message` and
/// `suggested_action` contain NONE of that raw text — only the generic mapped
/// message. The single most important privacy/UX assertion of this task.
#[test]
fn hc_mvp1_018_map_error_never_leaks_debug_or_sql() {
    let app_err = AppError::Storage(Box::new(FakeSqlError));

    let ufe = map_error(&app_err);

    for needle in [
        "SELECT",
        "FROM patients",
        "9876543210",
        "database is locked",
        "/var/lib/hc",
        "clinic.db",
        ":42",
    ] {
        assert!(
            !ufe.message.contains(needle),
            "message must not leak `{needle}`: got `{}`",
            ufe.message
        );
        assert!(
            !ufe.suggested_action.contains(needle),
            "suggested_action must not leak `{needle}`: got `{}`",
            ufe.suggested_action
        );
    }
    assert!(
        !ufe.message.is_empty() && !ufe.suggested_action.is_empty(),
        "a mapped error must still carry a plain message and an action"
    );
}

/// R-TEST-008 (R-ARCH-006): each `AppError` variant maps to the expected
/// stable `ErrorCode` and a non-empty suggested action.
#[test]
fn hc_mvp1_018_map_error_sets_stable_code_and_action() {
    let cases = [
        (
            AppError::Validation(hc_domain::error::DomainError::Invalid),
            ErrorCode::Validation,
        ),
        (AppError::NotFound, ErrorCode::NotFound),
        (AppError::Conflict, ErrorCode::Conflict),
        (
            AppError::Storage(Box::new(FakeSqlError)),
            ErrorCode::Unexpected,
        ),
    ];

    for (err, expected_code) in cases {
        let ufe = map_error(&err);
        assert_eq!(ufe.code, expected_code, "variant must map to a stable code");
        assert!(
            !ufe.suggested_action.trim().is_empty(),
            "every mapped error needs a concrete next step"
        );
        assert!(
            !ufe.message.trim().is_empty(),
            "every mapped error needs a plain message"
        );
    }
}

/// R-TEST-008 (R-ARCH-004): `UserFacingError` serialises with camelCase keys
/// `code`, `message`, `suggestedAction` so it crosses the TS boundary cleanly.
#[test]
fn hc_mvp1_018_user_facing_error_serialises_camelcase() {
    let ufe = UserFacingError {
        code: ErrorCode::DbBusy,
        message: "The app is busy.".to_string(),
        suggested_action: "Try again.".to_string(),
    };

    let value = serde_json::to_value(&ufe).expect("UserFacingError must be Serialize");
    let obj = value.as_object().expect("must serialise to an object");

    let mut keys: Vec<&str> = obj.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["code", "message", "suggestedAction"],
        "UserFacingError must serialise exactly code/message/suggestedAction"
    );
    assert_eq!(
        obj["code"],
        serde_json::json!("db_busy"),
        "code is snake_case"
    );
}

/// R-TEST-008 (R-ARCH-006): `to_user_result` forwards Ok untouched and maps
/// the Err through `map_error`, so commands return `Result<T, UserFacingError>`.
#[test]
fn hc_mvp1_018_to_user_result_maps_err_and_passes_ok() {
    let ok: Result<u8, AppError> = Ok(7);
    assert_eq!(to_user_result(ok), Ok(7));

    let err: Result<u8, AppError> = Err(AppError::NotFound);
    let mapped = to_user_result(err).expect_err("Err must map to a UserFacingError");
    assert_eq!(mapped.code, ErrorCode::NotFound);
}
