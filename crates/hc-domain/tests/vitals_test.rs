//! BMI computation tests (HC-MVP1-062, CASE-001). Pure domain, no IO.

use hc_domain::vitals::bmi;

/// BMI is correct from weight (kg) + height (cm), rounded to 1 dp; absent or
/// non-positive inputs yield `None` (fail closed).
#[test]
fn bmi_correct_from_weight_and_height() {
    // 70 kg at 170 cm → 70 / 1.7^2 = 24.221… → 24.2 (1 dp).
    assert_eq!(bmi(Some(70.0), Some(170.0)), Some(24.2));
    // Missing weight → None.
    assert_eq!(bmi(None, Some(170.0)), None);
    // Missing height → None.
    assert_eq!(bmi(Some(70.0), None), None);
    // Non-positive height → None (no divide-by-zero / nonsense).
    assert_eq!(bmi(Some(70.0), Some(0.0)), None);
    // Non-positive weight → None.
    assert_eq!(bmi(Some(0.0), Some(170.0)), None);
}
