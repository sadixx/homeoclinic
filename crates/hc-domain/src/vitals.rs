//! Visit vitals value types and the pure BMI computation (HC-MVP1-062,
//! CASE-001 "Examination findings … BMI auto").
//!
//! Pure domain only: no IO, no async, no SQL, no wall clock (R-ARCH-002). The
//! `hc-app` visit autosave recomputes [`bmi`] from the entered weight/height so
//! the value stored in `vitals_json` is always consistent with its inputs; the
//! raw weight/height are what the doctor types, the BMI is derived.
//!
//! BMI uses `f64` for the physical computation only. It is NOT money, so the
//! integer-paise rule (R-DATA-004) does not apply here.

/// Vitals captured on a visit (CASE-001 examination block). Pure value type;
/// every field optional because the doctor fills what is relevant.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct Vitals {
    /// Body weight in kilograms, or `None`.
    pub weight_kg: Option<f64>,
    /// Height in centimetres, or `None`.
    pub height_cm: Option<f64>,
    /// Computed body-mass index (derived from `weight_kg` + `height_cm`), or
    /// `None` when either input is missing or non-positive.
    pub bmi: Option<f64>,
}

impl Vitals {
    /// Return a copy with [`bmi`] recomputed from the current `weight_kg` and
    /// `height_cm`, so a stored `Vitals` always carries a consistent BMI.
    pub fn with_computed_bmi(self) -> Vitals {
        Vitals {
            bmi: bmi(self.weight_kg, self.height_cm),
            ..self
        }
    }
}

/// Body-mass index from weight (kg) and height (cm), rounded to one decimal
/// place: `BMI = weight_kg / (height_m)^2` where `height_m = height_cm / 100`.
///
/// Returns `None` when either input is absent, non-finite, or non-positive, so
/// a missing or nonsensical measurement never yields a bogus number
/// (R-RUST-002: fail closed on bad input). Deterministic and pure (R-ARCH-002).
///
/// # Examples
/// ```
/// use hc_domain::vitals::bmi;
/// assert_eq!(bmi(Some(70.0), Some(170.0)), Some(24.2));
/// assert_eq!(bmi(None, Some(170.0)), None);
/// assert_eq!(bmi(Some(70.0), Some(0.0)), None);
/// ```
pub fn bmi(weight_kg: Option<f64>, height_cm: Option<f64>) -> Option<f64> {
    let w = weight_kg?;
    let h_cm = height_cm?;
    if !w.is_finite() || !h_cm.is_finite() || w <= 0.0 || h_cm <= 0.0 {
        return None;
    }
    let h_m = h_cm / 100.0;
    let raw = w / (h_m * h_m);
    if !raw.is_finite() {
        return None;
    }
    // Round to one decimal place (clinical convention).
    Some((raw * 10.0).round() / 10.0)
}
