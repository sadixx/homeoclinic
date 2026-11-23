//! Amount in words, Indian system (BILL-003; R5 design §8.2).
//!
//! Groups: Crore (10^7, recursive for >= 100 crore), Lakh (10^5), Thousand,
//! Hundred. Compound tens are hyphenated ("Twenty-One"), words are Title Case.

const ONES: [&str; 20] = [
    "Zero",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
];
const TENS: [&str; 10] = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety",
];

/// Words for 1..=99.
fn below_hundred(n: u64, out: &mut Vec<String>) {
    if n < 20 {
        out.push(ONES[n as usize].to_string());
    } else if n.is_multiple_of(10) {
        out.push(TENS[(n / 10) as usize].to_string());
    } else {
        out.push(format!(
            "{}-{}",
            TENS[(n / 10) as usize],
            ONES[(n % 10) as usize]
        ));
    }
}

/// Words for 1..=99_999 (Thousand / Hundred / tens), appended to `out`.
fn below_lakh(n: u64, out: &mut Vec<String>) {
    let thousands = n / 1_000;
    let hundreds = (n % 1_000) / 100;
    let rest = n % 100;
    if thousands > 0 {
        below_hundred(thousands, out);
        out.push("Thousand".to_string());
    }
    if hundreds > 0 {
        out.push(ONES[hundreds as usize].to_string());
        out.push("Hundred".to_string());
    }
    if rest > 0 {
        below_hundred(rest, out);
    }
}

/// Words for a positive whole number (`n > 0`) in the Indian system.
fn whole(n: u64, out: &mut Vec<String>) {
    let crore = n / 10_000_000;
    let lakh = (n % 10_000_000) / 100_000;
    let rest = n % 100_000;
    if crore > 0 {
        whole(crore, out);
        out.push("Crore".to_string());
    }
    if lakh > 0 {
        below_hundred(lakh, out);
        out.push("Lakh".to_string());
    }
    if rest > 0 {
        below_lakh(rest, out);
    }
}

/// Words for `n` (zero gives "Zero").
fn number_words(n: u64) -> String {
    if n == 0 {
        return ONES[0].to_string();
    }
    let mut out = Vec::new();
    whole(n, &mut out);
    out.join(" ")
}

/// `"Rupees ... Only"` / `"Rupees ... and ... Paise Only"`. Negative input is
/// prefixed with `"Minus "`; never panics (also at `i64::MIN`).
pub fn amount_in_words(paise: i64) -> String {
    let abs = paise.unsigned_abs();
    let rupees = abs / 100;
    let sub = abs % 100;
    let mut s = String::new();
    if paise < 0 {
        s.push_str("Minus ");
    }
    s.push_str("Rupees ");
    s.push_str(&number_words(rupees));
    if sub != 0 {
        s.push_str(" and ");
        s.push_str(&number_words(sub));
        s.push_str(" Paise");
    }
    s.push_str(" Only");
    s
}
