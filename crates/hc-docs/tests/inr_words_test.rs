//! R5 Indian number format + amount in words (BILL-003, product rule 8;
//! R5 design §4, §8.2, §13 T-WORDS / T-INR).
//!
//! CUT: the REAL `hc_docs::{inr, words}`. Pure. RED until hc-dev replaces the
//! §13 stub bodies.

use hc_docs::inr::{format_inr, rupees_plain};
use hc_docs::words::amount_in_words;

/// Bug caught: western grouping (1,234,567) or wrong decimals on prints/UI.
#[test]
fn format_inr_uses_indian_grouping_with_two_decimals() {
    let cases = [
        (0, "0.00"),
        (5, "0.05"),
        (100, "1.00"),
        (99_999, "999.99"),
        (100_000, "1,000.00"),
        (13_250, "132.50"),
        (12_345_675, "1,23,456.75"),
        (10_000_000, "1,00,000.00"),
        (1_000_000_000, "1,00,00,000.00"),
        (1_234_567_890_100, "12,34,56,78,901.00"),
    ];
    for (paise, want) in cases {
        assert_eq!(format_inr(paise), want, "{paise} paise");
    }
}

/// Bug caught: the CSV amount has grouping commas (breaks the column) or loses
/// the paise.
#[test]
fn rupees_plain_has_no_grouping_and_two_decimals() {
    for (paise, want) in [
        (0, "0.00"),
        (5, "0.05"),
        (13_250, "132.50"),
        (12_345_675, "123456.75"),
    ] {
        assert_eq!(rupees_plain(paise), want, "{paise} paise");
    }
}

/// Bug caught: the receipt's "Received with thanks" line is wrong for the
/// design's normative vectors (§8.2), incl. lakh/crore and paise.
#[test]
fn amount_in_words_matches_design_vectors() {
    let cases = [
        (0, "Rupees Zero Only"),
        (1, "Rupees Zero and One Paise Only"),
        (100, "Rupees One Only"),
        (33_250, "Rupees Three Hundred Thirty-Two and Fifty Paise Only"),
        (100_000, "Rupees One Thousand Only"),
        (10_000_000, "Rupees One Lakh Only"),
        (
            12_345_675,
            "Rupees One Lakh Twenty-Three Thousand Four Hundred Fifty-Six and Seventy-Five Paise Only",
        ),
        (1_000_000_000, "Rupees One Crore Only"),
        (
            1_234_567_890_100,
            "Rupees One Thousand Two Hundred Thirty-Four Crore Fifty-Six Lakh Seventy-Eight \
             Thousand Nine Hundred One Only",
        ),
    ];
    for (paise, want) in cases {
        assert_eq!(amount_in_words(paise), want, "{paise} paise");
    }
}

/// Bug caught: teens / round tens / hyphenation / "and" placement wrong in
/// cases the table does not list.
#[test]
fn amount_in_words_teens_tens_and_hundreds() {
    let cases = [
        (1_100, "Rupees Eleven Only"),
        (1_900, "Rupees Nineteen Only"),
        (2_000, "Rupees Twenty Only"),
        (2_100, "Rupees Twenty-One Only"),
        (10_000, "Rupees One Hundred Only"),
        (10_100, "Rupees One Hundred One Only"),
        (20_000, "Rupees Two Hundred Only"),
        (101, "Rupees One and One Paise Only"),
        (99, "Rupees Zero and Ninety-Nine Paise Only"),
        (
            22_750,
            "Rupees Two Hundred Twenty-Seven and Fifty Paise Only",
        ),
    ];
    for (paise, want) in cases {
        assert_eq!(amount_in_words(paise), want, "{paise} paise");
    }
}

/// Bug caught: the lakh / crore group boundaries (99,99,999 / 100 crore) are
/// mis-split, or zero groups print "Zero Thousand".
#[test]
fn amount_in_words_lakh_and_crore_boundaries() {
    let cases = [
        (
            999_999_900,
            "Rupees Ninety-Nine Lakh Ninety-Nine Thousand Nine Hundred Ninety-Nine Only",
        ),
        (2_000_000, "Rupees Twenty Thousand Only"),
        (1_000_000_100, "Rupees One Crore One Only"),
        (100_000_000_000, "Rupees One Hundred Crore Only"),
        (1_000_500_000, "Rupees One Crore Five Thousand Only"),
    ];
    for (paise, want) in cases {
        assert_eq!(amount_in_words(paise), want, "{paise} paise");
    }
}

/// Bug caught: a negative or extreme value panics (abs overflow at i64::MIN)
/// and crashes the receipt print.
#[test]
fn amount_in_words_never_panics_on_extremes() {
    assert_eq!(amount_in_words(-100), "Minus Rupees One Only");
    let max = amount_in_words(i64::MAX);
    assert!(
        max.starts_with("Rupees ") && max.ends_with(" Only"),
        "{max}"
    );
    let min = amount_in_words(i64::MIN);
    assert!(
        min.starts_with("Minus Rupees ") && min.ends_with(" Only"),
        "{min}"
    );
}
