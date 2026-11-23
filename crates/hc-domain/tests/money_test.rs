//! R5 `Money` value type tests (ADR 0011, R-DATA-004; R5 design §3.1).
//!
//! CUT: the REAL `hc_domain::money::Money`. Pure, no IO, no fakes. RED until
//! hc-core-dev replaces the §13 compile-only stub bodies.

use hc_domain::money::Money;

fn m(p: i64) -> Money {
    Money::from_paise(p).expect("non-negative paise must be accepted")
}

/// Bug caught: a negative amount slips into billing (dues < 0, refunds as
/// payments) or zero is refused.
#[test]
fn from_paise_accepts_zero_and_positive_and_refuses_negative() {
    assert_eq!(m(0), Money::ZERO);
    assert_eq!(m(13_250).paise(), 13_250);
    assert!(Money::from_paise(-1).is_err(), "-1 paise must be refused");
    assert_eq!(Money::MAX_ENTRY.paise(), 100_000_000, "Rs 10,00,000 cap");
}

/// Bug caught: arithmetic wraps on overflow or goes negative silently.
#[test]
fn checked_add_and_sub_refuse_overflow_and_negative_results() {
    assert_eq!(m(30_000).checked_add(m(5_000)).unwrap(), m(35_000));
    assert_eq!(m(35_000).checked_sub(m(35_000)).unwrap(), Money::ZERO);
    assert!(
        m(100).checked_sub(m(101)).is_err(),
        "100 - 101 must not go negative"
    );
    assert!(
        m(i64::MAX).checked_add(m(1)).is_err(),
        "overflow must be an error, never a wrap"
    );
}

/// Bug caught: line amount computed via float (off by a paisa) or overflow.
#[test]
fn checked_mul_qty_is_exact_integer_multiplication() {
    assert_eq!(m(3_333).checked_mul_qty(3).unwrap(), m(9_999));
    assert_eq!(
        Money::MAX_ENTRY.checked_mul_qty(9_999).unwrap(),
        m(999_900_000_000),
        "the largest legal line (Rs 10L x 9,999) is exact"
    );
    assert_eq!(m(2_500).checked_mul_qty(0).unwrap(), Money::ZERO);
    assert!(
        m(i64::MAX).checked_mul_qty(2).is_err(),
        "overflow must be an error"
    );
}

/// Bug caught: percent discount truncates (or uses banker's rounding / f64)
/// instead of rounding half up on integer paise (design §1 "Discount").
#[test]
fn percent_bp_rounds_half_up_on_integer_paise() {
    // 333 x 50% = 166.5 -> 167 (half up).
    assert_eq!(m(333).percent_bp(5_000).unwrap(), m(167));
    // 1 x 50% = 0.5 -> 1 (half up, not to even).
    assert_eq!(m(1).percent_bp(5_000).unwrap(), m(1));
    // 3 x 33.33% = 0.9999 -> 1.
    assert_eq!(m(3).percent_bp(3_333).unwrap(), m(1));
    // 333 x 0.01% = 0.0333 -> 0.
    assert_eq!(m(333).percent_bp(1).unwrap(), Money::ZERO);
    // S15 example: Rs 350 x 5% = Rs 17.50.
    assert_eq!(m(35_000).percent_bp(500).unwrap(), m(1_750));
    // 100% = self; 0% = zero.
    assert_eq!(m(35_000).percent_bp(10_000).unwrap(), m(35_000));
    assert_eq!(m(35_000).percent_bp(0).unwrap(), Money::ZERO);
}

/// Bug caught: the multiplication overflows i64 for large amounts (must use
/// i128), or more than 100% is accepted.
#[test]
fn percent_bp_does_not_overflow_and_refuses_more_than_100_percent() {
    assert_eq!(m(i64::MAX).percent_bp(10_000).unwrap(), m(i64::MAX));
    assert!(m(100).percent_bp(10_001).is_err(), "> 100% must be refused");
}
