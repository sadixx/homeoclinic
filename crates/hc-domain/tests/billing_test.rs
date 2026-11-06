//! R5 pure billing rules (BILL-001..005; R5 design §3.2, §13 T-MONEY/T-SEQ/T-UPI).
//!
//! CUT: the REAL `hc_domain::billing` functions. Pure, no IO, no fakes.
//! Synthetic data only. RED until hc-core-dev replaces the §13 stub bodies.

use hc_domain::billing::{
    allocate_oldest_first, compute_totals, receipt_number, upi_pay_url, validate_vpa, BillingError,
    Discount, FinancialYear, LineInput, LineKind, MAX_DESCRIPTION_CHARS, MAX_LINES, MAX_QTY,
};
use hc_domain::money::Money;

fn m(p: i64) -> Money {
    Money::from_paise(p).expect("non-negative paise must be accepted")
}

fn line(kind: LineKind, desc: &str, qty: u32, rate: i64) -> LineInput {
    LineInput {
        kind,
        description: desc.to_string(),
        qty,
        rate: m(rate),
    }
}

/// The S15 worked example: consultation Rs 300 + 2 x Rs 25 medicine.
fn s15_lines() -> Vec<LineInput> {
    vec![
        line(
            LineKind::Consultation,
            "Consultation (first visit)",
            1,
            30_000,
        ),
        line(LineKind::Medicine, "Test Remedy 30C", 2, 2_500),
    ]
}

// ---------------------------------------------------------------------------
// compute_totals
// ---------------------------------------------------------------------------

/// Bug caught: line amount / subtotal / discount / total wrong on the S15
/// example (Rs 350, 5% -> Rs 17.50 discount, Rs 332.50 total).
#[test]
fn compute_totals_s15_example_percent_discount() {
    let t = compute_totals(&s15_lines(), &Discount::Percent { basis_points: 500 }).unwrap();
    assert_eq!(
        t.lines,
        vec![m(30_000), m(5_000)],
        "amount = qty x rate per line"
    );
    assert_eq!(t.subtotal, m(35_000));
    assert_eq!(t.discount, m(1_750));
    assert_eq!(t.total, m(33_250));
}

/// Bug caught: percent discount truncates instead of rounding half up.
#[test]
fn compute_totals_percent_discount_rounds_half_up() {
    let lines = vec![line(LineKind::Other, "Test charge", 1, 333)];
    let t = compute_totals(
        &lines,
        &Discount::Percent {
            basis_points: 5_000,
        },
    )
    .unwrap();
    assert_eq!(t.discount, m(167), "333 x 50% = 166.5 -> 167");
    assert_eq!(t.total, m(166));
}

/// Bug caught: no-discount and amount-discount paths compute a wrong total.
#[test]
fn compute_totals_none_and_amount_discount() {
    let none = compute_totals(&s15_lines(), &Discount::None).unwrap();
    assert_eq!(none.discount, Money::ZERO);
    assert_eq!(none.total, m(35_000));

    let amt = compute_totals(&s15_lines(), &Discount::Amount(m(5_000))).unwrap();
    assert_eq!(amt.discount, m(5_000));
    assert_eq!(amt.total, m(30_000));
}

/// Bug caught: a discount larger than the subtotal yields a negative total
/// (INV-OQ-2 -> cap). Equal is allowed (free visit).
#[test]
fn compute_totals_discount_is_capped_at_subtotal() {
    let eq = compute_totals(&s15_lines(), &Discount::Amount(m(35_000))).unwrap();
    assert_eq!(eq.total, Money::ZERO, "discount == subtotal -> total 0");

    assert_eq!(
        compute_totals(&s15_lines(), &Discount::Amount(m(35_001))),
        Err(BillingError::DiscountTooLarge)
    );

    let full = compute_totals(
        &s15_lines(),
        &Discount::Percent {
            basis_points: 10_000,
        },
    )
    .unwrap();
    assert_eq!(full.total, Money::ZERO, "100% -> total 0");

    let over = compute_totals(
        &s15_lines(),
        &Discount::Percent {
            basis_points: 10_001,
        },
    );
    assert!(
        matches!(
            over,
            Err(BillingError::Invalid) | Err(BillingError::DiscountTooLarge)
        ),
        "more than 100% must be refused, got {over:?}"
    );
}

/// Bug caught: an invoice with no lines (or a blank description) is issued.
#[test]
fn compute_totals_refuses_empty_invoice_and_blank_description() {
    assert_eq!(
        compute_totals(&[], &Discount::None),
        Err(BillingError::Invalid)
    );
    let blank = vec![line(LineKind::Other, "   ", 1, 100)];
    assert_eq!(
        compute_totals(&blank, &Discount::None),
        Err(BillingError::Invalid)
    );
}

/// Bug caught: the A18 caps are off by one (qty, line count, rate, length).
#[test]
fn compute_totals_enforces_caps_at_the_boundary() {
    // qty: 0 and MAX_QTY+1 refused, MAX_QTY accepted.
    for bad_qty in [0, MAX_QTY + 1] {
        let l = vec![line(LineKind::Medicine, "Test Remedy", bad_qty, 100)];
        assert_eq!(
            compute_totals(&l, &Discount::None),
            Err(BillingError::Invalid),
            "qty {bad_qty}"
        );
    }
    let ok = vec![line(LineKind::Medicine, "Test Remedy", MAX_QTY, 100)];
    assert_eq!(
        compute_totals(&ok, &Discount::None).unwrap().total,
        m(999_900)
    );

    // rate: MAX_ENTRY accepted, +1 refused.
    let max_rate = vec![LineInput {
        kind: LineKind::Other,
        description: "Test charge".to_string(),
        qty: 1,
        rate: Money::MAX_ENTRY,
    }];
    assert!(compute_totals(&max_rate, &Discount::None).is_ok());
    let over_rate = vec![line(LineKind::Other, "Test charge", 1, 100_000_001)];
    assert_eq!(
        compute_totals(&over_rate, &Discount::None),
        Err(BillingError::Invalid)
    );

    // line count: MAX_LINES accepted, +1 refused.
    let fifty: Vec<_> = (0..MAX_LINES)
        .map(|i| line(LineKind::Other, &format!("Test charge {i}"), 1, 100))
        .collect();
    assert_eq!(
        compute_totals(&fifty, &Discount::None).unwrap().subtotal,
        m(5_000)
    );
    let mut fifty_one = fifty.clone();
    fifty_one.push(line(LineKind::Other, "Test charge extra", 1, 100));
    assert_eq!(
        compute_totals(&fifty_one, &Discount::None),
        Err(BillingError::Invalid)
    );
}

/// Bug caught: description length counted in bytes (Devanagari refused early)
/// or the 200-char cap not enforced.
#[test]
fn compute_totals_description_cap_counts_chars_not_bytes() {
    let deva: String = "क".repeat(MAX_DESCRIPTION_CHARS); // 600 bytes, 200 chars
    let ok = vec![line(LineKind::Medicine, &deva, 1, 100)];
    assert!(
        compute_totals(&ok, &Discount::None).is_ok(),
        "200 Devanagari chars are allowed"
    );

    let long: String = "a".repeat(MAX_DESCRIPTION_CHARS + 1);
    let bad = vec![line(LineKind::Medicine, &long, 1, 100)];
    assert_eq!(
        compute_totals(&bad, &Discount::None),
        Err(BillingError::Invalid)
    );
}

// ---------------------------------------------------------------------------
// Financial year + receipt number (T-SEQ pure part)
// ---------------------------------------------------------------------------

/// Bug caught: FY boundary off by a day (March 31 / April 1) or calendar year
/// used instead of the Indian April-March FY.
#[test]
fn financial_year_switches_on_first_april() {
    let cases = [
        ("2026-04-01", 2026, "2026-27"),
        ("2026-10-16", 2026, "2026-27"),
        ("2027-01-01", 2026, "2026-27"),
        ("2027-03-31", 2026, "2026-27"),
        ("2027-04-01", 2027, "2027-28"),
        ("2026-03-31", 2025, "2025-26"),
    ];
    for (date, start, label) in cases {
        let fy = FinancialYear::of_date(date).unwrap_or_else(|e| panic!("{date}: {e:?}"));
        assert_eq!(fy.start_year(), start, "{date}");
        assert_eq!(fy.label(), label, "{date}");
    }
}

/// Bug caught: century rollover prints "2099-100" instead of "2099-00".
#[test]
fn financial_year_label_wraps_the_century() {
    assert_eq!(
        FinancialYear::of_date("2099-04-01").unwrap().label(),
        "2099-00"
    );
}

/// Bug caught: a malformed / impossible date silently maps to some FY.
#[test]
fn financial_year_refuses_invalid_dates() {
    for bad in [
        "",
        "2026-13-01",
        "2026-02-30",
        "26-04-01",
        "2026/04/01",
        "2026-04-01T00:00:00Z",
    ] {
        assert_eq!(
            FinancialYear::of_date(bad),
            Err(BillingError::Invalid),
            "{bad:?} must be refused"
        );
    }
}

/// Bug caught: receipt number not zero-padded, or truncated past 9999.
#[test]
fn receipt_number_is_fy_slash_zero_padded_seq() {
    let fy = FinancialYear::of_date("2026-10-16").unwrap();
    assert_eq!(receipt_number(&fy, 1), "2026-27/0001");
    assert_eq!(receipt_number(&fy, 142), "2026-27/0142");
    assert_eq!(receipt_number(&fy, 9_999), "2026-27/9999");
    assert_eq!(receipt_number(&fy, 10_000), "2026-27/10000");
}

// ---------------------------------------------------------------------------
// Oldest-first allocation (Clear dues)
// ---------------------------------------------------------------------------

/// Bug caught: Clear dues pays the newest bill first, or writes a payment row
/// for a zero-balance invoice.
#[test]
fn allocate_oldest_first_fills_in_order_and_skips_zero_balances() {
    let open = vec![
        ("inv-old".to_string(), m(10_000)),
        ("inv-paid".to_string(), Money::ZERO),
        ("inv-new".to_string(), m(8_000)),
    ];
    let got = allocate_oldest_first(m(15_000), &open).unwrap();
    assert_eq!(
        got,
        vec![
            ("inv-old".to_string(), m(10_000)),
            ("inv-new".to_string(), m(5_000))
        ]
    );

    let all = allocate_oldest_first(m(18_000), &open).unwrap();
    assert_eq!(
        all,
        vec![
            ("inv-old".to_string(), m(10_000)),
            ("inv-new".to_string(), m(8_000))
        ]
    );

    let part = allocate_oldest_first(m(4_000), &open).unwrap();
    assert_eq!(part, vec![("inv-old".to_string(), m(4_000))]);
}

/// Bug caught: overpayment creates an advance / negative dues (A4), or a
/// zero payment is recorded.
#[test]
fn allocate_oldest_first_refuses_more_than_dues_and_zero() {
    let open = vec![("inv-1".to_string(), m(10_000))];
    assert_eq!(
        allocate_oldest_first(m(10_001), &open),
        Err(BillingError::ExceedsBalance)
    );
    assert_eq!(
        allocate_oldest_first(Money::ZERO, &open),
        Err(BillingError::ExceedsBalance)
    );
    assert_eq!(
        allocate_oldest_first(m(1), &[]),
        Err(BillingError::ExceedsBalance)
    );
}

// ---------------------------------------------------------------------------
// UPI (T-UPI)
// ---------------------------------------------------------------------------

/// Bug caught: a valid VPA refused, or the stored value keeps stray spaces.
#[test]
fn validate_vpa_accepts_common_vpas_and_trims() {
    assert_eq!(validate_vpa("testclinic@upi").unwrap(), "testclinic@upi");
    assert_eq!(
        validate_vpa("  testclinic@upi \t").unwrap(),
        "testclinic@upi"
    );
    assert_eq!(
        validate_vpa("Test.Clinic-1_x@okhdfcbank").unwrap(),
        "Test.Clinic-1_x@okhdfcbank",
        "case is kept as typed"
    );
}

/// Bug caught: a malformed VPA is saved and every QR is unpayable.
#[test]
fn validate_vpa_refuses_malformed_ids() {
    for bad in [
        "",
        "testclinic",
        "testclinic@",
        "@upi",
        "a@upi",
        "test clinic@upi",
        "test@@upi",
        "test@1upi",
        "test@u",
        "test@upi.com",
    ] {
        assert_eq!(
            validate_vpa(bad),
            Err(BillingError::Invalid),
            "{bad:?} must be refused"
        );
    }
}

/// Split `upi://pay?a=b&c=d` into (raw key, raw value) pairs.
fn query_pairs(url: &str) -> Vec<(String, String)> {
    let q = url
        .strip_prefix("upi://pay?")
        .unwrap_or_else(|| panic!("must start with upi://pay?: {url:?}"));
    q.split('&')
        .map(|kv| {
            let (k, v) = kv
                .split_once('=')
                .unwrap_or_else(|| panic!("bad pair {kv:?}"));
            (k.to_string(), v.to_string())
        })
        .collect()
}

/// Minimal RFC 3986 percent-decoder (test oracle only).
fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            let hex = std::str::from_utf8(&b[i + 1..i + 3]).unwrap();
            out.push(u8::from_str_radix(hex, 16).expect("valid %XX"));
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).expect("utf-8")
}

/// Bug caught: the clinic name / note is not percent-encoded, so `&` or a
/// space breaks the UPI app's parse (wrong payee, wrong amount); amount not in
/// rupees.paise; params in an order UPI apps reject.
#[test]
fn upi_pay_url_encodes_name_and_note_and_formats_amount() {
    let url = upi_pay_url(
        "testclinic@upi",
        "Test Clinic & Co",
        m(22_750),
        "Receipt 2026-27/0001",
    );
    let pairs = query_pairs(&url);
    let keys: Vec<&str> = pairs.iter().map(|(k, _)| k.as_str()).collect();
    assert_eq!(
        keys,
        vec!["pa", "pn", "am", "cu", "tn"],
        "param order: {url}"
    );

    for (k, v) in &pairs {
        assert!(
            !v.contains(' ') && !v.contains('&') && !v.contains('=') && !v.contains('#'),
            "{k} value must be percent-encoded: {v:?}"
        );
    }
    let get = |k: &str| pct_decode(&pairs.iter().find(|(kk, _)| kk == k).unwrap().1);
    assert_eq!(get("pa"), "testclinic@upi");
    assert_eq!(get("pn"), "Test Clinic & Co");
    assert_eq!(get("am"), "227.50", "amount in rupees with 2 decimals");
    assert_eq!(get("cu"), "INR");
    assert_eq!(get("tn"), "Receipt 2026-27/0001");
}

/// Bug caught: a zero-amount QR asks the patient to pay Rs 0.00.
#[test]
fn upi_pay_url_omits_amount_when_zero() {
    let url = upi_pay_url(
        "testclinic@upi",
        "Test Clinic",
        Money::ZERO,
        "Receipt 2026-27/0001",
    );
    let keys: Vec<String> = query_pairs(&url).into_iter().map(|(k, _)| k).collect();
    assert_eq!(
        keys,
        vec!["pa", "pn", "cu", "tn"],
        "no am when amount is 0: {url}"
    );
}

/// Bug caught: amounts under a rupee or with single-digit paise misformatted.
#[test]
fn upi_pay_url_amount_formatting_edge_cases() {
    for (paise, want) in [(5, "0.05"), (100, "1.00"), (100_000_000, "1000000.00")] {
        let url = upi_pay_url("testclinic@upi", "Test Clinic", m(paise), "Receipt");
        let am = query_pairs(&url)
            .into_iter()
            .find(|(k, _)| k == "am")
            .unwrap()
            .1;
        assert_eq!(am, want, "{paise} paise");
    }
}
