//! Indian number formatting for money (R5 design §4; product rule 8).
//!
//! Integer arithmetic only: paise are split into rupees and paise with `/` and
//! `%`, never through floating point.

/// Split `paise` into (negative?, rupees, paise) without overflowing at
/// `i64::MIN`.
fn split(paise: i64) -> (bool, u64, u64) {
    let neg = paise < 0;
    let abs = paise.unsigned_abs();
    (neg, abs / 100, abs % 100)
}

/// Indian digit grouping of a whole number: last 3 digits, then pairs
/// (`12345678` -> `"1,23,45,678"`).
pub fn group_indian(n: u64) -> String {
    let digits = n.to_string();
    if digits.len() <= 3 {
        return digits;
    }
    let (head, last3) = digits.split_at(digits.len() - 3);
    let mut parts: Vec<&str> = Vec::new();
    let mut end = head.len();
    while end > 0 {
        let start = end.saturating_sub(2);
        parts.push(&head[start..end]);
        end = start;
    }
    parts.reverse();
    format!("{},{}", parts.join(","), last3)
}

/// Indian grouping, 2 decimals: `12345675` -> `"1,23,456.75"`.
pub fn format_inr(paise: i64) -> String {
    let (neg, r, p) = split(paise);
    format!("{}{}.{:02}", if neg { "-" } else { "" }, group_indian(r), p)
}

/// Plain CSV number (no grouping): `13250` -> `"132.50"`.
pub fn rupees_plain(paise: i64) -> String {
    let (neg, r, p) = split(paise);
    format!("{}{}.{:02}", if neg { "-" } else { "" }, r, p)
}
