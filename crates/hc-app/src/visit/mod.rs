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

/// `case_template_set_visibility` request (CASE-002) — hide/show one section
/// for the doctor (persists as their template).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SetVisibilityRequest {
    /// The template section key to toggle (e.g. `"mental_generals"`).
    pub section_key: String,
    /// `true` hides the section for this doctor; `false` shows it again.
    pub hidden: bool,
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
    /// The scheduled next follow-up date for the header (VIS-004), or `None`
    /// when none is set. Additive read field (M3-RW A4).
    pub next_followup_on: Option<String>,
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
    /// The previously scheduled next follow-up date for the header (VIS-004),
    /// or `None`. Additive read field (M3-RW A4).
    pub next_followup_on: Option<String>,
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

/// `visit_has_saved_first_case` request (M3-RW A5) — first-case gating signal.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HasSavedFirstCaseRequest {
    /// The patient whose first-case state is queried.
    pub patient_id: String,
}

/// `visit_has_saved_first_case` response (M3-RW A5).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct HasSavedFirstCaseResponse {
    /// True once a non-deleted `first`-type visit exists, so the UI can grey
    /// out starting another first case.
    pub has_saved_first_case: bool,
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
    /// Outstanding dues in paise (the running patient balance, R5).
    #[specta(type = specta_typescript::Number)]
    pub dues_paise: i64,
}

/// A Today-list registered-visit row (today's registered visits).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TodayVisitRow {
    /// R5: the visit id (Bill button target).
    pub visit_id: String,
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
    /// R5: the visit's live bill, or `None`.
    pub bill: Option<crate::billing::VisitBill>,
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

    /// Hide or show a template section for the doctor; the choice persists as
    /// their template (CASE-002). One txn, one audit row (R-DATA-001). No
    /// patient data is read or written.
    pub fn template_set_visibility(
        &self,
        pool: &Pool,
        req: SetVisibilityRequest,
    ) -> Result<OkResponse, AppError> {
        let now = self.clock.now_rfc3339();
        pool.with_writer(|c| {
            let tx = c.transaction()?;
            tpl_repo::set_section_visibility(&tx, &req.section_key, req.hidden, &now)?;
            tx.commit()?;
            Ok(())
        })?;
        Ok(OkResponse { ok: true })
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
        // The latest prior visit is ALSO the one a follow-up carries its journal
        // forward from (ADR 0018 #2 / VIS-002), so keep it after the reuse check.
        let existing =
            pool.with_reader(|conn| visit_repo::latest_visit_for_patient(conn, &req.patient_id))?;
        if let Some(v) = existing.as_ref() {
            if date_part(&v.visit_at) == today && v.visit_type == req.visit_type {
                return Ok(OpenOrCreateResponse {
                    visit_id: v.id.clone(),
                    template_id: v
                        .template_id
                        .clone()
                        .unwrap_or_else(|| tpl_repo::CHRONIC_DETAILED_ID.to_string()),
                    data_json: v.data_json.clone().unwrap_or_else(|| "{}".to_string()),
                    vitals_json: v.vitals_json.clone().unwrap_or_else(|| "{}".to_string()),
                    visit_at: v.visit_at.clone(),
                    next_followup_on: v.next_followup_on.clone(),
                });
            }
        }

        let template_id = tpl_repo::CHRONIC_DETAILED_ID.to_string();
        let visit_id = uuid::Uuid::now_v7().to_string();
        // A follow-up REUSES the journal (ADR 0018 #2 / S09-delta): the new
        // follow-up visit opens with the prior visit's complaint boxes carried
        // forward and a NEW empty dated entry appended to each, so the box
        // pre-opens with prior content and the prior complaints pre-load
        // (VIS-002). A first/acute/tele visit starts with an empty document.
        // `data_json` stays opaque TEXT (ADR 0007); this only chooses its seed.
        let data_json = if req.visit_type == "follow_up" {
            seed_followup_data_json(existing.as_ref(), &visit_id, &today)
        } else {
            "{}".to_string()
        };
        let row = VisitRow {
            id: visit_id.clone(),
            patient_id: req.patient_id.clone(),
            visit_at: now.clone(),
            visit_type: req.visit_type.clone(),
            template_id: Some(template_id.clone()),
            data_json: Some(data_json.clone()),
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
            data_json,
            vitals_json: "{}".to_string(),
            visit_at: now,
            // A brand-new visit has no next follow-up scheduled yet (A4).
            next_followup_on: None,
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
        // Carry the previously scheduled next follow-up to the header (A4).
        let prev_next_followup_on = prev.next_followup_on.clone();

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
            next_followup_on: prev_next_followup_on,
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

    /// True when a non-deleted `first`-type visit exists for the patient
    /// (M3-RW A5). The UI uses this to grey out "New visit / first case" after
    /// the first case is saved so a second first case cannot be started; a
    /// soft-deleted first case does not count. Read-only; no audit row; reads
    /// no patient name/dob (R-PRIV-001).
    pub fn has_saved_first_case(&self, pool: &Pool, patient_id: &str) -> Result<bool, AppError> {
        pool.with_reader(|conn| visit_repo::has_saved_first_case(conn, patient_id))
            .map_err(AppError::from)
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
            let reg_rows = visit_repo::registered_today(conn, &today, TODAY_LIMIT)?;
            let ids: Vec<String> = reg_rows.iter().map(|r| r.visit_id.clone()).collect();
            let bills = hc_storage::billing::live_invoices_for_visits(conn, &ids)?;
            let reg = reg_rows
                .into_iter()
                .map(|r| TodayVisitRow {
                    bill: crate::billing::visit_bill_for(&bills, &r.visit_id),
                    visit_id: r.visit_id,
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
/// pre-load (VIS-002).
///
/// The document is opaque to storage (ADR 0007); two shapes are understood:
/// - **Doctor-journal (ADR 0018, `schema == "case-journal"`)**: the complaints
///   live at the top level as `complaints[]`, each `{ id, title, entries[] }`.
///   The `title` is the complaint label (`text`) and the id becomes the `key`;
///   the location is unused by the journal model so it is empty. A follow-up on
///   a journal first case therefore pre-loads the prior complaint titles.
/// - **Legacy R3 structured**: `data_json.chief_complaints` as either a single
///   object or an array of objects (`sensation`/`text` + `location`). Retained
///   so follow-ups on old structured visits still pre-load.
///
/// Returns an empty list when absent or unparseable. No patient text is logged
/// (R-PRIV-001).
fn extract_complaints(data_json: Option<&str>) -> Vec<PrevComplaint> {
    let Some(raw) = data_json else {
        return Vec::new();
    };
    let Ok(v) = serde_json::from_str::<Value>(raw) else {
        return Vec::new();
    };
    // Doctor-journal document: read the top-level `complaints[]` (ADR 0018).
    if v.get("schema").and_then(Value::as_str) == Some("case-journal") {
        return extract_journal_complaints(&v);
    }
    // Legacy R3 structured document: read `data_json.chief_complaints`.
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

/// Pre-load the complaints from a doctor-journal document (ADR 0018): each
/// top-level `complaints[]` entry contributes its `id` as the key and its
/// `title` as the text. Untitled complaints keep an empty text (the follow-up
/// still carries the box forward). Location is empty — the journal has none.
fn extract_journal_complaints(v: &Value) -> Vec<PrevComplaint> {
    let Some(complaints) = v.get("complaints").and_then(Value::as_array) else {
        return Vec::new();
    };
    complaints
        .iter()
        .enumerate()
        .filter_map(|(i, c)| {
            let obj = c.as_object()?;
            let key = obj
                .get("id")
                .and_then(Value::as_str)
                .map(|s| s.to_string())
                .unwrap_or_else(|| format!("cc{}", i + 1));
            let text = obj
                .get("title")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            Some(PrevComplaint {
                key,
                text,
                location: String::new(),
            })
        })
        .collect()
}

/// Seed a new follow-up visit's `data_json` by carrying the prior visit's
/// doctor-journal forward (ADR 0018 #2 / S09-delta): every prior complaint box
/// is kept with its title and its prior dated entries, and a NEW empty dated
/// entry (today, this follow-up's id) is appended to each so the box pre-opens
/// with prior content and "Add entry" semantics are preserved. The prior
/// top-level `sections` object (family history, physical generals,
/// investigations, mental generals, ...) is ALSO carried forward verbatim so a
/// follow-up never drops the side-section data (B7); it is absent when the
/// prior had no parseable `sections`.
///
/// The prior document is opaque; this only understands the journal shape. When
/// the prior visit is a legacy R3 structured document (no `schema ==
/// "case-journal"`), its complaints are carried forward as journal complaint
/// boxes (title from the structured sensation/location) so a follow-up on an
/// old case still pre-opens. When there is no prior visit, no prior complaints,
/// or the prior document is unparseable, the follow-up starts with a single
/// empty complaint box holding one empty dated entry.
///
/// M3-RWv2 reconciliation (v3 `case-rich`, ADR 0019 #10 / serialization-v3
/// §9b): when the prior document is a v3 `case-rich` document the WHOLE prior
/// ProseMirror document is copied forward instead of the v2 journal shape —
/// each prior `complaint` object (id, title, `doc`, `next_section_no`) is kept
/// verbatim and a NEW dated-entry heading node plus an empty paragraph is
/// APPENDED to each `doc.content`, carrying the top-level `next_section_no` and
/// (transitionally) `sections` forward. This fixes the reported follow-up
/// data-loss: prior prose AND prior numbered sections (INCLUDING family
/// history) persist because they are part of the copied `doc`. The backend
/// stays opaque — it only appends to the `doc.content` array and copies objects
/// wholesale; it inspects/reads/logs no clinical node (R-PRIV-001). The v2 /
/// legacy branch is retained for in-flight migration (a v2 prior still seeds a
/// v2 follow-up, which the UI upcasts to v3 on open).
fn seed_followup_data_json(prev: Option<&VisitRow>, visit_id: &str, today: &str) -> String {
    // v3 `case-rich` prior -> copy the whole document(s) forward (§9b).
    if let Some(rich) = prev
        .and_then(|v| v.data_json.as_deref())
        .and_then(|raw| seed_followup_case_rich(raw, visit_id, today))
    {
        return rich;
    }

    let complaints = prev
        .and_then(|v| v.data_json.as_deref())
        .map(prior_journal_complaints)
        .unwrap_or_default();

    // B7: carry the prior visit's ENTIRE top-level `sections` object forward
    // verbatim (family history, physical generals, investigations, mental
    // generals, ...). Previously the seed rebuilt the document with only
    // `complaints` and dropped `sections`, so every follow-up silently lost the
    // side-section data. Absent when the prior had no (parseable) `sections`;
    // the UI's read-time upcast then fills a typed empty object — we never
    // fabricate one here.
    let prior_sections = prev
        .and_then(|v| v.data_json.as_deref())
        .and_then(prior_journal_sections);

    let entries_with_new = |title_id: (String, String), prior_entries: Vec<Value>| -> Value {
        let (id, title) = title_id;
        let mut entries = prior_entries;
        entries.push(json!({
            "entry_date": today,
            "visit_id": visit_id,
            "blocks": [],
        }));
        json!({ "id": id, "title": title, "entries": entries })
    };

    let seeded: Vec<Value> = if complaints.is_empty() {
        vec![entries_with_new(
            ("cc1".to_string(), String::new()),
            Vec::new(),
        )]
    } else {
        complaints
            .into_iter()
            .map(|(id, title, prior_entries)| entries_with_new((id, title), prior_entries))
            .collect()
    };

    let mut doc = json!({
        "schema": "case-journal",
        "version": 2,
        "complaints": seeded,
    });
    if let Some(sections) = prior_sections {
        // Carry the prior `sections` object forward verbatim. `doc` is built
        // from a `json!` object literal above, so it is always an object.
        if let Some(obj) = doc.as_object_mut() {
            obj.insert("sections".to_string(), sections);
        }
    }
    doc.to_string()
}

/// Seed a follow-up from a v3 `case-rich` prior document by copying the WHOLE
/// prior ProseMirror document(s) forward and APPENDING a new dated entry to
/// each complaint's `doc.content` (ADR 0019 #10 / serialization-v3 §9b).
///
/// Returns `Some(serialised_v3)` only when `data_json` parses and is a
/// `schema == "case-rich"` document with a `complaints` array; `None` for any
/// other shape (v2 journal, legacy R3, unparseable) so the caller falls back to
/// the retained v2/legacy seed path.
///
/// Opaque-safe: each prior `complaint` object (id, title, `doc`,
/// `next_section_no`) is copied VERBATIM; the only mutation is pushing a fresh
/// dated-entry heading node and an empty paragraph onto the opaque
/// `doc.content` array. No existing clinical node is read, inspected or logged
/// (R-PRIV-001); the top-level `next_section_no` and (transitionally)
/// `sections` are carried forward unchanged. The result is one opaque
/// `data_json` string the caller writes in ONE `UPDATE visit` with ONE audit
/// row (R-DATA-001 preserved — this only chooses the seed).
fn seed_followup_case_rich(data_json: &str, visit_id: &str, today: &str) -> Option<String> {
    let v = serde_json::from_str::<Value>(data_json).ok()?;
    if v.get("schema").and_then(Value::as_str) != Some("case-rich") {
        return None;
    }
    let complaints = v.get("complaints").and_then(Value::as_array)?;

    // The new dated-entry heading node + an empty paragraph appended to each
    // complaint's `doc.content`. Built from a literal (no clinical node read).
    let new_entry_heading = json!({
        "type": "heading",
        "attrs": {
            "level": 2,
            "hcKind": "entry",
            "hcDate": today,
            "hcVisitId": visit_id,
        },
        "content": [ { "type": "text", "text": display_date(today) } ],
    });
    let empty_paragraph = json!({ "type": "paragraph" });

    let seeded: Vec<Value> = complaints
        .iter()
        .map(|complaint| {
            // Copy the complaint object verbatim, then append to its doc.content.
            let mut c = complaint.clone();
            if let Some(content) = c
                .get_mut("doc")
                .and_then(|d| d.get_mut("content"))
                .and_then(Value::as_array_mut)
            {
                content.push(new_entry_heading.clone());
                content.push(empty_paragraph.clone());
            }
            c
        })
        .collect();

    let mut out = json!({
        "schema": "case-rich",
        "version": 3,
        "complaints": seeded,
    });
    let obj = out.as_object_mut()?;
    // Carry the top-level running counter forward so numbering never resets.
    if let Some(next_no) = v.get("next_section_no") {
        obj.insert("next_section_no".to_string(), next_no.clone());
    }
    // Carry `sections` forward verbatim if present (transitional; §6).
    if let Some(sections) = v.get("sections") {
        obj.insert("sections".to_string(), sections.clone());
    }
    Some(out.to_string())
}

/// Format a `YYYY-MM-DD` calendar date as `DD-MM-YYYY` for an entry heading's
/// display text (R-UI-006). Falls back to the input when it is not a 10-char
/// ISO date; no patient data is involved (a date only).
fn display_date(date: &str) -> String {
    if date.len() >= 10 && date.as_bytes()[4] == b'-' && date.as_bytes()[7] == b'-' {
        let (y, rest) = date.split_at(4);
        let (m, d) = (&rest[1..3], &rest[4..6]);
        format!("{d}-{m}-{y}")
    } else {
        date.to_string()
    }
}

/// Read the prior visit's top-level `sections` object verbatim from a v2
/// case-journal `data_json`, for carrying forward into a seeded follow-up (B7).
/// Returns `Some(sections)` only when the prior document is a v2 case-journal
/// whose top-level `sections` is a JSON object; `None` for a legacy/structured
/// prior, an unparseable document, or an absent/non-object `sections` (the UI
/// upcast then fills a typed empty object — we never fabricate one here). The
/// document is opaque; no field is inspected, so no patient data is read or
/// logged — the object is copied wholesale.
fn prior_journal_sections(data_json: &str) -> Option<Value> {
    let v = serde_json::from_str::<Value>(data_json).ok()?;
    if v.get("schema").and_then(Value::as_str) != Some("case-journal") {
        return None;
    }
    match v.get("sections") {
        Some(sections @ Value::Object(_)) => Some(sections.clone()),
        _ => None,
    }
}

/// Read the prior visit's journal complaints as `(id, title, prior_entries)`
/// triples. A journal document yields its `complaints[]` verbatim (id, title,
/// entries carried forward). A legacy R3 document yields one complaint per
/// `chief_complaints[]` entry with an empty prior-entries list (the old
/// structured body is not re-materialised here; the UI's read-time upcast
/// still handles an old visit opened directly). Empty on absence/parse error.
fn prior_journal_complaints(data_json: &str) -> Vec<(String, String, Vec<Value>)> {
    let Ok(v) = serde_json::from_str::<Value>(data_json) else {
        return Vec::new();
    };
    if v.get("schema").and_then(Value::as_str) == Some("case-journal") {
        let Some(complaints) = v.get("complaints").and_then(Value::as_array) else {
            return Vec::new();
        };
        return complaints
            .iter()
            .enumerate()
            .filter_map(|(i, c)| {
                let obj = c.as_object()?;
                let id = obj
                    .get("id")
                    .and_then(Value::as_str)
                    .map(|s| s.to_string())
                    .unwrap_or_else(|| format!("cc{}", i + 1));
                let title = obj
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                let prior_entries = obj
                    .get("entries")
                    .and_then(Value::as_array)
                    .cloned()
                    .unwrap_or_default();
                Some((id, title, prior_entries))
            })
            .collect();
    }
    // Legacy structured prior visit: carry titles forward as fresh boxes.
    extract_complaints(Some(data_json))
        .into_iter()
        .enumerate()
        .map(|(i, pc)| {
            let title = if pc.location.is_empty() {
                pc.text
            } else if pc.text.is_empty() {
                pc.location
            } else {
                format!("{} ({})", pc.text, pc.location)
            };
            (format!("cc{}", i + 1), title, Vec::new())
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
/// and the running patient balance as `dues_paise` (R5).
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
        dues_paise: r.balance_paise,
    }
}
