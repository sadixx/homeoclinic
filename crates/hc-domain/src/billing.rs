//! Pure billing rules (BILL-001..005; R5 design §3.2): invoice totals and
//! discount, Indian financial year + receipt number, oldest-first allocation,
//! UPI VPA validation and the UPI pay URL. No IO, no clock.

use serde::{Deserialize, Serialize};
use specta::Type;

use crate::money::Money;

/// Invoice line kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum LineKind {
    /// Consultation fee.
    Consultation,
    /// Medicine (free text + manual rate until R4).
    Medicine,
    /// Any other charge.
    Other,
}

/// Payment mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum PaymentMode {
    /// Cash.
    Cash,
    /// UPI.
    Upi,
    /// Card.
    Card,
    /// Other.
    Other,
}

/// Invoice discount.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Discount {
    /// No discount.
    None,
    /// A fixed amount (must be <= subtotal).
    Amount(Money),
    /// A percentage in basis points (0..=10_000), rounded half up.
    Percent {
        /// Basis points (1% = 100).
        basis_points: u32,
    },
}

/// One invoice line as entered.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LineInput {
    /// Line kind.
    pub kind: LineKind,
    /// Description (trimmed 1..=200 chars).
    pub description: String,
    /// Quantity 1..=MAX_QTY.
    pub qty: u32,
    /// Rate per unit (<= Money::MAX_ENTRY).
    pub rate: Money,
}

/// Max lines per invoice (A18).
pub const MAX_LINES: usize = 50;
/// Max quantity per line (A18).
pub const MAX_QTY: u32 = 9_999;
/// Max description length in chars (A18).
pub const MAX_DESCRIPTION_CHARS: usize = 200;
/// Max payment reference length in chars.
pub const MAX_REFERENCE_CHARS: usize = 64;
/// Max void reason length in chars.
pub const MAX_VOID_REASON_CHARS: usize = 200;

/// One computed line amount.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LineAmount {
    /// qty * rate.
    pub amount: Money,
}

/// Computed invoice totals.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InvoiceTotals {
    /// Per-line amounts, input order.
    pub lines: Vec<Money>,
    /// Sum of line amounts.
    pub subtotal: Money,
    /// Discount in paise.
    pub discount: Money,
    /// subtotal - discount.
    pub total: Money,
}

/// Billing validation error. Messages are generic (R-PRIV-001).
#[derive(Debug, thiserror::Error, Clone, PartialEq, Eq)]
pub enum BillingError {
    /// Invalid input.
    #[error("invalid billing input")]
    Invalid,
    /// Discount larger than the subtotal.
    #[error("discount exceeds subtotal")]
    DiscountTooLarge,
    /// Payment larger than the balance.
    #[error("payment exceeds balance")]
    ExceedsBalance,
    /// Edited total below what was already paid.
    #[error("total below amount paid")]
    TotalBelowPaid,
}

/// Validate lines + discount and compute totals.
///
/// Rules (A18): 1..=[`MAX_LINES`] lines; trimmed description 1..=200 chars;
/// qty 1..=[`MAX_QTY`]; rate <= [`Money::MAX_ENTRY`]. Amount discount must be
/// <= subtotal; percent is 0..=10_000 basis points, rounded half up.
pub fn compute_totals(
    lines: &[LineInput],
    discount: &Discount,
) -> Result<InvoiceTotals, BillingError> {
    if lines.is_empty() || lines.len() > MAX_LINES {
        return Err(BillingError::Invalid);
    }
    let mut amounts = Vec::with_capacity(lines.len());
    let mut subtotal = Money::ZERO;
    for l in lines {
        let chars = l.description.trim().chars().count();
        if chars == 0 || chars > MAX_DESCRIPTION_CHARS {
            return Err(BillingError::Invalid);
        }
        if l.qty == 0 || l.qty > MAX_QTY || l.rate > Money::MAX_ENTRY {
            return Err(BillingError::Invalid);
        }
        let amount = l
            .rate
            .checked_mul_qty(l.qty)
            .map_err(|_| BillingError::Invalid)?;
        subtotal = subtotal
            .checked_add(amount)
            .map_err(|_| BillingError::Invalid)?;
        amounts.push(amount);
    }
    let discount_amt = match *discount {
        Discount::None => Money::ZERO,
        Discount::Amount(a) => {
            if a > subtotal {
                return Err(BillingError::DiscountTooLarge);
            }
            a
        }
        Discount::Percent { basis_points } => {
            if basis_points > 10_000 {
                return Err(BillingError::DiscountTooLarge);
            }
            subtotal
                .percent_bp(basis_points)
                .map_err(|_| BillingError::Invalid)?
        }
    };
    let total = subtotal
        .checked_sub(discount_amt)
        .map_err(|_| BillingError::DiscountTooLarge)?;
    Ok(InvoiceTotals {
        lines: amounts,
        subtotal,
        discount: discount_amt,
        total,
    })
}

/// Parse a strict `YYYY-MM-DD` calendar date into `(year, month, day)`.
///
/// Refuses any other shape (no time part, no `/`), month 13, Feb 30 and so on.
pub fn parse_iso_date(s: &str) -> Option<(i32, u32, u32)> {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let digits = |r: std::ops::Range<usize>| -> Option<u32> {
        let part = &s[r];
        if !part.bytes().all(|c| c.is_ascii_digit()) {
            return None;
        }
        part.parse().ok()
    };
    let y = digits(0..4)? as i32;
    let m = digits(5..7)?;
    let d = digits(8..10)?;
    if !(1..=12).contains(&m) || d == 0 || d > days_in_month(y, m) {
        return None;
    }
    Some((y, m, d))
}

/// Number of days in `month` (1..=12) of `year` (Gregorian).
pub fn days_in_month(year: i32, month: u32) -> u32 {
    match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || year % 400 == 0 {
                29
            } else {
                28
            }
        }
        _ => 0,
    }
}

/// Indian financial year (April..March).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct FinancialYear {
    start_year: i32,
}

impl FinancialYear {
    /// FY of a local `YYYY-MM-DD` date: April onwards belongs to the FY that
    /// starts that year, January..March to the FY that started the year before.
    pub fn of_date(iso_date: &str) -> Result<FinancialYear, BillingError> {
        let (y, m, _) = parse_iso_date(iso_date).ok_or(BillingError::Invalid)?;
        let start_year = if m >= 4 { y } else { y - 1 };
        Ok(FinancialYear { start_year })
    }

    /// `"2026-27"`; the second part is the last two digits of the end year
    /// (`2099` -> `"2099-00"`).
    pub fn label(&self) -> String {
        format!(
            "{}-{:02}",
            self.start_year,
            (self.start_year + 1).rem_euclid(100)
        )
    }

    /// The calendar year in which the FY starts.
    pub fn start_year(&self) -> i32 {
        self.start_year
    }
}

/// `"2026-27/0142"`: the seq is zero-padded to 4 digits; larger seqs are
/// printed in full.
pub fn receipt_number(fy: &FinancialYear, seq: u32) -> String {
    format!("{}/{:04}", fy.label(), seq)
}

/// Oldest-first allocation of `amount` over `(invoice_id, balance)` in the
/// given order. Zero balances are skipped. `Err(ExceedsBalance)` if `amount`
/// is zero or larger than the sum of the balances (no advance, A4).
pub fn allocate_oldest_first(
    amount: Money,
    open: &[(String, Money)],
) -> Result<Vec<(String, Money)>, BillingError> {
    if amount == Money::ZERO {
        return Err(BillingError::ExceedsBalance);
    }
    let mut remaining = amount;
    let mut out = Vec::new();
    for (id, bal) in open {
        if remaining == Money::ZERO {
            break;
        }
        if *bal == Money::ZERO {
            continue;
        }
        let take = if *bal < remaining { *bal } else { remaining };
        remaining = remaining
            .checked_sub(take)
            .map_err(|_| BillingError::Invalid)?;
        out.push((id.clone(), take));
    }
    if remaining != Money::ZERO {
        return Err(BillingError::ExceedsBalance);
    }
    Ok(out)
}

/// Validate and normalise (trim) a UPI VPA:
/// `^[A-Za-z0-9._-]{2,256}@[A-Za-z][A-Za-z0-9]{1,63}$`. Case is kept as typed.
pub fn validate_vpa(raw: &str) -> Result<String, BillingError> {
    let v = raw.trim();
    let (local, handle) = v.split_once('@').ok_or(BillingError::Invalid)?;
    let local_ok = (2..=256).contains(&local.len())
        && local
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'_' | b'-'));
    let mut hb = handle.bytes();
    let handle_ok = (2..=64).contains(&handle.len())
        && hb.next().is_some_and(|c| c.is_ascii_alphabetic())
        && hb.all(|c| c.is_ascii_alphanumeric());
    if !local_ok || !handle_ok {
        return Err(BillingError::Invalid);
    }
    Ok(v.to_string())
}

/// RFC 3986 percent-encoding: every byte outside the unreserved set is `%XX`.
fn pct_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~') {
            out.push(char::from(b));
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// `upi://pay?pa=<vpa>&pn=<payee>&am=<rupees.paise>&cu=INR&tn=<note>`.
///
/// `pn` and `tn` are percent-encoded; `am` is omitted when `amount` is zero.
/// By contract the caller passes the clinic name and the receipt number only,
/// never patient data.
pub fn upi_pay_url(vpa: &str, payee_name: &str, amount: Money, note: &str) -> String {
    // A validated VPA only has URL-safe characters plus `@`, which UPI apps
    // expect raw.
    let mut url = format!("upi://pay?pa={}&pn={}", vpa, pct_encode(payee_name));
    let p = amount.paise();
    if p > 0 {
        url.push_str(&format!("&am={}.{:02}", p / 100, p % 100));
    }
    url.push_str("&cu=INR&tn=");
    url.push_str(&pct_encode(note));
    url
}
