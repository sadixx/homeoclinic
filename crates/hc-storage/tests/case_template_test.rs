//! Case-template storage tests (HC-MVP1-058 + M3-RW Slice A1). The migrated
//! `temp_db()` seeds the 3 default templates; after migration 0011
//! (`0011_case_template_journal.sql`) the templates describe ONLY the
//! structured side sections of the doctor-journal model (ADR 0018 / M3-RW
//! data-json schema §5): the case BODY is the journal and is no longer
//! schema-driven. These assert the stored `schema_json` matches the journal-era
//! side-section shape. Synthetic / reference data only (R-TEST-004).
//!
//! RED until migration 0011 UPDATEs the three seeded `case_template.schema_json`
//! rows. No `visit.data_json` rows are touched by Slice A.

use hc_storage::case_template as repo;
use hc_storage::testing::temp_db;
use serde_json::Value;

/// Parse the given template's `schema_json` into a `Value`.
fn schema_of(pool: &hc_storage::Pool, id: &str) -> Value {
    let t = pool
        .with_reader(|c| repo::get_template(c, id))
        .expect("read template")
        .expect("template exists");
    serde_json::from_str(&t.schema_json).expect("schema_json parses")
}

/// The ordered section keys of a parsed schema.
fn section_keys(schema: &Value) -> Vec<String> {
    schema["sections"]
        .as_array()
        .expect("sections array")
        .iter()
        .filter_map(|s| s["key"].as_str().map(str::to_string))
        .collect()
}

/// The field keys of one named section in a parsed schema (empty if the section
/// is absent).
fn field_keys(schema: &Value, section_key: &str) -> Vec<String> {
    schema["sections"]
        .as_array()
        .and_then(|secs| secs.iter().find(|s| s["key"] == section_key))
        .and_then(|s| s["fields"].as_array())
        .map(|fs| {
            fs.iter()
                .filter_map(|f| f["key"].as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Find a field object by key within a named section.
fn field<'a>(schema: &'a Value, section_key: &str, field_key: &str) -> Option<&'a Value> {
    schema["sections"]
        .as_array()?
        .iter()
        .find(|s| s["key"] == section_key)?
        .get("fields")?
        .as_array()?
        .iter()
        .find(|f| f["key"] == field_key)
}

/// Three default templates ship; exactly one is the default (unchanged by the
/// journal migration — only the schema content changes, not the row set).
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

/// M3-RW A1 (test 2, schema §5 / ADR 0018 #6): the default `chronic_detailed`
/// physical-generals section gains Constitution, Diet, a yes/no Sun-aggravation
/// and Notes. `sun_aggravation` is a single-choice yes/no (options ["yes","no"],
/// no free text). RED until 0011 rewrites the schema.
#[test]
fn chronic_detailed_physical_generals_gains_journal_fields() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHRONIC_DETAILED_ID);
    let keys = field_keys(&schema, "physical_generals");

    for expected in ["constitution", "diet", "sun_aggravation", "notes"] {
        assert!(
            keys.contains(&expected.to_string()),
            "physical_generals must gain the {expected} field (M3-RW A1)"
        );
    }

    let sun = field(&schema, "physical_generals", "sun_aggravation")
        .expect("sun_aggravation field present");
    assert_eq!(
        sun["type"], "single-choice",
        "sun_aggravation is a yes/no single-choice"
    );
    let options: Vec<&str> = sun["options"]
        .as_array()
        .expect("sun_aggravation options array")
        .iter()
        .filter_map(|o| o.as_str())
        .collect();
    assert_eq!(options, ["yes", "no"], "sun_aggravation options are yes/no");
    assert_eq!(
        sun["allowFreeText"].as_bool(),
        Some(false),
        "sun_aggravation is a locked yes/no (no free text)"
    );
}

/// M3-RW A1 (test 3, schema §5): family history becomes two independent
/// Maternal / Paternal fields (rendered as tabs by the UI) and no longer a
/// single `narrative`. RED until 0011.
#[test]
fn chronic_detailed_family_history_is_maternal_paternal() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHRONIC_DETAILED_ID);
    let keys = field_keys(&schema, "family_history");

    assert!(
        keys.contains(&"maternal".to_string()),
        "family_history must have a maternal field (M3-RW A1)"
    );
    assert!(
        keys.contains(&"paternal".to_string()),
        "family_history must have a paternal field (M3-RW A1)"
    );
    assert!(
        !keys.contains(&"narrative".to_string()),
        "family_history must drop the single narrative field (M3-RW A1)"
    );
}

/// M3-RW A1 (test 4, schema §5): investigations becomes Suggested / Submitted
/// (the Submitted tab hosts the PAT-009 uploads) and no longer a single
/// `narrative`. RED until 0011.
#[test]
fn chronic_detailed_investigations_is_suggested_submitted() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHRONIC_DETAILED_ID);
    let keys = field_keys(&schema, "investigations");

    assert!(
        keys.contains(&"suggested".to_string()),
        "investigations must have a suggested field (M3-RW A1)"
    );
    assert!(
        keys.contains(&"submitted".to_string()),
        "investigations must have a submitted field (M3-RW A1)"
    );
    assert!(
        !keys.contains(&"narrative".to_string()),
        "investigations must drop the single narrative field (M3-RW A1)"
    );
}

/// M3-RW A1 (test 5, ADR 0018 #5/#6): the journal migration REMOVES the
/// `personal_history` section entirely and the body sections `chief_complaints`
/// and `hpi` (replaced by the top-level journal). RED until 0011.
#[test]
fn chronic_detailed_drops_narrative_and_personal_history() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHRONIC_DETAILED_ID);
    let keys = section_keys(&schema);

    for removed in ["personal_history", "chief_complaints", "hpi"] {
        assert!(
            !keys.contains(&removed.to_string()),
            "section {removed} must be removed from the journal-era schema (M3-RW A1)"
        );
    }

    // The retained structured side sections remain present.
    for kept in [
        "physical_generals",
        "family_history",
        "investigations",
        "provisional_diagnosis",
        "analysis",
    ] {
        assert!(
            keys.contains(&kept.to_string()),
            "retained side section {kept} must still be present (M3-RW A1)"
        );
    }
}

/// M3-RW A1 (test 6, slice-plan §2): `acute_quick` is reduced to a minimal side
/// panel — only `provisional_diagnosis` + `analysis`; the body `chief_complaints`
/// and `examination` are gone. RED until 0011.
#[test]
fn acute_quick_is_minimal_side_panel() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::ACUTE_QUICK_ID);
    let keys = section_keys(&schema);

    assert!(
        keys.contains(&"provisional_diagnosis".to_string())
            && keys.contains(&"analysis".to_string()),
        "acute_quick keeps provisional_diagnosis + analysis (M3-RW A1)"
    );
    for removed in ["chief_complaints", "examination"] {
        assert!(
            !keys.contains(&removed.to_string()),
            "acute_quick must drop the {removed} body section (M3-RW A1)"
        );
    }
}

/// M3-RW A1 (test 7, slice-plan §2): `child` keeps `child_development` AND
/// applies the physical-generals / family / investigations journal changes;
/// `personal_history` is gone. RED until 0011.
#[test]
fn child_keeps_development_and_applies_journal_changes() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHILD_ID);
    let keys = section_keys(&schema);

    assert!(
        keys.contains(&"child_development".to_string()),
        "child keeps the child_development section (M3-RW A1)"
    );
    assert!(
        !keys.contains(&"personal_history".to_string()),
        "child drops personal_history like the others (M3-RW A1)"
    );

    // Physical generals gained the new journal fields.
    let pg = field_keys(&schema, "physical_generals");
    for expected in ["constitution", "diet", "sun_aggravation", "notes"] {
        assert!(
            pg.contains(&expected.to_string()),
            "child physical_generals must gain {expected} (M3-RW A1)"
        );
    }
    // Family + investigations got the tab fields.
    assert!(
        field_keys(&schema, "family_history").contains(&"maternal".to_string()),
        "child family_history must have maternal (M3-RW A1)"
    );
    assert!(
        field_keys(&schema, "investigations").contains(&"submitted".to_string()),
        "child investigations must have submitted (M3-RW A1)"
    );
}

/// Pick-list fields still allow free text where it matters: thermal / thirst in
/// physical_generals remain single-choice with free text (CASE-003, retained
/// through the journal migration).
#[test]
fn physical_generals_pick_lists_allow_free_text() {
    let (_dir, pool) = temp_db();
    let schema = schema_of(&pool, repo::CHRONIC_DETAILED_ID);

    for key in ["thermal", "thirst"] {
        let f = field(&schema, "physical_generals", key)
            .unwrap_or_else(|| panic!("{key} field present in physical_generals"));
        assert_eq!(f["type"], "single-choice", "{key} is single-choice");
        assert_eq!(
            f["allowFreeText"].as_bool(),
            Some(true),
            "{key} pick list allows free text (CASE-003)"
        );
    }
}
