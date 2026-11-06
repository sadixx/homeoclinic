//! `Money`: integer paise value type (ADR 0011, R-DATA-004; R5 design §3.1).
//!
//! Every billing amount is a non-negative `i64` number of paise. All arithmetic
//! is checked: overflow or a negative result is an error, never a wrap. There
//! is no floating point anywhere in this type.

use serde::{Deserialize, Serialize};

use crate::error::DomainError;

/// Integer paise (ADR 0011, R-DATA-004). Never negative in R5 billing.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Default, Serialize, Deserialize,
)]
pub struct Money(i64);

impl Money {
    /// Zero paise.
    pub const ZERO: Money = Money(0);
    /// Rs 10,00,000 cap per rate/fee entry (same value as settings
    /// `MAX_FEE_PAISE`).
    pub const MAX_ENTRY: Money = Money(100_000_000);

    /// Wrap a paise amount. `Err` if `p < 0`.
    pub fn from_paise(p: i64) -> Result<Money, DomainError> {
        if p < 0 {
            return Err(DomainError::Invalid);
        }
        Ok(Money(p))
    }

    /// The raw paise value.
    pub fn paise(self) -> i64 {
        self.0
    }

    /// Checked addition; `Err` on overflow.
    pub fn checked_add(self, o: Money) -> Result<Money, DomainError> {
        self.0
            .checked_add(o.0)
            .map(Money)
            .ok_or(DomainError::Invalid)
    }

    /// Checked subtraction; `Err` if the result would be negative.
    pub fn checked_sub(self, o: Money) -> Result<Money, DomainError> {
        match self.0.checked_sub(o.0) {
            Some(v) if v >= 0 => Ok(Money(v)),
            _ => Err(DomainError::Invalid),
        }
    }

    /// `self * qty`, checked; `Err` on overflow.
    pub fn checked_mul_qty(self, qty: u32) -> Result<Money, DomainError> {
        self.0
            .checked_mul(i64::from(qty))
            .map(Money)
            .ok_or(DomainError::Invalid)
    }

    /// `round-half-up(self * bp / 10_000)` computed in `i128`; `bp` must be in
    /// `0..=10_000` (0% to 100%).
    pub fn percent_bp(self, bp: u32) -> Result<Money, DomainError> {
        if bp > 10_000 {
            return Err(DomainError::Invalid);
        }
        let num = i128::from(self.0) * i128::from(bp);
        // Non-negative operands, so adding half the divisor rounds half up.
        let rounded = (num + 5_000) / 10_000;
        i64::try_from(rounded)
            .map(Money)
            .map_err(|_| DomainError::Invalid)
    }
}
