//! HC-MVP1-048 / PSR-003: Indian-name phonetic key golden test.
//!
//! Variant spellings of the same Indian name must collide on one phonetic key;
//! clearly unrelated names must not. >=200 variant pairs (PSR-003 DoD).
//!
//! RED before green: `phonetic_key` is a stub returning `""`, so every
//! `assert_ne!` separation case fails. Synthetic names only (R-TEST-004).

use hc_search::phonetic::phonetic_key;

/// Families of spelling variants that MUST share a phonetic key. Each inner
/// slice is one logical name; every unordered pair within it must collide.
/// (PSR-003 lists Sharma/Sarma, Mohd/Mohammad/Muhammad, Lakshmi/Laxmi,
/// Shree/Sri, Vijay/Wijay; the rest are the same spelling-variant classes:
/// sh/s, v/w, ph/f, aa/a, ee/i, oo/u, doubled letters, dropped silent vowels.)
fn variant_families() -> Vec<Vec<&'static str>> {
    vec![
        vec!["Sharma", "Sarma", "Sharmaa", "Sarmaa"],
        vec!["Mohd", "Mohammad", "Muhammad", "Mohammed", "Muhammed"],
        vec!["Lakshmi", "Laxmi", "Lakshmee", "Laxmee"],
        vec!["Shree", "Sri", "Shri", "Sree"],
        vec!["Vijay", "Wijay", "Vijai", "Wijai"],
        vec!["Verma", "Varma", "Werma", "Varmaa"],
        vec!["Vishnu", "Wishnu", "Vishnoo", "Wishnoo"],
        vec!["Phalguni", "Falguni", "Phalgunee", "Falgunee"],
        vec!["Phool", "Ful", "Phul", "Fool"],
        vec!["Krishna", "Krishnaa", "Krushna", "Krishnna"],
        vec!["Gopal", "Gopaal", "Gopall", "Gopaall"],
        vec!["Ramesh", "Rameshh", "Rameesh", "Raamesh"],
        vec!["Suresh", "Sureshh", "Sureesh", "Sooresh"],
        vec!["Ganesh", "Ganeshh", "Ganeesh", "Gnesh"],
        vec!["Mahesh", "Maheshh", "Maheesh", "Mahaesh"],
        vec!["Rajesh", "Raajesh", "Rajeshh", "Raajeshh"],
        vec!["Deepak", "Dipak", "Deepaak", "Deepack"],
        vec!["Neeraj", "Niraj", "Neraj", "Neeeraj"],
        vec!["Sita", "Seeta", "Seetha", "Sitha"],
        vec!["Geeta", "Gita", "Geetha", "Githa"],
        vec!["Reeta", "Rita", "Reetha", "Ritha"],
        vec!["Anil", "Aneel", "Anill", "Aneell"],
        vec!["Sunil", "Suneel", "Sunill", "Suneell"],
        vec!["Kavita", "Kaveeta", "Kavitha", "Kaveetha"],
        vec!["Savita", "Saveeta", "Savitha", "Saveetha"],
        vec!["Pooja", "Puja", "Poojaa", "Pujaa"],
        vec!["Anita", "Aneeta", "Anitha", "Aneetha"],
        vec!["Sunita", "Suneeta", "Sunitha", "Suneetha"],
        vec!["Bhaskar", "Baskar", "Bhaaskar", "Baaskar"],
        vec!["Chandra", "Chandraa", "Chundra", "Chandhra"],
        vec!["Jyoti", "Jyothi", "Jyotee", "Jyothee"],
        vec!["Preeti", "Priti", "Preetee", "Pritee"],
        vec!["Swati", "Svati", "Swatee", "Svatee"],
        vec!["Vikram", "Wikram", "Vikraam", "Wikraam"],
        vec!["Ashok", "Ashoka", "Ashokh", "Ashoak"],
        vec!["Dinesh", "Dineshh", "Dineesh", "Dinaesh"],
        vec!["Naresh", "Nareshh", "Nareesh", "Naaresh"],
        vec!["Rakesh", "Raakesh", "Rakeshh", "Raakeshh"],
        vec!["Mukesh", "Mukeshh", "Mukeesh", "Mookesh"],
        vec!["Bhavna", "Bhawna", "Bhaavna", "Bhaawna"],
        vec!["Sanjay", "Sanjai", "Sunjay", "Sanjaay"],
        vec!["Ajay", "Ajai", "Ajaay", "Ujay"],
        vec!["Manoj", "Manooj", "Manojh", "Munoj"],
        vec!["Pankaj", "Pankuj", "Pankajh", "Pankaaj"],
        vec!["Radha", "Raadha", "Radhaa", "Rada"],
        vec!["Meena", "Mina", "Meenaa", "Minaa"],
        vec!["Seema", "Sima", "Seemaa", "Simaa"],
        vec!["Reema", "Rima", "Reemaa", "Rimaa"],
        vec!["Komal", "Komall", "Komaal", "Komaall"],
        vec!["Nikhil", "Nikheel", "Nikhill", "Nikheell"],
    ]
}

/// Return every unordered variant pair, as `(a, b)` that MUST collide.
fn collide_pairs() -> Vec<(&'static str, &'static str)> {
    let mut pairs = Vec::new();
    for family in variant_families() {
        for i in 0..family.len() {
            for j in (i + 1)..family.len() {
                pairs.push((family[i], family[j]));
            }
        }
    }
    pairs
}

#[test]
fn psr003_variant_pairs_share_a_phonetic_key() {
    let pairs = collide_pairs();
    assert!(
        pairs.len() >= 200,
        "golden set must have >=200 variant pairs (PSR-003 DoD), has {}",
        pairs.len()
    );
    for (a, b) in pairs {
        assert_eq!(
            phonetic_key(a),
            phonetic_key(b),
            "variants {a:?} and {b:?} must share a phonetic key (PSR-003)"
        );
    }
}

#[test]
fn psr003_unrelated_names_do_not_share_a_key() {
    // Clearly distinct Indian surnames/given names: no shared key allowed.
    let distinct = [
        "Sharma", "Gupta", "Patel", "Reddy", "Nair", "Iyer", "Khan", "Das", "Bose", "Menon", "Rao",
        "Singh", "Joshi", "Mehta", "Kapoor", "Chopra", "Ramesh", "Lakshmi", "Vijay", "Ganesh",
        "Pooja", "Anil",
    ];
    for i in 0..distinct.len() {
        for j in (i + 1)..distinct.len() {
            let (a, b) = (distinct[i], distinct[j]);
            assert_ne!(
                phonetic_key(a),
                phonetic_key(b),
                "unrelated names {a:?} and {b:?} must NOT share a phonetic key"
            );
        }
    }
}

#[test]
fn psr003_key_is_case_and_diacritic_insensitive() {
    assert_eq!(phonetic_key("SHARMA"), phonetic_key("sharma"));
    assert_eq!(phonetic_key("Lakshmi"), phonetic_key("LAKSHMI"));
    // Diacritic fold: "Śarmā" collides with "Sharma".
    assert_eq!(phonetic_key("Śarmā"), phonetic_key("Sharma"));
}

#[test]
fn psr003_key_is_one_token_per_word() {
    // A two-word name yields a two-token (space-joined) key; the per-word keys
    // equal the single-word keys. "Lakshmi Sharma" -> "<Lakshmi> <Sharma>".
    let full = phonetic_key("Lakshmi Sharma");
    let tokens: Vec<&str> = full.split_whitespace().collect();
    assert_eq!(tokens.len(), 2, "one key per word, space-joined (PSR-003)");
    assert_eq!(tokens[0], phonetic_key("Lakshmi"));
    assert_eq!(tokens[1], phonetic_key("Sharma"));
}
