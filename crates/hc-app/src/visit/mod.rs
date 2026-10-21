//! Visit + case-template use-case service (HC-MVP1-058/061/062/063/064/068..072,
//! CASE-001/004/005/006/009, VIS-001..005).
//!
//! Over the `hc-storage` `case_template` + `visit` repositories with the
//! injected [`Clock`] and the open [`Pool`] passed per call (the
//! `PatientService` pattern). Every write runs in ONE transaction with exactly
//! ONE audit row (R-DATA-001); the `visit_fts` shadow row + the denormalised
//! `patient` counters are maintained in the SAME transaction (R-DATA-006,
//! R-DATA-009). BMI is recomputed on autosave through the pure
//! [`hc_domain::vitals::bmi`] (D4). Ids are UUIDv7 (R-DATA-005). No patient
//! free text is written to the audit diff or logged (R-PRIV-001).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use specta::Type;

use hc_storage::audit::{write_audit, AuditAction, AuditEntry};
use hc_storage::case_template as tpl_repo;
use hc_storage::visit::{self as visit_repo, VisitRow};
use hc_storage::Pool;

use crate::clock::Clock;
use crate::error::AppError;

/// Bounded cap for the Today lists (R-DATA-007). Each Today section shows a
/// manageable page; the UI loads more via keyset if ever needed.
const TODAY_LIMIT: i64 = 200;

// ---------------------------------------------------------------------------
// Case-template commands (CASE-004/001).
// ---------------------------------------------------------------------------

/// `case_template_get_default` response — the default template (CASE-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DefaultTemplateResponse {
    /// Template id (the fixed default id).
    pub template_id: String,
    /// Display name.
    pub name: String,
    /// The JSON schema (sections[] -> fields[]).
    pub schema_json: String,
}

/// One template summary row (`case_template_list`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TemplateSummary {
    /// Template id.
    pub id: String,
    /// Display name.
    pub name: String,
    /// Whether this is the default template.
    pub is_default: bool,
}

/// `case_template_list` response (CASE-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TemplateListResponse {
    /// All templates in presentation order.
    pub templates: Vec<TemplateSummary>,
}

// ---------------------------------------------------------------------------
// Case-visit (first/detailed) commands (VIS-001, CASE-005/009).
// ---------------------------------------------------------------------------

/// `case_visit_open_or_create` request (VIS-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenOrCreateRequest {
    /// Patient the visit belongs to.
    pub patient_id: String,
    /// Visit type: `first | follow_up | acute | tele`.
    pub visit_type: String,
}

/// `case_visit_open_or_create` response (VIS-001).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenOrCreateResponse {
    /// The open or newly created visit id.
    pub visit_id: String,
    /// The default template id the case form renders.
    pub template_id: String,
    /// Current case-form answers JSON (empty object on a fresh visit).
    pub data_json: String,
    /// Current vitals JSON (empty object on a fresh visit).
    pub vitals_json: String,
    /// RFC3339 visit instant.
    pub visit_at: String,
}

/// `case_visit_autosave` request (CASE-005).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CaseAutosaveRequest {
    /// Visit to update.
    pub visit_id: String,
    /// Case-form answers JSON.
    pub data_json: String,
    /// Vitals JSON (weight/height drive the recomputed BMI).
    pub vitals_json: String,
}

/// Autosave acknowledgement (CASE-005 / VIS-002) — the "Saved" timestamp.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AutosaveResponse {
    /// RFC3339 instant the save committed at.
    pub saved_at: String,
}

/// `case_summary_render` request (CASE-009).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRenderRequest {
    /// Visit to render.
    pub visit_id: String,
}

/// `case_summary_render` response (CASE-009) — read-only printable HTML.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRenderResponse {
    /// The rendered, non-empty case-summary HTML.
    pub html: String,
}

// ---------------------------------------------------------------------------
// Follow-up visit commands (VIS-002/003/004).
// ---------------------------------------------------------------------------

/// `visit_create_followup` request (VIS-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateFollowupRequest {
    /// Patient the follow-up belongs to.
    pub patient_id: String,
    /// The previous visit whose complaints pre-load.
    pub prev_visit_id: String,
}

/// One pre-loaded previous complaint (VIS-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PrevComplaint {
    /// Complaint key (section/complaint identifier).
    pub key: String,
    /// Complaint text (sensation / summary).
    pub text: String,
    /// Complaint location, or empty if none.
    pub location: String,
}

/// `visit_create_followup` response (VIS-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CreateFollowupResponse {
    /// The new follow-up visit id.
    pub visit_id: String,
    /// RFC3339 visit instant.
    pub visit_at: String,
    /// The previous visit's complaints, pre-loaded with status to be set.
    pub prev_complaints: Vec<PrevComplaint>,
}

/// `visit_autosave` request (VIS-002/003) — the follow-up fields.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FollowupAutosaveRequest {
    /// Visit to update.
    pub visit_id: String,
    /// Visit type.
    #[serde(rename = "type")]
    pub visit_type: String,
    /// Per-complaint status JSON (Better/Same/Worse/New/Resolved).
    pub complaint_status_json: String,
    /// Per-complaint improvement % JSON (D1).
    pub improvement_pct_json: String,
    /// Remedy-response quick-pick value (VIS-003), or `None`.
    pub remedy_response: Option<String>,
    /// Vitals JSON.
    pub vitals_json: String,
    /// Free-text observations.
    pub observations: String,
}

/// `visit_set_next_followup` request (VIS-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetNextFollowupRequest {
    /// Visit whose next follow-up is set.
    pub visit_id: String,
    /// Next follow-up date (RFC3339 date), or `None` to clear.
    pub next_followup_on: Option<String>,
}

/// `visit_set_next_followup` response (VIS-004).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OkResponse {
    /// Whether the update succeeded.
    pub ok: bool,
}

// ---------------------------------------------------------------------------
// Today overview (VIS-005).
// ---------------------------------------------------------------------------

/// A Today-list patient row (due-today / overdue).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodayPatientRow {
    /// Patient id.
    pub patient_id: String,
    /// Patient code.
    pub code: String,
    /// Display name.
    pub name: String,
    /// Age label (e.g. `"34 y"`), derived from dob/age_years.
    pub age_label: String,
    /// Sex, or `None`.
    pub sex: Option<String>,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// Next-follow-up date (RFC3339 date), or `None`.
    pub next_followup_on: Option<String>,
    /// Outstanding dues in paise (0 at R3 — billing not built, R-DEL-002).
    #[specta(type = specta_typescript::Number)]
    pub dues_paise: i64,
}

/// A Today-list registered-visit row (today's registered visits).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodayVisitRow {
    /// Patient id.
    pub patient_id: String,
    /// Patient code.
    pub code: String,
    /// Patient display name.
    pub name: String,
    /// Opaque photo attachment ref, or `None`.
    pub photo_path: Option<String>,
    /// RFC3339 visit instant.
    pub visit_at: String,
    /// Visit type.
    #[serde(rename = "type")]
    pub visit_type: String,
}

/// `today_get_overview` request (VIS-005).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodayOverviewRequest {
    /// The "today" date (RFC3339 date or instant) the UI anchors on.
    pub today: String,
}

/// `today_get_overview` response (VIS-005) — the default home screen.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodayOverviewResponse {
    /// Patients due for follow-up today.
    pub due_today: Vec<TodayPatientRow>,
    /// Patients whose follow-up is overdue.
    pub overdue: Vec<TodayPatientRow>,
    /// Visits registered today.
    pub registered_today: Vec<TodayVisitRow>,
    /// Backup-stale warning banner text, or `None` (no patient data).
    pub backup_warning: Option<String>,
    /// Licence-reminder banner text, or `None`.
    pub licence_reminder: Option<String>,
}

// ---------------------------------------------------------------------------
// Send-to-repertory STUB (CASE-006, R7) — flagged unavailable, no dead end.
// ---------------------------------------------------------------------------

/// `rubric_search_prefill` request (CASE-006). Carried for a stable binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RubricSearchPrefillRequest {
    /// The visit the symptom text came from.
    pub visit_id: String,
    /// The selected symptom text to pre-fill the rubric search with.
    pub source_text: String,
}

/// `rubric_search_prefill` response (CASE-006, R7 stub). `available = false`
/// until the repertory engine lands (R7); registered now so the UI binds a
/// stable command and sees no dead end (R-DEL-002).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RubricSearchPrefillResponse {
    /// Always `false` this slice — the feature is not built yet (R7).
    pub available: bool,
}

// ---------------------------------------------------------------------------
// Service.
// ---------------------------------------------------------------------------

/// Visit + case-template use-case service. Holds the injected [`Clock`]; the
/// open [`Pool`] is passed per call (sealed DB ⇒ the command maps `NotFound`).
pub struct VisitService<'a> {
    clock: &'a dyn Clock,
}

impl<'a> VisitService<'a> {
    /// Build the service over the injected clock.
    pub fn new(clock: &'a dyn Clock) -> Self {
        VisitService { clock }
    }

    /// Return the default case template (CASE-004).
    pub fn template_get_default(&self, pool: &Pool) -> Result<DefaultTemplateResponse, AppError> {
        pool.with_reader(|conn| {
            let t = tpl_repo::get_default_template(conn)?;
            Ok(DefaultTemplateResponse {
                template_id: t.id,
                name: t.name,
                schema_json: t.schema_json,
            })
        })
        .map_err(AppError::from)
    }

    /// List all case templates (CASE-004).
    pub fn template_list(&self, pool: &Pool) -> Result<TemplateListResponse, AppError> {
        pool.with_reader(|conn| {
            let rows = tpl_repo::list_templates(conn)?;
            Ok(TemplateListResponse {
                templates: rows
                    .into_iter()
                    .map(|t| TemplateSummary {
                        id: t.id,
                        name: t.name,
                        is_default: t.is_default,
                    })
                    .collect(),
            })
        })
        .map_err(AppError::from)
    }

    /// Open the patient's current same-day detailed visit, or create a new one
    /// of `visit_type` with the default template (VIS-001). One txn, one audit
    /// row, denormalise patient (first persist).
    pub fn open_or_create(
        &self,
        pool: &Pool,
        req: OpenOrCreateRequest,
    ) -> Result<OpenOrCreateResponse, AppError> {
        validate_visit_type(&req.visit_type)?;
        let now = self.clock.now_rfc3339();
        let today = date_part(&now);

        // If a latest non-deleted visit for this patient was registered today
        // AND is the same type, reuse it (the doctor re-opened the case form).
        let existing =
            pool.with_reader(|conn| visit_repo::latest_visit_for_patient(conn, &req.patient_id))?;
        if let Some(v) = existing {
            if date_part(&v.visit_at) == today && v.visit_type == req.visit_type {
                return Ok(OpenOrCreateResponse {
                    visit_id: v.id,
                    template_id: v
                        .template_id
                        .unwrap_or_else(|| tpl_repo::CHRONIC_DETAILED_ID.to_string()),
                    data_json: v.data_json.unwrap_or_else(|| "{}".to_string()),
                    vitals_json: v.vitals_json.unwrap_or_else(|| "{}".to_string()),
                    visit_at: v.visit_at,
                });
            }
        }

        let template_id = tpl_repo::CHRONIC_DETAILED_ID.to_string();
        let visit_id = uuid::Uuid::now_v7().to_string();
        let row = VisitRow {
            id: visit_id.clone(),
            patient_id: req.patient_id.clone(),
            visit_at: now.clone(),
            visit_type: req.visit_type.clone(),
            template_id: Some(template_id.clone()),
            data_json: Some("{}".to_string()),
            vitals_json: Some("{}".to_string()),
            ..Default::default()
        };

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            visit_repo::insert_visit(&tx, &row, &now)?;
            visit_repo::denormalise_patient_after_visit(&tx, &req.patient_id, &now, &now, true)?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "visit",
                    entity_id: &visit_id,
                    action: AuditAction::Create,
                    diff: json!({ "type": {"new": req.visit_type} }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        Ok(OpenOrCreateResponse {
            visit_id,
            template_id,
            data_json: "{}".to_string(),
            vitals_json: "{}".to_string(),
            visit_at: now,
        })
    }

    /// Autosave the case form + vitals, recomputing BMI (CASE-005). One txn,
    /// one audit row; `visit_fts` updated by trigger (findable immediately);
    /// `patient.last_visit_at` refreshed (D5).
    pub fn case_autosave(
        &self,
        pool: &Pool,
        req: CaseAutosaveRequest,
    ) -> Result<AutosaveResponse, AppError> {
        let now = self.clock.now_rfc3339();
        let vitals_json = recompute_bmi(&req.vitals_json);

        let existing = pool
            .with_reader(|conn| visit_repo::get_visit(conn, &req.visit_id))?
            .ok_or(AppError::NotFound)?;

        let row = VisitRow {
            data_json: Some(req.data_json),
            vitals_json: Some(vitals_json),
            ..existing
        };

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            visit_repo::update_visit_autosave(&tx, &row, &now)?;
            visit_repo::denormalise_patient_after_visit(
                &tx,
                &row.patient_id,
                &row.visit_at,
                &now,
                false,
            )?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "visit",
                    entity_id: &row.id,
                    action: AuditAction::Update,
                    diff: json!({ "autosave": {"new": "case"} }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        Ok(AutosaveResponse { saved_at: now })
    }

    /// Render the read-only case summary HTML (CASE-009). Read-only; non-empty;
    /// contains the case field values from `data_json`.
    pub fn summary_render(
        &self,
        pool: &Pool,
        req: SummaryRenderRequest,
    ) -> Result<SummaryRenderResponse, AppError> {
        let v = pool
            .with_reader(|conn| visit_repo::get_visit(conn, &req.visit_id))?
            .ok_or(AppError::NotFound)?;
        let html = render_case_summary(&v);
        Ok(SummaryRenderResponse { html })
    }

    /// Create a follow-up visit, pre-loading the previous visit's complaints
    /// (VIS-002). One txn, one audit row, denormalise patient.
    pub fn create_followup(
        &self,
        pool: &Pool,
        req: CreateFollowupRequest,
    ) -> Result<CreateFollowupResponse, AppError> {
        let now = self.clock.now_rfc3339();
        let prev = pool
            .with_reader(|conn| visit_repo::get_visit(conn, &req.prev_visit_id))?
            .ok_or(AppError::NotFound)?;
        let prev_complaints = extract_complaints(prev.data_json.as_deref());

        let visit_id = uuid::Uuid::now_v7().to_string();
        let row = VisitRow {
            id: visit_id.clone(),
            patient_id: req.patient_id.clone(),
            visit_at: now.clone(),
            visit_type: "follow_up".to_string(),
            ..Default::default()
        };

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            visit_repo::insert_visit(&tx, &row, &now)?;
            visit_repo::denormalise_patient_after_visit(&tx, &req.patient_id, &now, &now, true)?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "visit",
                    entity_id: &visit_id,
                    action: AuditAction::Create,
                    diff: json!({ "type": {"new": "follow_up"} }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        Ok(CreateFollowupResponse {
            visit_id,
            visit_at: now,
            prev_complaints,
        })
    }

    /// Autosave the follow-up fields (VIS-002/003). One txn, one audit row.
    pub fn followup_autosave(
        &self,
        pool: &Pool,
        req: FollowupAutosaveRequest,
    ) -> Result<AutosaveResponse, AppError> {
        validate_visit_type(&req.visit_type)?;
        if let Some(rr) = req.remedy_response.as_deref() {
            validate_remedy_response(rr)?;
        }
        let now = self.clock.now_rfc3339();
        let vitals_json = recompute_bmi(&req.vitals_json);

        let existing = pool
            .with_reader(|conn| visit_repo::get_visit(conn, &req.visit_id))?
            .ok_or(AppError::NotFound)?;

        let row = VisitRow {
            visit_type: req.visit_type,
            complaint_status_json: Some(req.complaint_status_json),
            improvement_pct_json: Some(req.improvement_pct_json),
            remedy_response: req.remedy_response,
            vitals_json: Some(vitals_json),
            observations: Some(req.observations),
            ..existing
        };

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            visit_repo::update_visit_autosave(&tx, &row, &now)?;
            visit_repo::denormalise_patient_after_visit(
                &tx,
                &row.patient_id,
                &row.visit_at,
                &now,
                false,
            )?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "visit",
                    entity_id: &row.id,
                    action: AuditAction::Update,
                    diff: json!({ "autosave": {"new": "followup"} }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        Ok(AutosaveResponse { saved_at: now })
    }

    /// Set the visit's next follow-up date AND the patient's, in one txn + one
    /// audit row (VIS-004 / D6), so Today needs no join.
    pub fn set_next_followup(
        &self,
        pool: &Pool,
        req: SetNextFollowupRequest,
    ) -> Result<OkResponse, AppError> {
        let now = self.clock.now_rfc3339();
        let visit = pool
            .with_reader(|conn| visit_repo::get_visit(conn, &req.visit_id))?
            .ok_or(AppError::NotFound)?;
        let on = req.next_followup_on.as_deref();

        pool.with_writer(|c| {
            let tx = c.transaction()?;
            visit_repo::set_next_followup(&tx, &req.visit_id, on, &now)?;
            visit_repo::set_patient_next_followup(&tx, &visit.patient_id, on, &now)?;
            write_audit(
                &tx,
                &AuditEntry {
                    user_id: None,
                    entity: "visit",
                    entity_id: &req.visit_id,
                    action: AuditAction::Update,
                    diff: json!({ "next_followup_on": {"new": on} }),
                },
                &now,
            )?;
            tx.commit()?;
            Ok(())
        })?;

        Ok(OkResponse { ok: true })
    }

    /// The Today overview: due-today / overdue / registered-today, bounded
    /// (R-DATA-007), reading denormalised patient columns (no join, D6).
    pub fn today_overview(
        &self,
        pool: &Pool,
        req: TodayOverviewRequest,
    ) -> Result<TodayOverviewResponse, AppError> {
        let today = date_part(&req.today);
        pool.with_reader(|conn| {
            let due = visit_repo::due_today(conn, &today, TODAY_LIMIT)?
                .into_iter()
                .map(today_patient_row)
                .collect();
            let over = visit_repo::overdue(conn, &today, TODAY_LIMIT)?
                .into_iter()
                .map(today_patient_row)
                .collect();
            let reg = visit_repo::registered_today(conn, &today, TODAY_LIMIT)?
                .into_iter()
                .map(|r| TodayVisitRow {
                    patient_id: r.patient_id,
                    code: r.code,
                    name: r.name,
                    photo_path: r.photo_path,
                    visit_at: r.visit_at,
                    visit_type: r.visit_type,
                })
                .collect();
            Ok(TodayOverviewResponse {
                due_today: due,
                overdue: over,
                registered_today: reg,
                // Backup/licence banners are read from existing M1 state by the
                // shell; omitted here (None) rather than fabricated (R-DEL-002).
                backup_warning: None,
                licence_reminder: None,
            })
        })
        .map_err(AppError::from)
    }

    /// Send-to-repertory STUB (CASE-006, R7): always unavailable this slice, no
    /// dead end (R-DEL-002). Reads nothing; writes nothing.
    pub fn rubric_search_prefill(
        &self,
        _pool: &Pool,
        _req: RubricSearchPrefillRequest,
    ) -> Result<RubricSearchPrefillResponse, AppError> {
        Ok(RubricSearchPrefillResponse { available: false })
    }
}

// ---------------------------------------------------------------------------
// Pure helpers (no IO).
// ---------------------------------------------------------------------------

/// Accepted visit types (VIS-001).
const VISIT_TYPES: [&str; 4] = ["first", "follow_up", "acute", "tele"];

/// Accepted remedy-response quick-pick values (VIS-003).
const REMEDY_RESPONSES: [&str; 6] = [
    "amelioration",
    "aggravation_then_amelioration",
    "no_change",
    "aggravation",
    "new_symptoms",
    "old_symptoms_returned",
];

/// Reject an unknown visit type at the service boundary (maps to Validation).
fn validate_visit_type(t: &str) -> Result<(), AppError> {
    if VISIT_TYPES.contains(&t) {
        Ok(())
    } else {
        Err(AppError::Validation(hc_domain::error::DomainError::Invalid))
    }
}

/// Reject an unknown remedy-response value (maps to Validation).
fn validate_remedy_response(r: &str) -> Result<(), AppError> {
    if REMEDY_RESPONSES.contains(&r) {
        Ok(())
    } else {
        Err(AppError::Validation(hc_domain::error::DomainError::Invalid))
    }
}

/// The date part (`YYYY-MM-DD`) of an RFC3339 date or instant. If the input is
/// shorter than 10 chars it is returned as-is (SQL `date()` tolerates it).
fn date_part(s: &str) -> String {
    if s.len() >= 10 {
        s[..10].to_string()
    } else {
        s.to_string()
    }
}

/// Recompute BMI into a vitals JSON object from its `weightKg`/`heightCm`
/// fields via the pure [`hc_domain::vitals::bmi`] (D4), returning the updated
/// JSON string. A non-object or unparseable input is returned unchanged.
fn recompute_bmi(vitals_json: &str) -> String {
    let mut v: Value = match serde_json::from_str(vitals_json) {
        Ok(v) => v,
        Err(_) => return vitals_json.to_string(),
    };
    let Some(obj) = v.as_object_mut() else {
        return vitals_json.to_string();
    };
    let weight = obj.get("weightKg").and_then(Value::as_f64);
    let height = obj.get("heightCm").and_then(Value::as_f64);
    match hc_domain::vitals::bmi(weight, height) {
        Some(bmi) => {
            obj.insert("bmi".to_string(), json!(bmi));
        }
        None => {
            obj.remove("bmi");
        }
    }
    serde_json::to_string(&v).unwrap_or_else(|_| vitals_json.to_string())
}

/// Extract the chief complaints from a visit's `data_json` for follow-up
/// pre-load (VIS-002). Reads `data_json.chief_complaints` as either a single
/// object or an array of objects; each becomes a [`PrevComplaint`] with `key`,
/// `text` (sensation) and `location`. Returns an empty list when absent.
fn extract_complaints(data_json: Option<&str>) -> Vec<PrevComplaint> {
    let Some(raw) = data_json else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    let Some(cc) = v.get("chief_complaints") else {
        return Vec::new();
    };
    let items: Vec<&Value> = match cc {
        Value::Array(a) => a.iter().collect(),
        other => vec![other],
    };
    items
        .into_iter()
        .enumerate()
        .filter_map(|(i, c)| {
            let obj = c.as_object()?;
            let text = obj
                .get("sensation")
                .and_then(Value::as_str)
                .or_else(|| obj.get("text").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            let location = obj
                .get("location")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let key = obj
                .get("key")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("complaint_{i}"));
            Some(PrevComplaint {
                key,
                text,
                location,
            })
        })
        .collect()
}

/// Render a read-only case-summary HTML view from a visit (CASE-009). Escapes
/// the stored values; includes the case field values from `data_json` so the
/// summary is non-empty and reflects the case (the test asserts a known value
/// is present). No DB write, no patient data leaves the PC.
fn render_case_summary(v: &VisitRow) -> String {
    let mut body = String::new();
    body.push_str("<section class=\"case-summary\">");
    body.push_str(&format!(
        "<h1>Case summary</h1><p class=\"visit-at\">{}</p>",
        html_escape(&v.visit_at)
    ));

    if let Some(data) = v.data_json.as_deref() {
        if let Ok(Value::Object(map)) = serde_json::from_str::<Value>(data) {
            for (section, fields) in &map {
                body.push_str(&format!("<h2>{}</h2>", html_escape(section)));
                render_value_html(fields, &mut body);
            }
        }
    }
    if let Some(obs) = v.observations.as_deref() {
        if !obs.is_empty() {
            body.push_str(&format!("<h2>Observations</h2><p>{}</p>", html_escape(obs)));
        }
    }
    body.push_str("</section>");
    body
}

/// Render a JSON value as simple HTML text/list for the case summary.
fn render_value_html(v: &Value, out: &mut String) {
    match v {
        Value::Object(map) => {
            out.push_str("<dl>");
            for (k, val) in map {
                out.push_str(&format!("<dt>{}</dt><dd>", html_escape(k)));
                render_value_html(val, out);
                out.push_str("</dd>");
            }
            out.push_str("</dl>");
        }
        Value::Array(items) => {
            out.push_str("<ul>");
            for item in items {
                out.push_str("<li>");
                render_value_html(item, out);
                out.push_str("</li>");
            }
            out.push_str("</ul>");
        }
        Value::String(s) => out.push_str(&html_escape(s)),
        Value::Null => {}
        other => out.push_str(&html_escape(&other.to_string())),
    }
}

/// Minimal HTML escape for the case-summary render (defence in depth; the
/// summary is shown in the trusted webview but we never emit raw markup).
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Build a doctor-facing age label from dob / age_years (best-effort; the UI
/// may refine). Empty when neither is known.
fn age_label(dob: Option<&str>, age_years: Option<i64>) -> String {
    if let Some(a) = age_years {
        return format!("{a} y");
    }
    if let Some(d) = dob {
        // Year-only heuristic; the UI computes precisely. Non-fatal if absent.
        if d.len() >= 4 {
            return format!("DOB {}", &d[..4]);
        }
    }
    String::new()
}

/// Map a storage Today patient row to the command row, filling the age label
/// and the honest `dues_paise = 0` (billing not built at R3, R-DEL-002).
fn today_patient_row(r: visit_repo::TodayPatientRow) -> TodayPatientRow {
    let age_label = age_label(r.dob.as_deref(), r.age_years);
    TodayPatientRow {
        patient_id: r.patient_id,
        code: r.code,
        name: r.name,
        age_label,
        sex: r.sex,
        photo_path: r.photo_path,
        next_followup_on: r.next_followup_on,
        dues_paise: 0,
    }
}
