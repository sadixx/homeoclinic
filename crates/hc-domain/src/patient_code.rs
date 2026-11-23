//! Patient-code value types (PAT-002, R-RUST-007).
//!
//! A patient code is `{prefix}{running number}` (for example `HC-000124`).
//! This module owns the prefix invariant so every caller (Settings today,
//! any later importer) enforces the same rule through one constructor.
//!
//! Pure domain only: no IO, no SQL, no clock (R-ARCH-002).

use crate::error::DomainError;

/// A validated patient-ID prefix (PAT-002 / A9).
///
/// Invariant: 1 to [`IdPrefix::MAX_LEN`] characters of `[A-Z0-9-]` that do
/// not end in a digit, so the running number stays separable from the
/// prefix. Built only through [`IdPrefix::parse`].
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct IdPrefix(String);

impl IdPrefix {
    /// Longest accepted prefix, in characters (A9).
    pub const MAX_LEN: usize = 6;

    /// Normalise and validate a raw prefix: trim, ASCII-uppercase, then check
    /// the invariant. Fails closed with [`DomainError::Invalid`].
    pub fn parse(raw: &str) -> Result<Self, DomainError> {
        let prefix = raw.trim().to_ascii_uppercase();
        let len = prefix.chars().count();
        let chars_ok = prefix
            .chars()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '-');
        let ends_ok = prefix.chars().last().is_some_and(|c| !c.is_ascii_digit());
        if (1..=Self::MAX_LEN).contains(&len) && chars_ok && ends_ok {
            Ok(Self(prefix))
        } else {
            Err(DomainError::Invalid)
        }
    }

    /// The normalised prefix text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consume the value and return the normalised prefix text.
    pub fn into_string(self) -> String {
        self.0
    }
}

impl std::fmt::Display for IdPrefix {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
