//! Case-template storage tests (HC-MVP1-058, CASE-001..004). The migrated
//! `temp_db()` seeds the 3 default templates; these assert the stored
//! `schema_json` encodes the CASE-001 sections and CASE-004 field types with
//! CASE-003 free-text pick lists. Synthetic / reference data only (R-TEST-004).

use hc_storage::case_template as repo;
use hc_storage::testing::temp_db;
use serde_json::Value;

/// The default template's schema contains the CASE-001 section keys, including
/// the conditional female (`menstrual_obstetric`, showIf.sex=female) and child
/// (`child_development`, showIf.ageYearsLt=14) sections (test 1).
#[test]
fn case_template_default_has_case001_sections_incl_conditional_female_and_child() {
    let (_dir, pool) = temp_db();
    let t = pool
        .with_reader(repo::get_default_template)
        .expect("default template");
    assert_eq!(t.id, repo::CHRONIC_DETAILED_ID);
    assert!(t.is_default);

    let schema: Value = serde_json::from_str(&t.schema_json).expect("schema_json parses");
    let sections = schema["sections"].as_array().expect("sections array");
    let keys: Vec<&str> = sections.iter().filter_map(|s| s["key"].as_str()).collect();

    // CASE-001 core sections.
    for expected in [
        "chief_complaints",
        "hpi",
        "past_history",
        "family_history",
        "personal_history",
        "physical_generals",
        "mental_generals",
        "menstrual_obstetric",
        "child_development",
        "examination",
        "investigations",
        "provisional_diagnosis",
        "analysis",
    ] {
        assert!(
            keys.contains(&expected),
            "missing CASE-001 section {expected}"
        );
    }

    // Conditional female section.
    let menstrual = sections
        .iter()
        .find(|s| s["key"] == "menstrual_obstetric")
        .expect("menstrual_obstetric section");
    assert_eq!(menstrual["showIf"]["sex"], "female");

    // Conditional child (<14) section.
    let child = sections
        .iter()
        .find(|s| s["key"] == "child_development")
        .expect("child_development section");
    assert_eq!(child["showIf"]["ageYearsLt"], 14);

    // Examination carries the computed BMI field (CASE-001 "BMI auto").
    let exam = sections
        .iter()
        .find(|s| s["key"] == "examination")
        .expect("examination section");
    let bmi_field = exam["fields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["key"] == "bmi")
        .expect("bmi field");
    assert!(bmi_field["computed"].as_str().unwrap().contains("bmi("));
}

/// Three default templates ship; exactly one is the default (test 2).
#[test]
fn case_template_list_returns_three_defaults_one_is_default() {
    let (_dir, pool) = temp_db();
    let templates = pool
        .with_reader(repo::list_templates)
        .expect("list templates");
    assert_eq!(templates.len(), 3, "3 default templates ship (CASE-004)");

    let default_count = templates.iter().filter(|t| t.is_default).count();
    assert_eq!(default_count, 1, "exactly one default template");

    let names: Vec<&str> = templates.iter().map(|t| t.name.as_str()).collect();
    assert!(names.contains(&"Chronic detailed"));
    assert!(names.contains(&"Acute quick"));
    assert!(names.contains(&"Child"));
}

/// Fields cover the CASE-004 field-type vocabulary and the CASE-003 pick lists
/// (thermal / thirst single-choice) allow free text (test 3).
#[test]
fn case_template_fields_cover_all_case004_field_types_and_pick_lists_allow_free_text() {
    let (_dir, pool) = temp_db();
    let t = pool
        .with_reader(repo::get_default_template)
        .expect("default template");
    let schema: Value = serde_json::from_str(&t.schema_json).unwrap();

    // Collect every field across sections.
    let mut types = std::collections::HashSet::new();
    let mut thermal_free_text = false;
    let mut thirst_free_text = false;
    for section in schema["sections"].as_array().unwrap() {
        for field in section["fields"].as_array().unwrap() {
            if let Some(ty) = field["type"].as_str() {
                types.insert(ty.to_string());
            }
            if field["key"] == "thermal" {
                thermal_free_text = field["allowFreeText"].as_bool().unwrap_or(false);
                assert_eq!(field["type"], "single-choice");
            }
            if field["key"] == "thirst" {
                thirst_free_text = field["allowFreeText"].as_bool().unwrap_or(false);
                assert_eq!(field["type"], "single-choice");
            }
        }
    }

    // CASE-004 field-type vocabulary present in the default template.
    for ty in ["text", "long-text", "single-choice", "number", "scale0-10"] {
        assert!(types.contains(ty), "field type {ty} must appear (CASE-004)");
    }
    // CASE-003: pick lists allow free text.
    assert!(
        thermal_free_text,
        "thermal pick list allows free text (CASE-003)"
    );
    assert!(
        thirst_free_text,
        "thirst pick list allows free text (CASE-003)"
    );
}
