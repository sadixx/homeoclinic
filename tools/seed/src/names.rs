//! Indian-name pools (region spread) and the PSR-003 spelling/phonetic variant
//! families for the synthetic data generator (HC-MVP1-056).
//!
//! Synthetic names only (R-PRIV-001). The variant families are exactly the
//! collision classes that hc-search's phonetic key already collapses (proven by
//! the Slice A phonetic golden test), so the fixture provably exercises the
//! phonetic search from Slice A: a patient registered under one spelling is
//! found by searching another spelling of the same family.

/// Groups of spelling/phonetic variants (PSR-003). Every member of a group
/// shares a `hc_search::phonetic::phonetic_key`. The fixture includes at least
/// one patient per group so a search for one spelling finds a patient
/// registered under another spelling of the same family.
pub const NAME_VARIANT_FAMILIES: &[&[&str]] = &[
    &["Sharma", "Sarma"],
    &["Mohammad", "Mohammed", "Mohd"],
    &["Lakshmi", "Laxmi"],
    &["Shree", "Sri", "Shri"],
    &["Vijay", "Wijay"],
    &["Krishna", "Krushna"],
    &["Geetha", "Geeta"],
    &["Deepak", "Deepack"],
    &["Phalguni", "Falguni"],
    &["Radha", "Rada"],
];

/// Region-spread given names (synthetic). Used for the general population and as
/// first names paired with the surname pool / variant families.
pub const GIVEN_NAMES: &[&str] = &[
    // North
    "Aarav", "Rohan", "Ishaan", "Kabir", "Ananya", "Priya", "Neha", "Pooja", // South
    "Arun", "Karthik", "Suresh", "Divya", "Meena", "Kavya", "Latha", "Ramesh",
    // East
    "Sourav", "Abhijit", "Rupa", "Moumita", "Tapan", "Sutapa", // West
    "Yash", "Harsh", "Nikita", "Snehal", "Pranav", "Rutuja", // Muslim-name set
    "Imran", "Farhan", "Ayesha", "Zoya", "Sana", "Bilal",
];

/// Surname pool (synthetic), region spread. The PSR-003 variant surnames in
/// [`NAME_VARIANT_FAMILIES`] are layered on top of these in the fixture.
pub const SURNAMES: &[&str] = &[
    "Gupta",
    "Verma",
    "Singh",
    "Reddy",
    "Nair",
    "Iyer",
    "Menon",
    "Patil",
    "Desai",
    "Banerjee",
    "Chatterjee",
    "Das",
    "Khan",
    "Sheikh",
    "Joshi",
    "Rao",
];

/// Cities (synthetic spread across Indian regions).
pub const CITIES: &[&str] = &[
    "Pune",
    "Mumbai",
    "Nagpur",
    "Delhi",
    "Jaipur",
    "Lucknow",
    "Chennai",
    "Bengaluru",
    "Hyderabad",
    "Kochi",
    "Kolkata",
    "Bhubaneswar",
    "Ahmedabad",
    "Surat",
    "Indore",
    "Bhopal",
];

/// A generated display name together with the variant family it belongs to (if
/// any), so a test can search a DIFFERENT spelling of the same family.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PickedName {
    /// The display name as it will be stored (e.g. "Ramesh Sarma").
    pub display: String,
    /// Index into [`NAME_VARIANT_FAMILIES`] if the surname came from a variant
    /// family, else `None`.
    pub variant_family: Option<usize>,
}

/// Pick a display name for patient index `i`, using `rng`.
///
/// Contract (asserted at green):
/// - The first [`NAME_VARIANT_FAMILIES`]`.len()` names use a surname from each
///   variant family in turn, so every family is represented in the fixture.
/// - Later names combine the general given/surname pools.
///
/// The RNG is always advanced (given name + a per-call choice) so a different
/// seed produces a different set even though the coverage schedule is fixed.
pub fn pick_name(rng: &mut impl rand::Rng, i: usize) -> PickedName {
    let given = GIVEN_NAMES[rng.gen_range(0..GIVEN_NAMES.len())];

    if i < NAME_VARIANT_FAMILIES.len() {
        // Coverage phase: one patient per variant family, in order, so every
        // family is represented in the fixture (PSR-003). The seed still picks
        // the given name and which spelling within the family is used.
        let family = i;
        let spellings = NAME_VARIANT_FAMILIES[family];
        let surname = spellings[rng.gen_range(0..spellings.len())];
        return PickedName {
            display: format!("{given} {surname}"),
            variant_family: Some(family),
        };
    }

    // General population: given name + general surname, both seed-driven.
    let surname = SURNAMES[rng.gen_range(0..SURNAMES.len())];
    PickedName {
        display: format!("{given} {surname}"),
        variant_family: None,
    }
}

/// Produce a different spelling of the same variant family, for findability
/// tests: given a family index and the spelling a patient was registered under,
/// return another member of the family (its phonetic key is identical).
///
/// The `registered` display name is the full "Given Surname"; we match on the
/// family's surname tokens and return the first family member that differs from
/// the registered surname, so the returned spelling is guaranteed distinct yet
/// phonetically equivalent (Slice A golden test). Returns an empty string if
/// `family` is out of range (callers assert non-empty).
pub fn other_spelling_in_family(family: usize, registered: &str) -> String {
    let Some(spellings) = NAME_VARIANT_FAMILIES.get(family) else {
        return String::new();
    };
    // The registered surname is the last whitespace-separated token.
    let registered_surname = registered.split_whitespace().last().unwrap_or("");
    for &spelling in spellings.iter() {
        if spelling != registered_surname {
            return spelling.to_string();
        }
    }
    // Single-member family (should not happen for our families): no variant.
    String::new()
}
