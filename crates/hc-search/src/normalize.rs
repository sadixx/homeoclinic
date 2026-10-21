//! Normalisation helpers for patient search (HC-MVP1-047 inputs, PSR-002/003).
//!
//! Pure functions, no IO. The writer calls these before inserting a `patient`
//! row so the stored `name_norm`, `mobile_digits` and `code_digits` columns are
//! what the FTS tables and the ranked query read.

/// Fold a single character to its ASCII base, dropping combining diacritics.
///
/// Covers the Latin-1 and Latin Extended-A accented letters that appear in
/// romanised Indian names (e.g. `'ā' -> 'a'`, `'ś' -> 's'`). Characters with no
/// mapping are returned unchanged (and later filtered if not alphanumeric).
fn fold_diacritic(c: char) -> Option<char> {
    let lower = c.to_ascii_lowercase();
    if lower.is_ascii_alphanumeric() || lower == ' ' {
        return Some(lower);
    }
    match c {
        'á' | 'à' | 'â' | 'ä' | 'ã' | 'å' | 'ā' | 'ă' | 'ą' | 'Á' | 'À' | 'Â' | 'Ä' | 'Ã' | 'Å'
        | 'Ā' | 'Ă' | 'Ą' => Some('a'),
        'é' | 'è' | 'ê' | 'ë' | 'ē' | 'ĕ' | 'ė' | 'ę' | 'ě' | 'É' | 'È' | 'Ê' | 'Ë' | 'Ē' | 'Ĕ'
        | 'Ė' | 'Ę' | 'Ě' => Some('e'),
        'í' | 'ì' | 'î' | 'ï' | 'ī' | 'ĭ' | 'į' | 'Í' | 'Ì' | 'Î' | 'Ï' | 'Ī' | 'Ĭ' | 'Į' => {
            Some('i')
        }
        'ó' | 'ò' | 'ô' | 'ö' | 'õ' | 'ø' | 'ō' | 'ŏ' | 'Ó' | 'Ò' | 'Ô' | 'Ö' | 'Õ' | 'Ø' | 'Ō'
        | 'Ŏ' => Some('o'),
        'ú' | 'ù' | 'û' | 'ü' | 'ũ' | 'ū' | 'ŭ' | 'ů' | 'Ú' | 'Ù' | 'Û' | 'Ü' | 'Ũ' | 'Ū' | 'Ŭ'
        | 'Ů' => Some('u'),
        'ñ' | 'ń' | 'ņ' | 'ň' | 'Ñ' | 'Ń' | 'Ņ' | 'Ň' => Some('n'),
        'ś' | 'š' | 'ş' | 'Ś' | 'Š' | 'Ş' => Some('s'),
        'ç' | 'ć' | 'č' | 'Ç' | 'Ć' | 'Č' => Some('c'),
        'ý' | 'ÿ' | 'Ý' | 'Ÿ' => Some('y'),
        'ž' | 'ź' | 'ż' | 'Ž' | 'Ź' | 'Ż' => Some('z'),
        'ŕ' | 'ř' | 'Ŕ' | 'Ř' => Some('r'),
        'ť' | 'ţ' | 'Ť' | 'Ţ' => Some('t'),
        'ď' | 'Ď' => Some('d'),
        'ľ' | 'ĺ' | 'ł' | 'Ľ' | 'Ĺ' | 'Ł' => Some('l'),
        'ğ' | 'Ğ' => Some('g'),
        _ => None,
    }
}

/// Lowercase, strip diacritics and dots, collapse whitespace runs to a single
/// space, and trim.
///
/// e.g. `"Dr. Ramesh  Kumar"` -> `"ramesh kumar"` (PSR-003 `name_norm`). The
/// result is case- and diacritic-insensitive so it matches the FTS
/// `remove_diacritics 2` tokeniser.
pub fn name_norm(name: &str) -> String {
    let mut out = String::with_capacity(name.len());
    let mut last_was_space = true; // true so a leading space is dropped
    for c in name.chars() {
        if c.is_whitespace() {
            if !last_was_space {
                out.push(' ');
                last_was_space = true;
            }
            continue;
        }
        match fold_diacritic(c) {
            Some(' ') => {
                if !last_was_space {
                    out.push(' ');
                    last_was_space = true;
                }
            }
            Some(folded) if folded.is_ascii_alphanumeric() => {
                out.push(folded);
                last_was_space = false;
            }
            // Dots, punctuation and unmapped marks are dropped.
            _ => {}
        }
    }
    if out.ends_with(' ') {
        out.pop();
    }
    out
}

/// Keep ASCII digits only, dropping a leading `91` country code when the result
/// would otherwise be longer than 10 digits.
///
/// e.g. `"+91 98765 43210"` -> `"9876543210"` (PSR-002 mobile digits). A leading
/// `0` is kept because it is a trunk prefix, not a country code.
pub fn mobile_digits(mobile: &str) -> String {
    let digits: String = mobile.chars().filter(|c| c.is_ascii_digit()).collect();
    // Strip an Indian country code only when it is clearly a prefix: the raw
    // input started with '+91' (or '91' immediately after an optional '+') AND
    // dropping it leaves a 10-digit national number. This avoids mangling a
    // genuine number that merely begins with 91.
    if digits.len() > 10 && digits.starts_with("91") && digits.len() - 2 == 10 {
        return digits[2..].to_string();
    }
    digits
}

/// Keep ASCII digits only.
///
/// e.g. `"HC-000123"` -> `"000123"` (PSR-002 id digits).
pub fn code_digits(code: &str) -> String {
    code.chars().filter(|c| c.is_ascii_digit()).collect()
}
