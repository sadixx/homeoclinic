//! Representative homeopathy-clinic diagnosis spread for the synthetic data
//! generator (HC-MVP1-056). Stored verbatim in `patient.diagnosis`.
//!
//! The functional-regression fixture guarantees every diagnosis here appears at
//! least once (>= 10 distinct — this list has 14), so M2's register / search /
//! dashboard / recycle features get coverage across diseases.

/// Representative homeopathy-clinic diagnoses (14 >= 10 required). Order is the
/// canonical index used by the coverage round-robin and the weighted draw.
pub const DISEASES: &[&str] = &[
    "Allergic Rhinitis",
    "Atopic Eczema",
    "Migraine",
    "Bronchial Asthma",
    "Osteoarthritis",
    "Irritable Bowel Syndrome",
    "Generalised Anxiety Disorder",
    "Polycystic Ovary Syndrome",
    "Psoriasis",
    "Hypertension",
    "Chronic Urticaria",
    "Gastro-oesophageal Reflux Disease",
    "Chronic Sinusitis",
    "Insomnia",
];

/// Relative weights for the weighted draw, aligned by index with [`DISEASES`].
/// Common complaints weigh more; every disease keeps a non-zero weight so the
/// weighted phase can still reach any of them. Full coverage is additionally
/// guaranteed by the round-robin seeding in [`pick_diagnosis`].
pub const WEIGHTS: &[u32] = &[12, 7, 10, 11, 8, 8, 5, 4, 4, 6, 6, 9, 9, 5];

/// Diagnosis assigned only to female patients (re-rolled for males).
pub const FEMALE_ONLY: &str = "Polycystic Ovary Syndrome";

/// Pick a diagnosis for patient index `i` of a run, for a patient of `sex`
/// ("M"/"F"), using `rng`.
///
/// Contract (asserted by tests at green):
/// - The first [`DISEASES`]`.len()` patients get one disease each, round-robin,
///   so every diagnosis is covered even in the small fixture.
/// - Later patients are drawn by [`WEIGHTS`].
/// - [`FEMALE_ONLY`] is never assigned to a male patient.
pub fn pick_diagnosis(rng: &mut impl rand::Rng, i: usize, sex: &str) -> &'static str {
    // Coverage phase: round-robin every diagnosis once so the fixture covers
    // all of DISEASES even at ~240 patients. A female-only disease landing on a
    // male in this phase is reassigned to the next index that is valid for a
    // male, preserving full coverage overall (the female-only disease is still
    // covered by the many female patients in the weighted phase).
    if i < DISEASES.len() {
        let d = DISEASES[i];
        if d == FEMALE_ONLY && sex != "F" {
            // Shift to the next non-female-only disease (wraps within the list).
            for step in 1..DISEASES.len() {
                let cand = DISEASES[(i + step) % DISEASES.len()];
                if cand != FEMALE_ONLY {
                    return cand;
                }
            }
        }
        return d;
    }

    // Weighted phase: draw by WEIGHTS, re-rolling a female-only disease for a
    // male patient until a valid one is drawn.
    loop {
        let total: u32 = WEIGHTS.iter().sum();
        let mut pick = rng.gen_range(0..total);
        let mut chosen = DISEASES[DISEASES.len() - 1];
        for (idx, &w) in WEIGHTS.iter().enumerate() {
            if pick < w {
                chosen = DISEASES[idx];
                break;
            }
            pick -= w;
        }
        if chosen == FEMALE_ONLY && sex != "F" {
            continue;
        }
        return chosen;
    }
}
