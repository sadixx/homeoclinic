//! Indian-name phonetic key (HC-MVP1-048, PSR-003).
//!
//! A rule-based phonetic coder tuned for romanised Indian names so common
//! spelling variants collide on a single key: Sharma/Sarma, Mohd/Mohammad,
//! Lakshmi/Laxmi, Shree/Sri, Vijay/Wijay, and the general spelling-variant
//! classes behind them (sh↔s, v↔w, ph↔f, aspirated th/dh/kh/bh↔t/d/k/b,
//! long↔short vowels aa/a · ee/i · oo/u, doubled letters, dropped silent
//! vowels). Case- and diacritic-insensitive.
//!
//! Pure and deterministic: the key depends only on the input string. The exact
//! key alphabet is an implementation detail; the contract is the collision /
//! separation behaviour asserted by the golden test (PSR-003).

use crate::normalize::name_norm;

/// Produce a phonetic key for `name`: one key per whitespace-separated word,
/// space-joined (PSR-003).
///
/// Contract (asserted by the golden test):
/// - Known Indian-name spelling variants share a key (collision).
/// - Clearly unrelated names produce different keys (separation).
/// - The function is case- and diacritic-insensitive.
pub fn phonetic_key(name: &str) -> String {
    name_norm(name)
        .split_whitespace()
        .map(word_key)
        .collect::<Vec<_>>()
        .join(" ")
}

/// Phonetic key for a single already-normalised (lowercase, ASCII, no
/// diacritics) word.
fn word_key(word: &str) -> String {
    let mut s = word.to_string();

    // A handful of romanisations are irregular enough that a general rewrite
    // cannot reconcile them (abbreviations, elided syllables). Canonicalise
    // these roots up front, before the general rules run.
    s = apply_root_aliases(&s);

    s = apply_digraph_rules(&s);
    s = fold_aspirates(&s);
    s = fold_semivowels_and_fricatives(&s);
    let coded = reduce_to_skeleton(&s);
    collapse_doubles(&coded)
}

/// Canonicalise irregular roots whose variants differ by an elided or
/// abbreviated syllable the general rules cannot recover. Longest patterns
/// first so e.g. `muhammad` matches before `muham`.
fn apply_root_aliases(s: &str) -> String {
    // Each entry maps any spelling in the group to a single canonical stem.
    // Matched as a whole word (the words are already split by `phonetic_key`).
    const ALIASES: &[(&[&str], &str)] = &[
        // Prophet's name: the `mohd` abbreviation and the aa/u/e variants.
        (
            &[
                "mohd", "mohammad", "muhammad", "mohammed", "muhammed", "mohamad",
            ],
            "mhmd",
        ),
        // Shree / Sri / Shri / Sree — the `h` and vowel differ, the stem is `sr`.
        (&["shree", "sri", "shri", "sree"], "sr"),
        // Ganesh / Gnesh — the first vowel is sometimes elided entirely.
        (&["gnesh"], "ganesh"),
        // Phool / Ful / Phul / Fool — ph/f + oo/u over the same stem.
        (&["phool", "ful", "phul", "fool"], "ful"),
    ];
    for (spellings, canonical) in ALIASES {
        if spellings.contains(&s) {
            return (*canonical).to_string();
        }
    }
    s.to_string()
}

/// Rewrite multi-letter graphemes to a single phonetic letter. Order matters:
/// three-letter clusters before the two-letter ones they contain.
fn apply_digraph_rules(s: &str) -> String {
    let mut s = s.to_string();
    // `ksh` and `x` → `ks` (Lakshmi/Laxmi).
    s = s.replace("ksh", "ks");
    s = s.replace('x', "ks");
    // `ck` → `k` (Deepak/Deepack): the `c` is an inert doubling of `k`.
    s = s.replace("ck", "k");
    // `sh` → `s` (Sharma/Sarma, Krishna/Krushna). Done after `ksh` so the `k`
    // is preserved.
    s = s.replace("sh", "s");
    // `ph` → `f` (Phalguni/Falguni); `f` is folded to `p`-class below.
    s = s.replace("ph", "f");
    s
}

/// Fold aspirated consonants (an `h` after a stop) to their unaspirated base,
/// since Indian romanisations add or drop the `h` freely
/// (Geetha/Geeta, Radha/Rada, Nikhil, Bhavna/Bavna, Chandra/Chandhra).
fn fold_aspirates(s: &str) -> String {
    let mut s = s.to_string();
    s = s.replace("th", "t");
    s = s.replace("dh", "d");
    s = s.replace("kh", "k");
    s = s.replace("gh", "g");
    s = s.replace("bh", "b");
    s = s.replace("ch", "c");
    s = s.replace("jh", "j");
    // Any `h` left over after the digraph/aspirate folding (e.g. the stray `h`
    // from a doubled `shh` in `Rameshh`, or a bare aspirate) is silent.
    s = s.replace('h', "");
    s
}

/// Fold semivowels and fricatives that vary between spellings:
/// `w`→`v` (Vijay/Wijay), `f`→`p` (ph/f already folded to `f`; the Indian
/// `f`/`ph` is a `p`-class sound), `y` dropped as a glide.
fn fold_semivowels_and_fricatives(s: &str) -> String {
    let mut s = s.to_string();
    s = s.replace('w', "v");
    s = s.replace('f', "p");
    s
}

/// Reduce to a consonant skeleton with a single collapsed vowel marker.
///
/// - Every vowel run (a/e/i/o/u) collapses to a single `a` placeholder, so
///   long↔short and spelling-variant vowels (aa/a, ee/i, oo/u, ai/ay) all
///   agree, while word *shape* (vowel present vs absent between consonants) is
///   preserved to keep unrelated names apart.
/// - A trailing vowel placeholder is dropped so `radha`→`rad` equals
///   `rada`→`rad`.
/// - `y` acts as a vowel (Jyoti/Jyothi, Swati/Svati keep the glide position).
fn reduce_to_skeleton(s: &str) -> String {
    let is_vowel = |c: char| matches!(c, 'a' | 'e' | 'i' | 'o' | 'u' | 'y');
    let mut out = String::with_capacity(s.len());
    let mut prev_was_vowel = false;
    for c in s.chars() {
        if !c.is_ascii_alphabetic() {
            continue;
        }
        if is_vowel(c) {
            if !prev_was_vowel {
                out.push('a');
            }
            prev_was_vowel = true;
        } else {
            out.push(c);
            prev_was_vowel = false;
        }
    }
    // Drop a trailing vowel placeholder so final long vowels / dropped schwas
    // agree (Radha/Rada, Meena/Mina already agree via the run-collapse).
    if out.ends_with('a') {
        out.pop();
    }
    out
}

/// Collapse any run of the same letter to one (Komal/Komall, Rameshh/Ramesh,
/// Krishnna/Krishna) after all other folding.
fn collapse_doubles(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev = '\0';
    for c in s.chars() {
        if c != prev {
            out.push(c);
            prev = c;
        }
    }
    out
}
