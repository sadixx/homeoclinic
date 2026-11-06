//! R5 billing use-case tests (BILL-001..006, HC-MVP1-148..152; R5 design §6,
//! §7, §9, §13 T-SEQ / T-MONEY / T-DUES / T-AUDIT / T-EDIT / T-UPI).
//!
//! CUT: the REAL `hc_app::billing::BillingService` (plus the REAL
//! `PatientService` / `VisitService` read sites that must show real dues) over
//! a REAL migrated SQLCipher temp DB seeded with one synthetic doctor + clinic
//! (fees Rs 500 first / Rs 300 follow-up). Dependency fakes only
//! (R-TEST-002): a settable test clock. Synthetic data only (R-TEST-004).
//! Every write test asserts data effects + exactly one audit row (R-DATA-001).
//! RED until hc-core-dev / hc-data-dev replace the §13 stub bodies.

use std::sync::Mutex;

use hc_app::billing::{
    BillingService, ClearDuesRequest, ComputeTotalsRequest, DiscountDto, InvoiceGetForVisitRequest,
    InvoiceIdRequest, InvoiceSaveRequest, InvoiceScreen, InvoiceStatus, InvoiceVoidRequest,
    LineDto, PatientIdRequest, PaymentAddRequest, PaymentInput, PaymentVoidRequest, VisitIdRequest,
};
use hc_app::clock::Clock;
use hc_app::error::{map_error, AppError, ErrorCode};
use hc_app::patient::{
    GetDashboardRequest, ListQueryRequest, PatientFilter, PatientService, PatientSort, SortDir,
    SortField,
};
use hc_app::visit::{TodayOverviewRequest, VisitService};
use hc_domain::billing::{BillingError, LineKind, PaymentMode};
use hc_storage::profile::{get_clinic_profile, upsert_clinic_profile};
use hc_storage::testing::{insert_visit_for, seed_patient, seeded_data_dir, temp_file_keystore};
use hc_storage::visit::{self as visit_repo, VisitRow};
use hc_storage::Pool;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/// Settable test clock (R-TEST-006: no wall clock).
struct TestClock(Mutex<String>);
impl TestClock {
    fn at(s: &str) -> Self {
        TestClock(Mutex::new(s.to_string()))
    }
    fn set(&self, s: &str) {
        *self.0.lock().unwrap() = s.to_string();
    }
}
impl Clock for TestClock {
    fn now_rfc3339(&self) -> String {
        self.0.lock().unwrap().clone()
    }
}

const TODAY: &str = "2026-10-16";
const NOW: &str = "2026-10-16T06:00:00Z";

struct Env {
    _dir: tempfile::TempDir,
    pool: Pool,
    clinic_id: String,
    patient: String,
}

fn env() -> Env {
    let (dir, pool, (_doctor, clinic_id)) = seeded_data_dir();
    let patient = seed_patient(&pool, "HC-000001", "Test Patient R5");
    Env {
        _dir: dir,
        pool,
        clinic_id,
        patient,
    }
}

/// A visit of the given type through the real visit repo.
fn visit_of_type(pool: &Pool, patient: &str, visit_at: &str, visit_type: &str) -> String {
    let id = uuid_like(visit_at, visit_type);
    let id_ret = id.clone();
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let row = VisitRow {
            id: id.clone(),
            patient_id: patient.to_string(),
            visit_at: visit_at.to_string(),
            visit_type: visit_type.to_string(),
            observations: Some("synthetic visit".to_string()),
            ..Default::default()
        };
        visit_repo::insert_visit(&tx, &row, visit_at)?;
        visit_repo::denormalise_patient_after_visit(&tx, patient, visit_at, visit_at, true)?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed visit");
    id_ret
}

fn uuid_like(a: &str, b: &str) -> String {
    format!("visit-{b}-{}", a.replace([':', '-'], ""))
}

fn followup_visit(e: &Env) -> String {
    insert_visit_for(&e.pool, &e.patient, "2026-10-16T05:00:00Z", None)
}

fn line(kind: LineKind, desc: &str, qty: u32, rate: i64) -> LineDto {
    LineDto {
        id: None,
        kind,
        description: desc.to_string(),
        qty,
        rate_paise: rate,
    }
}

/// R5 demo lines: consultation Rs 300 + medicine Rs 150.
fn demo_lines() -> Vec<LineDto> {
    vec![
        line(
            LineKind::Consultation,
            "Consultation (follow-up)",
            1,
            30_000,
        ),
        line(LineKind::Medicine, "Test Remedy 30C", 1, 15_000),
    ]
}

fn pay(amount: i64, mode: PaymentMode, paid_on: &str) -> PaymentInput {
    PaymentInput {
        amount_paise: amount,
        mode,
        reference: None,
        paid_on: paid_on.to_string(),
    }
}

fn create_req(
    visit: &str,
    lines: Vec<LineDto>,
    discount: DiscountDto,
    p: Option<PaymentInput>,
) -> InvoiceSaveRequest {
    InvoiceSaveRequest {
        visit_id: visit.to_string(),
        invoice_id: None,
        expected_row_version: None,
        lines,
        discount,
        payment: p,
        local_today: TODAY.to_string(),
    }
}

/// Create the R5 demo bill (Rs 450 at 5% = Rs 427.50, Rs 200 cash).
fn create_demo(svc: &BillingService<'_>, pool: &Pool, visit: &str) -> InvoiceScreen {
    svc.save(
        pool,
        create_req(
            visit,
            demo_lines(),
            DiscountDto::Percent { basis_points: 500 },
            Some(pay(20_000, PaymentMode::Cash, TODAY)),
        ),
    )
    .expect("create demo invoice")
}

fn count(pool: &Pool, sql: &str) -> i64 {
    pool.with_reader(|c| Ok(c.query_row(sql, [], |r| r.get(0))?))
        .expect(sql)
}

fn audits(pool: &Pool) -> i64 {
    count(pool, "SELECT COUNT(*) FROM audit_log")
}

fn last_audit(pool: &Pool) -> (String, String) {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT entity, action FROM audit_log ORDER BY rowid DESC LIMIT 1",
            [],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?)
    })
    .unwrap()
}

fn set_fees(e: &Env, first: i64, followup: i64, gstin: Option<&str>) {
    let mut clinic = e
        .pool
        .with_reader(get_clinic_profile)
        .unwrap()
        .expect("clinic");
    assert_eq!(clinic.id, e.clinic_id);
    clinic.fee_first_paise = first;
    clinic.fee_followup_paise = followup;
    clinic.gstin = gstin.map(str::to_string);
    e.pool
        .with_writer(|c| {
            let tx = c.transaction()?;
            upsert_clinic_profile(&tx, &clinic, NOW)?;
            tx.commit()?;
            Ok(())
        })
        .unwrap();
}

fn set_vpa(e: &Env, vpa: &str) {
    e.pool
        .with_writer(|c| {
            c.execute(
                "INSERT OR REPLACE INTO app_setting (key, value_json) VALUES ('clinic_upi_vpa', ?1)",
                [serde_json::to_string(vpa).unwrap()],
            )?;
            Ok(())
        })
        .expect("store clinic_upi_vpa (app_setting key per design §6.3)");
}

fn assert_code(r: Result<impl std::fmt::Debug, AppError>, want: ErrorCode, why: &str) {
    match r {
        Err(e) => assert_eq!(map_error(&e).code, want, "{why}: got {e:?}"),
        Ok(v) => panic!("{why}: expected {want:?}, got Ok({v:?})"),
    }
}

// ---------------------------------------------------------------------------
// invoice_get_for_visit: proposal (consultation default from clinic fee)
// ---------------------------------------------------------------------------

/// Bug caught: the first-visit bill is prefilled with the follow-up fee (or
/// nothing), so the doctor under-charges.
#[test]
fn get_for_visit_unbilled_first_visit_proposes_the_first_visit_fee() {
    let e = env();
    let v = visit_of_type(&e.pool, &e.patient, "2026-10-16T05:00:00Z", "first");
    let clock = TestClock::at(NOW);
    let s = BillingService::new(&clock)
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: v.clone(),
                local_today: TODAY.into(),
            },
        )
        .expect("get");
    assert!(s.invoice.is_none(), "unbilled");
    assert_eq!(
        s.proposal,
        Some(vec![line(
            LineKind::Consultation,
            "Consultation (first visit)",
            1,
            50_000
        )])
    );
    assert_eq!(s.patient.name, "Test Patient R5");
    assert_eq!(s.patient.code, "HC-000001");
    assert_eq!(s.visit.visit_id, v);
    assert_eq!(s.patient_dues_paise, 0);
    assert!(!s.upi_configured, "no VPA set yet");
    assert_eq!(s.gstin, None);
}

/// Bug caught: a follow-up is charged the first-visit fee.
#[test]
fn get_for_visit_unbilled_followup_proposes_the_followup_fee() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let s = BillingService::new(&clock)
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: v,
                local_today: TODAY.into(),
            },
        )
        .expect("get");
    assert_eq!(
        s.proposal,
        Some(vec![line(
            LineKind::Consultation,
            "Consultation (follow-up)",
            1,
            30_000
        )])
    );
}

/// Bug caught: a Rs 0 fee (free follow-up) is prefilled as a Rs 0 line the
/// doctor must delete; edited Settings fees are not picked up.
#[test]
fn get_for_visit_uses_current_settings_fees_and_skips_a_zero_fee() {
    let e = env();
    set_fees(&e, 70_000, 0, None);
    let first = visit_of_type(&e.pool, &e.patient, "2026-10-16T04:00:00Z", "first");
    let follow = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let a = svc
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: first,
                local_today: TODAY.into(),
            },
        )
        .unwrap();
    assert_eq!(
        a.proposal.unwrap()[0].rate_paise,
        70_000,
        "edited Settings fee"
    );
    let b = svc
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: follow,
                local_today: TODAY.into(),
            },
        )
        .unwrap();
    assert_eq!(b.proposal, Some(vec![]), "fee 0 -> no prefilled line");
}

/// Bug caught: a missing visit opens an empty bill instead of NotFound.
#[test]
fn get_for_visit_unknown_visit_is_not_found() {
    let e = env();
    let clock = TestClock::at(NOW);
    let r = BillingService::new(&clock).get_for_visit(
        &e.pool,
        InvoiceGetForVisitRequest {
            visit_id: "no-such-visit".into(),
            local_today: TODAY.into(),
        },
    );
    assert!(matches!(r, Err(AppError::NotFound)), "got {r:?}");
}

// ---------------------------------------------------------------------------
// invoice_compute_totals (the UI never does money maths)
// ---------------------------------------------------------------------------

/// Bug caught: the live totals the UI shows differ from what Save stores, or
/// an over-cap discount is shown as a negative total instead of an error.
#[test]
fn compute_totals_returns_paise_totals_and_refuses_bad_discounts() {
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let t = svc
        .compute_totals(ComputeTotalsRequest {
            lines: vec![
                line(LineKind::Consultation, "Consultation", 1, 30_000),
                line(LineKind::Medicine, "Test Remedy", 2, 2_500),
            ],
            discount: DiscountDto::Percent { basis_points: 500 },
        })
        .expect("totals");
    assert_eq!(t.line_amounts_paise, vec![30_000, 5_000]);
    assert_eq!(
        (t.subtotal_paise, t.discount_paise, t.total_paise),
        (35_000, 1_750, 33_250)
    );

    let r = svc.compute_totals(ComputeTotalsRequest {
        lines: demo_lines(),
        discount: DiscountDto::Amount { paise: 45_001 },
    });
    assert_code(r, ErrorCode::Validation, "discount > subtotal");
    let neg = svc.compute_totals(ComputeTotalsRequest {
        lines: vec![line(LineKind::Other, "Test", 1, -1)],
        discount: DiscountDto::None,
    });
    assert_code(neg, ErrorCode::Validation, "negative rate");
}

// ---------------------------------------------------------------------------
// invoice_save: create (issue + number + payment in one txn)
// ---------------------------------------------------------------------------

/// Bug caught: the first Save does not issue a numbered bill, stores wrong
/// totals/balance, loses the same-transaction payment, does not update dues,
/// or writes != 1 audit row.
#[test]
fn save_create_issues_numbered_invoice_with_payment_balance_and_one_audit_row() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let before = audits(&e.pool);

    let s = create_demo(&svc, &e.pool, &v);
    let inv = s.invoice.as_ref().expect("issued");
    assert_eq!(inv.number, "2026-27/0001");
    assert_eq!(inv.fy, "2026-27");
    assert_eq!(inv.issued_on, TODAY);
    assert_eq!(inv.status, InvoiceStatus::Issued);
    assert_eq!(inv.totals.line_amounts_paise, vec![30_000, 15_000]);
    assert_eq!(inv.totals.subtotal_paise, 45_000);
    assert_eq!(inv.totals.discount_paise, 2_250);
    assert_eq!(inv.totals.total_paise, 42_750);
    assert_eq!(inv.paid_paise, 20_000);
    assert_eq!(inv.balance_paise, 22_750);
    assert_eq!(inv.discount, DiscountDto::Percent { basis_points: 500 });
    assert!(
        inv.lines.iter().all(|l| l.id.is_some()),
        "saved lines carry ids"
    );
    assert_eq!(inv.lines[1].description, "Test Remedy 30C");
    assert_eq!(inv.payments.len(), 1);
    assert_eq!(inv.payments[0].mode, PaymentMode::Cash);
    assert!(!inv.payments[0].voided);
    assert_eq!(s.proposal, None, "no proposal once billed");
    assert_eq!(s.patient_dues_paise, 22_750);

    assert_eq!(
        audits(&e.pool) - before,
        1,
        "one transaction, one audit row"
    );
    assert_eq!(last_audit(&e.pool), ("invoice".into(), "create".into()));
    assert_eq!(
        count(
            &e.pool,
            "SELECT COUNT(*) FROM invoice_line WHERE deleted_at IS NULL"
        ),
        2
    );
    assert_eq!(count(&e.pool, "SELECT COUNT(*) FROM payment"), 1);

    // Re-open shows the same stored invoice.
    let again = svc
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: v,
                local_today: TODAY.into(),
            },
        )
        .unwrap();
    assert_eq!(again.invoice.unwrap().balance_paise, 22_750);
}

/// Bug caught: an unpaid save stores paid > 0, or a GSTIN set in Settings is
/// not snapshotted onto the bill (BILL-006 "print only when set").
#[test]
fn save_create_without_payment_has_full_balance_and_snapshots_gstin() {
    let e = env();
    set_fees(&e, 50_000, 30_000, Some("27AAAAA0000A1Z5"));
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let s = BillingService::new(&clock)
        .save(
            &e.pool,
            create_req(&v, demo_lines(), DiscountDto::None, None),
        )
        .unwrap();
    let inv = s.invoice.unwrap();
    assert_eq!((inv.paid_paise, inv.balance_paise), (0, 45_000));
    assert!(inv.payments.is_empty());
    assert_eq!(s.gstin.as_deref(), Some("27AAAAA0000A1Z5"));
}

/// Bug caught: receipt numbers skip or repeat across consecutive bills.
#[test]
fn save_create_numbers_bills_sequentially() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let mut numbers = vec![];
    for h in 1..=3 {
        let v = insert_visit_for(
            &e.pool,
            &e.patient,
            &format!("2026-10-16T0{h}:00:00Z"),
            None,
        );
        let s = svc
            .save(
                &e.pool,
                create_req(&v, demo_lines(), DiscountDto::None, None),
            )
            .unwrap();
        numbers.push(s.invoice.unwrap().number);
    }
    assert_eq!(
        numbers,
        vec!["2026-27/0001", "2026-27/0002", "2026-27/0003"]
    );
}

/// Bug caught: the FY is taken from the calendar year or the UTC date, so the
/// 1 April reset happens on the wrong bill (T-SEQ, F5 IST window).
#[test]
fn save_create_resets_numbering_on_1_april_using_the_local_date() {
    let e = env();
    let clock = TestClock::at("2027-03-31T10:00:00Z");
    let svc = BillingService::new(&clock);
    let mk = |at: &str, local: &str| {
        let v = insert_visit_for(&e.pool, &e.patient, at, None);
        let mut r = create_req(&v, demo_lines(), DiscountDto::None, None);
        r.local_today = local.into();
        svc.save(&e.pool, r).expect("save").invoice.unwrap()
    };
    let a = mk("2027-03-31T09:00:00Z", "2027-03-31");
    let b = mk("2027-03-31T09:30:00Z", "2027-03-31");
    assert_eq!(
        (a.number.as_str(), b.number.as_str()),
        ("2026-27/0001", "2026-27/0002")
    );
    assert_eq!(a.fy, "2026-27");

    // 2027-03-31T19:00Z is 2027-04-01 00:30 IST: the clinic's local date wins.
    clock.set("2027-03-31T19:00:00Z");
    let c = mk("2027-03-31T18:59:00Z", "2027-04-01");
    assert_eq!(c.number, "2027-28/0001", "new FY restarts at 0001");
    assert_eq!(c.issued_on, "2027-04-01");

    clock.set("2027-04-01T05:00:00Z");
    let d = mk("2027-04-01T04:00:00Z", "2027-04-01");
    assert_eq!(d.number, "2027-28/0002");
}

/// Bug caught: a save that fails inside the issuing transaction (here: the
/// payment is more than the total) burns a receipt number or leaves rows.
#[test]
fn save_create_failure_rolls_back_and_does_not_consume_a_number() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let v1 = followup_visit(&e);
    let v2 = insert_visit_for(&e.pool, &e.patient, "2026-10-16T05:30:00Z", None);
    let v3 = insert_visit_for(&e.pool, &e.patient, "2026-10-16T05:45:00Z", None);
    svc.save(
        &e.pool,
        create_req(&v1, demo_lines(), DiscountDto::None, None),
    )
    .unwrap();

    let (inv0, aud0) = (
        count(&e.pool, "SELECT COUNT(*) FROM invoice"),
        audits(&e.pool),
    );
    let r = svc.save(
        &e.pool,
        create_req(
            &v2,
            demo_lines(),
            DiscountDto::None,
            Some(pay(45_001, PaymentMode::Cash, TODAY)),
        ),
    );
    assert_code(r, ErrorCode::PaymentExceedsBalance, "overpayment on create");
    assert_eq!(
        count(&e.pool, "SELECT COUNT(*) FROM invoice"),
        inv0,
        "no invoice row"
    );
    assert_eq!(
        count(&e.pool, "SELECT COUNT(*) FROM payment"),
        0,
        "no payment row"
    );
    assert_eq!(audits(&e.pool), aud0, "no audit row");

    let next = svc
        .save(
            &e.pool,
            create_req(&v3, demo_lines(), DiscountDto::None, None),
        )
        .unwrap();
    assert_eq!(
        next.invoice.unwrap().number,
        "2026-27/0002",
        "no gap: 0002, not 0003"
    );
}

/// Bug caught (r5-review-11): a failure INSIDE the issuing transaction, after
/// `next_receipt_seq` already bumped the FY counter, commits the bump (or a
/// partial invoice) and leaves a gap in the receipt numbers. A test trigger
/// makes the invoice-line insert fail after the seq increment.
#[test]
fn save_create_failure_after_the_seq_bump_rolls_back_the_number() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let v1 = followup_visit(&e);
    let v2 = insert_visit_for(&e.pool, &e.patient, "2026-10-16T05:30:00Z", None);
    let v3 = insert_visit_for(&e.pool, &e.patient, "2026-10-16T05:45:00Z", None);
    svc.save(
        &e.pool,
        create_req(&v1, demo_lines(), DiscountDto::None, None),
    )
    .unwrap();
    let (inv0, aud0) = (
        count(&e.pool, "SELECT COUNT(*) FROM invoice"),
        audits(&e.pool),
    );

    e.pool
        .with_writer(|c| {
            c.execute_batch(
                "CREATE TRIGGER test_fail_line BEFORE INSERT ON invoice_line \
                 BEGIN SELECT RAISE(ABORT, 'test'); END;",
            )?;
            Ok(())
        })
        .unwrap();
    let r = svc.save(
        &e.pool,
        create_req(&v2, demo_lines(), DiscountDto::None, None),
    );
    assert!(r.is_err(), "the line insert must fail");
    e.pool
        .with_writer(|c| {
            c.execute_batch("DROP TRIGGER test_fail_line;")?;
            Ok(())
        })
        .unwrap();

    assert_eq!(
        count(&e.pool, "SELECT COUNT(*) FROM invoice"),
        inv0,
        "no invoice row"
    );
    assert_eq!(audits(&e.pool), aud0, "no audit row");
    let next = svc
        .save(
            &e.pool,
            create_req(&v3, demo_lines(), DiscountDto::None, None),
        )
        .unwrap();
    assert_eq!(
        next.invoice.unwrap().number,
        "2026-27/0002",
        "the failed save did not consume 0002"
    );
}

/// Bug caught: two simultaneous saves get the same number (T-SEQ concurrent).
#[test]
fn save_create_concurrent_saves_get_distinct_gap_free_numbers() {
    let e = env();
    let visits: Vec<String> = (0..8)
        .map(|i| {
            insert_visit_for(
                &e.pool,
                &e.patient,
                &format!("2026-10-16T0{i}:10:00Z"),
                None,
            )
        })
        .collect();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let mut numbers: Vec<String> = std::thread::scope(|sc| {
        let hs: Vec<_> = visits
            .chunks(2)
            .map(|chunk| {
                let (svc, pool) = (&svc, &e.pool);
                sc.spawn(move || {
                    chunk
                        .iter()
                        .map(|v| {
                            svc.save(pool, create_req(v, demo_lines(), DiscountDto::None, None))
                                .expect("concurrent save")
                                .invoice
                                .unwrap()
                                .number
                        })
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        hs.into_iter().flat_map(|h| h.join().unwrap()).collect()
    });
    numbers.sort();
    let want: Vec<String> = (1..=8).map(|n| format!("2026-27/{n:04}")).collect();
    assert_eq!(numbers, want);
}

/// Bug caught: a second live bill is created for the same visit.
#[test]
fn save_create_refuses_a_second_live_invoice_for_the_visit() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    svc.save(
        &e.pool,
        create_req(&v, demo_lines(), DiscountDto::None, None),
    )
    .unwrap();
    let r = svc.save(
        &e.pool,
        create_req(&v, demo_lines(), DiscountDto::None, None),
    );
    assert_code(r, ErrorCode::Conflict, "second live invoice");
    assert_eq!(count(&e.pool, "SELECT COUNT(*) FROM invoice"), 1);
}

/// Bug caught: the UI's local date is trusted blindly (a wrong PC date files a
/// bill in another FY) — ±1 day of slack around the clock (A15).
#[test]
fn save_create_refuses_a_local_today_far_from_the_clock() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    for bad in ["2026-10-18", "2026-10-14", "16-10-2026", ""] {
        let mut r = create_req(&v, demo_lines(), DiscountDto::None, None);
        r.local_today = bad.into();
        assert_code(svc.save(&e.pool, r), ErrorCode::Validation, bad);
    }
    for ok in ["2026-10-15", "2026-10-17"] {
        let v2 = insert_visit_for(&e.pool, &e.patient, &format!("{ok}T03:00:00Z"), None);
        let mut r = create_req(&v2, demo_lines(), DiscountDto::None, None);
        r.local_today = ok.into();
        assert!(svc.save(&e.pool, r).is_ok(), "{ok} is within ±1 day");
    }
}

// ---------------------------------------------------------------------------
// invoice_save: update (edit after issue)
// ---------------------------------------------------------------------------

fn update_req(
    visit: &str,
    s: &InvoiceScreen,
    lines: Vec<LineDto>,
    discount: DiscountDto,
) -> InvoiceSaveRequest {
    let inv = s.invoice.as_ref().unwrap();
    InvoiceSaveRequest {
        visit_id: visit.to_string(),
        invoice_id: Some(inv.invoice_id.clone()),
        expected_row_version: Some(inv.row_version),
        lines,
        discount,
        payment: None,
        local_today: TODAY.to_string(),
    }
}

/// Bug caught: editing a bill renumbers it, duplicates lines instead of
/// replacing them, or writes != 1 audit row.
#[test]
fn save_update_replaces_lines_keeps_number_bumps_version_one_audit_row() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let old = s.invoice.clone().unwrap();
    let before = audits(&e.pool);

    // Keep the consultation (by id), change the medicine qty, drop nothing else.
    let mut lines = old.lines.clone();
    lines[1].qty = 2; // 2 x 150 = 300
    let u = svc
        .save(
            &e.pool,
            update_req(&v, &s, lines, DiscountDto::Amount { paise: 10_000 }),
        )
        .expect("update");
    let inv = u.invoice.clone().unwrap();
    assert_eq!(inv.number, old.number, "number locked");
    assert_eq!(inv.invoice_id, old.invoice_id);
    assert!(inv.row_version > old.row_version);
    assert_eq!(inv.totals.subtotal_paise, 60_000);
    assert_eq!(inv.totals.total_paise, 50_000);
    assert_eq!(inv.balance_paise, 30_000, "50,000 - 20,000 paid");
    assert_eq!(u.patient_dues_paise, 30_000);
    assert_eq!(audits(&e.pool) - before, 1);
    assert_eq!(last_audit(&e.pool), ("invoice".into(), "update".into()));
    assert_eq!(
        count(
            &e.pool,
            "SELECT COUNT(*) FROM invoice_line WHERE deleted_at IS NULL"
        ),
        2,
        "lines replaced, not appended"
    );

    // Removing a line soft-deletes it.
    let u2 = svc
        .save(
            &e.pool,
            update_req(&v, &u, vec![inv.lines[0].clone()], DiscountDto::None),
        )
        .unwrap();
    assert_eq!(u2.invoice.unwrap().lines.len(), 1);
    assert_eq!(
        count(
            &e.pool,
            "SELECT COUNT(*) FROM invoice_line WHERE deleted_at IS NULL"
        ),
        1
    );
}

/// Bug caught: an edit lowers the total below what the patient already paid
/// (negative balance) instead of `total_below_paid`; nothing must change.
#[test]
fn save_update_below_paid_is_refused_and_changes_nothing() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v); // paid 20,000
    let before = audits(&e.pool);
    let r = svc.save(
        &e.pool,
        update_req(
            &v,
            &s,
            vec![line(LineKind::Consultation, "Consultation", 1, 15_000)],
            DiscountDto::None,
        ),
    );
    assert_code(r, ErrorCode::TotalBelowPaid, "total 15,000 < paid 20,000");
    assert_eq!(audits(&e.pool), before);
    let now = svc
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: v,
                local_today: TODAY.into(),
            },
        )
        .unwrap();
    assert_eq!(now.invoice.unwrap().totals.total_paise, 42_750, "unchanged");
}

/// Bug caught: a stale editor (other window) overwrites a newer save.
#[test]
fn save_update_with_stale_row_version_is_a_conflict() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let lines = s.invoice.clone().unwrap().lines;
    svc.save(
        &e.pool,
        update_req(&v, &s, lines.clone(), DiscountDto::None),
    )
    .unwrap();
    let r = svc.save(
        &e.pool,
        update_req(&v, &s, lines, DiscountDto::Amount { paise: 100 }),
    );
    assert_code(r, ErrorCode::Conflict, "stale row_version");
}

// ---------------------------------------------------------------------------
// payment_add / payment_void
// ---------------------------------------------------------------------------

/// Bug caught: partial payments do not reduce the balance/dues, the final
/// payment can exceed the balance, or a payment writes != 1 audit row.
#[test]
fn payment_add_partial_then_rest_and_never_more_than_balance() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v); // balance 22,750
    let id = s.invoice.unwrap().invoice_id;

    let before = audits(&e.pool);
    let mut upi = pay(10_000, PaymentMode::Upi, TODAY);
    upi.reference = Some(" UTR123 ".into());
    let a = svc
        .payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: id.clone(),
                payment: upi,
            },
        )
        .unwrap();
    let inv = a.invoice.unwrap();
    assert_eq!((inv.paid_paise, inv.balance_paise), (30_000, 12_750));
    assert_eq!(inv.payments.len(), 2);
    assert_eq!(
        inv.payments[1].reference.as_deref(),
        Some("UTR123"),
        "reference trimmed"
    );
    assert_eq!(a.patient_dues_paise, 12_750);
    assert_eq!(audits(&e.pool) - before, 1);
    assert_eq!(last_audit(&e.pool), ("payment".into(), "create".into()));

    let over = svc.payment_add(
        &e.pool,
        PaymentAddRequest {
            invoice_id: id.clone(),
            payment: pay(12_751, PaymentMode::Cash, TODAY),
        },
    );
    assert_code(over, ErrorCode::PaymentExceedsBalance, "overpayment");

    let rest = svc
        .payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: id,
                payment: pay(12_750, PaymentMode::Card, TODAY),
            },
        )
        .unwrap();
    assert_eq!(rest.invoice.unwrap().balance_paise, 0);
    assert_eq!(rest.patient_dues_paise, 0);
}

/// Bug caught: a zero / back-dated-before-issue / future / over-long-ref
/// payment is recorded; a blank reference is stored as "".
#[test]
fn payment_add_validates_amount_date_and_reference() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let id = create_demo(&svc, &e.pool, &v).invoice.unwrap().invoice_id;
    let before = audits(&e.pool);

    let bad = |p: PaymentInput, why: &str| {
        let r = svc.payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: id.clone(),
                payment: p,
            },
        );
        assert_code(r, ErrorCode::Validation, why);
    };
    bad(pay(0, PaymentMode::Cash, TODAY), "zero amount");
    bad(pay(-100, PaymentMode::Cash, TODAY), "negative amount");
    bad(
        pay(100, PaymentMode::Cash, "2026-10-15"),
        "before the issue date",
    );
    bad(pay(100, PaymentMode::Cash, "2026-10-18"), "in the future");
    bad(pay(100, PaymentMode::Cash, "16/10/2026"), "malformed date");
    let mut long = pay(100, PaymentMode::Upi, TODAY);
    long.reference = Some("R".repeat(65));
    bad(long, "reference > 64 chars");
    assert_eq!(audits(&e.pool), before, "nothing written");

    let mut blank = pay(100, PaymentMode::Upi, TODAY);
    blank.reference = Some("   ".into());
    let ok = svc
        .payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: id,
                payment: blank,
            },
        )
        .unwrap();
    assert_eq!(
        ok.invoice.unwrap().payments.last().unwrap().reference,
        None,
        "blank -> None"
    );
}

/// Bug caught: cancelling a mistaken payment does not restore the balance /
/// dues, can be done twice, or without a reason.
#[test]
fn payment_void_restores_balance_needs_a_reason_and_is_once_only() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let pid = s.invoice.unwrap().payments[0].payment_id.clone();

    let empty = svc.payment_void(
        &e.pool,
        PaymentVoidRequest {
            payment_id: pid.clone(),
            reason: "  ".into(),
        },
    );
    assert_code(empty, ErrorCode::Validation, "blank reason");

    let before = audits(&e.pool);
    let r = svc
        .payment_void(
            &e.pool,
            PaymentVoidRequest {
                payment_id: pid.clone(),
                reason: "Entered twice".into(),
            },
        )
        .unwrap();
    let inv = r.invoice.unwrap();
    assert_eq!((inv.paid_paise, inv.balance_paise), (0, 42_750));
    assert!(inv.payments[0].voided, "stays listed as cancelled");
    assert_eq!(r.patient_dues_paise, 42_750);
    assert_eq!(audits(&e.pool) - before, 1);
    assert_eq!(last_audit(&e.pool), ("payment".into(), "update".into()));

    let twice = svc.payment_void(
        &e.pool,
        PaymentVoidRequest {
            payment_id: pid,
            reason: "Again".into(),
        },
    );
    assert_code(twice, ErrorCode::Validation, "already voided");
    let missing = svc.payment_void(
        &e.pool,
        PaymentVoidRequest {
            payment_id: "nope".into(),
            reason: "x".into(),
        },
    );
    assert!(
        matches!(missing, Err(AppError::NotFound)),
        "got {missing:?}"
    );
}

// ---------------------------------------------------------------------------
// invoice_void
// ---------------------------------------------------------------------------

/// Bug caught: cancelling a bill frees its number for reuse, leaves its
/// payments live (counted in reports), keeps it in dues, or blocks re-billing.
#[test]
fn invoice_void_keeps_number_voids_payments_and_rebill_gets_the_next_number() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let inv = s.invoice.unwrap();
    let before = audits(&e.pool);

    let r = svc
        .invoice_void(
            &e.pool,
            InvoiceVoidRequest {
                invoice_id: inv.invoice_id.clone(),
                reason: "Billed wrong patient".into(),
                expected_row_version: inv.row_version,
            },
        )
        .expect("void");
    let voided = r.invoice.expect("void invoice returned");
    assert_eq!(voided.status, InvoiceStatus::Void);
    assert_eq!(voided.number, "2026-27/0001", "number kept");
    assert_eq!(voided.void_reason.as_deref(), Some("Billed wrong patient"));
    assert!(
        voided.payments.iter().all(|p| p.voided),
        "its payments are cancelled too"
    );
    assert_eq!(r.patient_dues_paise, 0, "void bill leaves dues");
    assert_eq!(
        audits(&e.pool) - before,
        1,
        "one audit row for the whole void"
    );
    assert_eq!(last_audit(&e.pool), ("invoice".into(), "update".into()));
    assert_eq!(
        count(
            &e.pool,
            "SELECT COUNT(*) FROM payment WHERE voided_at IS NULL"
        ),
        0
    );

    let again = svc
        .save(
            &e.pool,
            create_req(&v, demo_lines(), DiscountDto::None, None),
        )
        .expect("re-bill");
    assert_eq!(
        again.invoice.unwrap().number,
        "2026-27/0002",
        "never reuses 0001"
    );
}

/// Bug caught: a cancelled bill can still take payments, be edited or be
/// cancelled again.
#[test]
fn a_void_invoice_refuses_payments_edits_and_a_second_void() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let inv = s.invoice.clone().unwrap();
    let r = svc
        .invoice_void(
            &e.pool,
            InvoiceVoidRequest {
                invoice_id: inv.invoice_id.clone(),
                reason: "Test".into(),
                expected_row_version: inv.row_version,
            },
        )
        .unwrap();
    let rv = r.invoice.unwrap().row_version;

    let p = svc.payment_add(
        &e.pool,
        PaymentAddRequest {
            invoice_id: inv.invoice_id.clone(),
            payment: pay(100, PaymentMode::Cash, TODAY),
        },
    );
    assert_code(p, ErrorCode::InvoiceVoided, "payment on void");
    let mut upd = update_req(&v, &s, inv.lines.clone(), DiscountDto::None);
    upd.expected_row_version = Some(rv);
    assert_code(
        svc.save(&e.pool, upd),
        ErrorCode::InvoiceVoided,
        "edit void",
    );
    let v2 = svc.invoice_void(
        &e.pool,
        InvoiceVoidRequest {
            invoice_id: inv.invoice_id,
            reason: "Again".into(),
            expected_row_version: rv,
        },
    );
    assert_code(v2, ErrorCode::InvoiceVoided, "second void");
}

/// Bug caught (r5-review-6): a payment added after the editor loaded does not
/// bump the row version, so a void from that stale screen goes through and
/// its "also cancels Rs X" confirm understated what was voided.
#[test]
fn a_payment_bumps_the_row_version_so_a_stale_void_is_a_conflict() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let stale = create_demo(&svc, &e.pool, &v).invoice.unwrap();
    let after = svc
        .payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: stale.invoice_id.clone(),
                payment: pay(100, PaymentMode::Cash, TODAY),
            },
        )
        .unwrap()
        .invoice
        .unwrap();
    assert!(after.row_version > stale.row_version);
    let r = svc.invoice_void(
        &e.pool,
        InvoiceVoidRequest {
            invoice_id: stale.invoice_id,
            reason: "Test".into(),
            expected_row_version: stale.row_version,
        },
    );
    assert_code(
        r,
        ErrorCode::Conflict,
        "void from a screen older than a payment",
    );
}

/// Bug caught: a void without a reason, or from a stale screen, goes through.
#[test]
fn invoice_void_needs_a_reason_and_a_current_row_version() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let inv = create_demo(&svc, &e.pool, &v).invoice.unwrap();
    let r = svc.invoice_void(
        &e.pool,
        InvoiceVoidRequest {
            invoice_id: inv.invoice_id.clone(),
            reason: " ".into(),
            expected_row_version: inv.row_version,
        },
    );
    assert_code(r, ErrorCode::Validation, "blank reason");
    let r = svc.invoice_void(
        &e.pool,
        InvoiceVoidRequest {
            invoice_id: inv.invoice_id,
            reason: "Test".into(),
            expected_row_version: inv.row_version + 5,
        },
    );
    assert_code(r, ErrorCode::Conflict, "stale row_version");
}

// ---------------------------------------------------------------------------
// Dues: patient balance across invoices, read sites, Clear dues
// ---------------------------------------------------------------------------

/// Two bills for one patient: Rs 427.50 (Rs 200 paid) and Rs 450 (unpaid).
fn two_open_bills(e: &Env, svc: &BillingService<'_>) -> (String, String) {
    let v1 = insert_visit_for(&e.pool, &e.patient, "2026-10-15T05:00:00Z", None);
    let mut r1 = create_req(
        &v1,
        demo_lines(),
        DiscountDto::Percent { basis_points: 500 },
        Some(pay(20_000, PaymentMode::Cash, "2026-10-15")),
    );
    r1.local_today = "2026-10-15".into();
    let a = svc.save(&e.pool, r1).unwrap().invoice.unwrap().invoice_id;
    let v2 = insert_visit_for(
        &e.pool,
        &e.patient,
        "2026-10-16T05:00:00Z",
        Some("2026-10-16"),
    );
    let b = svc
        .save(
            &e.pool,
            create_req(&v2, demo_lines(), DiscountDto::None, None),
        )
        .unwrap()
        .invoice
        .unwrap()
        .invoice_id;
    (a, b)
}

/// Bug caught: running dues ignore older bills, double-count, or the open
/// list is not oldest-first.
#[test]
fn patient_dues_sum_open_invoices_oldest_first() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let (a, b) = two_open_bills(&e, &svc);
    let d = svc
        .patient_dues(
            &e.pool,
            PatientIdRequest {
                patient_id: e.patient.clone(),
            },
        )
        .unwrap();
    assert_eq!(d.dues_paise, 22_750 + 45_000);
    let ids: Vec<&str> = d
        .open_invoices
        .iter()
        .map(|o| o.invoice_id.as_str())
        .collect();
    assert_eq!(ids, vec![a.as_str(), b.as_str()]);
    assert_eq!(d.open_invoices[0].number, "2026-27/0001");
    assert_eq!(d.open_invoices[0].issued_on, "2026-10-15");
    assert_eq!(d.open_invoices[0].balance_paise, 22_750);
}

/// Bug caught: the dashboard / patient list / Today keep showing Rs 0 dues
/// (the R2/R3 hard-coded 0 not switched to the real balance, F1).
#[test]
fn dashboard_list_and_today_show_the_real_patient_balance() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    two_open_bills(&e, &svc);
    let want = 22_750 + 45_000;

    let (_ks_dir, keystore) = temp_file_keystore();
    let data = tempfile::tempdir().unwrap();
    let ps = PatientService::new(&keystore, &clock, data.path());
    let dash = ps
        .get_dashboard(
            &e.pool,
            GetDashboardRequest {
                patient_id: e.patient.clone(),
            },
        )
        .expect("dashboard");
    assert_eq!(dash.dues_paise, want, "S07 dues badge");

    let list = ps
        .list_query(
            &e.pool,
            ListQueryRequest {
                filters: PatientFilter {
                    dues_positive: Some(true),
                    ..Default::default()
                },
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
                cursor: None,
                limit: 20,
            },
        )
        .expect("list");
    let row = list
        .rows
        .iter()
        .find(|r| r.patient_id == e.patient)
        .expect("Dues > 0 filter finds the patient");
    assert_eq!(row.dues_paise, want, "S05 list dues column");

    let today = VisitService::new(&clock)
        .today_overview(
            &e.pool,
            TodayOverviewRequest {
                today: TODAY.into(),
            },
        )
        .expect("today");
    let due = today
        .due_today
        .iter()
        .find(|r| r.patient_id == e.patient)
        .expect("due today");
    assert_eq!(due.dues_paise, want, "S03 due-today row dues");
}

/// Bug caught: the dashboard timeline / Today rows cannot show a bill chip
/// (no bill info, no visit id for the Bill button).
#[test]
fn dashboard_timeline_and_today_rows_carry_the_visit_bill() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let billed = followup_visit(&e);
    let inv = create_demo(&svc, &e.pool, &billed).invoice.unwrap();
    let unbilled = insert_visit_for(&e.pool, &e.patient, "2026-10-16T07:00:00Z", None);

    let (_ks_dir, keystore) = temp_file_keystore();
    let data = tempfile::tempdir().unwrap();
    let dash = PatientService::new(&keystore, &clock, data.path())
        .get_dashboard(
            &e.pool,
            GetDashboardRequest {
                patient_id: e.patient.clone(),
            },
        )
        .unwrap();
    let b = dash.visits.iter().find(|v| v.visit_id == billed).unwrap();
    let bill = b.bill.as_ref().expect("billed visit carries its bill");
    assert_eq!(
        (bill.number.as_str(), bill.total_paise, bill.balance_paise),
        ("2026-27/0001", 42_750, 22_750)
    );
    assert_eq!(bill.invoice_id, inv.invoice_id);
    assert!(dash
        .visits
        .iter()
        .find(|v| v.visit_id == unbilled)
        .unwrap()
        .bill
        .is_none());

    let today = VisitService::new(&clock)
        .today_overview(
            &e.pool,
            TodayOverviewRequest {
                today: TODAY.into(),
            },
        )
        .unwrap();
    let row = today
        .registered_today
        .iter()
        .find(|r| r.visit_id == billed)
        .expect("registered-today row carries its visit id");
    assert_eq!(
        row.bill.as_ref().map(|b| b.number.as_str()),
        Some("2026-27/0001")
    );
}

/// Bug caught: the case-form strip shows the wrong visit state or dues.
#[test]
fn visit_status_reports_bill_and_patient_dues() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let v = followup_visit(&e);
    let s0 = svc
        .visit_status(
            &e.pool,
            VisitIdRequest {
                visit_id: v.clone(),
            },
        )
        .unwrap();
    assert_eq!((s0.bill.is_none(), s0.patient_dues_paise), (true, 0));
    assert_eq!(s0.patient_id, e.patient);

    create_demo(&svc, &e.pool, &v);
    let s1 = svc
        .visit_status(&e.pool, VisitIdRequest { visit_id: v })
        .unwrap();
    let b = s1.bill.expect("billed");
    assert_eq!(
        (b.number.as_str(), b.balance_paise),
        ("2026-27/0001", 22_750)
    );
    assert_eq!(s1.patient_dues_paise, 22_750);
}

/// Bug caught: Clear dues pays the newest bill first, writes several audit
/// rows, does not share a batch, or leaves dues > 0.
#[test]
fn clear_dues_allocates_oldest_first_one_audit_row_dues_zero() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let (a, b) = two_open_bills(&e, &svc);
    let before = audits(&e.pool);

    let mut p = pay(67_750, PaymentMode::Upi, TODAY);
    p.reference = Some("UTR123".into());
    let r = svc
        .clear_dues(
            &e.pool,
            ClearDuesRequest {
                patient_id: e.patient.clone(),
                payment: p,
                expected_dues_paise: 67_750,
            },
        )
        .expect("clear dues");
    assert_eq!(r.dues_paise, 0);
    let alloc: Vec<(&str, i64)> = r
        .allocations
        .iter()
        .map(|x| (x.invoice_id.as_str(), x.amount_paise))
        .collect();
    assert_eq!(alloc, vec![(a.as_str(), 22_750), (b.as_str(), 45_000)]);
    assert_eq!(r.allocations[0].number, "2026-27/0001");
    assert_eq!(
        audits(&e.pool) - before,
        1,
        "ONE audit row for the whole clear"
    );
    assert_eq!(last_audit(&e.pool), ("payment".into(), "create".into()));
    assert_eq!(
        count(
            &e.pool,
            "SELECT COUNT(DISTINCT batch_id) FROM payment WHERE batch_id IS NOT NULL"
        ),
        1
    );
    assert_eq!(
        count(&e.pool, "SELECT COUNT(*) FROM payment WHERE batch_id IS NOT NULL AND mode = 'upi' AND reference = 'UTR123'"),
        2,
        "one payment row per invoice touched, same mode/ref"
    );
    assert_eq!(
        svc.patient_dues(
            &e.pool,
            PatientIdRequest {
                patient_id: e.patient.clone()
            }
        )
        .unwrap()
        .dues_paise,
        0
    );
}

/// Bug caught: a partial Clear dues touches the newer bill first.
#[test]
fn clear_dues_partial_pays_the_oldest_bill_only() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let (a, _b) = two_open_bills(&e, &svc);
    let r = svc
        .clear_dues(
            &e.pool,
            ClearDuesRequest {
                patient_id: e.patient.clone(),
                payment: pay(10_000, PaymentMode::Cash, TODAY),
                expected_dues_paise: 67_750,
            },
        )
        .unwrap();
    assert_eq!(r.allocations.len(), 1);
    assert_eq!(
        (
            r.allocations[0].invoice_id.as_str(),
            r.allocations[0].amount_paise
        ),
        (a.as_str(), 10_000)
    );
    assert_eq!(r.dues_paise, 57_750);
}

/// Bug caught: Clear dues from a stale dialog (dues changed meanwhile) or for
/// more than the dues goes through; nothing must be written.
#[test]
fn clear_dues_refuses_stale_dues_and_overpayment_and_writes_nothing() {
    let e = env();
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    two_open_bills(&e, &svc);
    let (pays, aud) = (
        count(&e.pool, "SELECT COUNT(*) FROM payment"),
        audits(&e.pool),
    );

    let stale = svc.clear_dues(
        &e.pool,
        ClearDuesRequest {
            patient_id: e.patient.clone(),
            payment: pay(100, PaymentMode::Cash, TODAY),
            expected_dues_paise: 50_000,
        },
    );
    assert_code(stale, ErrorCode::Conflict, "stale expected dues");
    let over = svc.clear_dues(
        &e.pool,
        ClearDuesRequest {
            patient_id: e.patient.clone(),
            payment: pay(67_751, PaymentMode::Cash, TODAY),
            expected_dues_paise: 67_750,
        },
    );
    assert_code(over, ErrorCode::PaymentExceedsBalance, "more than dues");
    assert_eq!(count(&e.pool, "SELECT COUNT(*) FROM payment"), pays);
    assert_eq!(audits(&e.pool), aud);
}

// ---------------------------------------------------------------------------
// Receipt + UPI QR
// ---------------------------------------------------------------------------

/// Bug caught: the receipt misses identity / number / lines / totals, lists a
/// cancelled payment, or prints the wrong amount in words.
#[test]
fn receipt_carries_clinic_doctor_patient_lines_totals_and_paid_in_words() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let s = create_demo(&svc, &e.pool, &v);
    let inv = s.invoice.unwrap();
    // A second, then cancelled, payment must not print.
    let added = svc
        .payment_add(
            &e.pool,
            PaymentAddRequest {
                invoice_id: inv.invoice_id.clone(),
                payment: pay(500, PaymentMode::Cash, TODAY),
            },
        )
        .unwrap();
    let mistaken = added.invoice.unwrap().payments[1].payment_id.clone();
    svc.payment_void(
        &e.pool,
        PaymentVoidRequest {
            payment_id: mistaken,
            reason: "Mistake".into(),
        },
    )
    .unwrap();

    let r = svc
        .receipt(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id,
            },
        )
        .expect("receipt");
    assert_eq!(r.clinic_name, "Test Clinic 001");
    assert_eq!(r.clinic_address, "1 Test Street");
    assert_eq!(r.doctor_name, "Test Doctor 001");
    assert_eq!(r.doctor_qualification, "BHMS");
    assert_eq!(r.doctor_reg_no, "TESTREG-001");
    assert_eq!(r.number, "2026-27/0001");
    assert_eq!(r.issued_on, TODAY);
    assert_eq!(r.patient_name, "Test Patient R5");
    assert_eq!(r.patient_code, "HC-000001");
    assert_eq!(r.lines.len(), 2);
    assert_eq!(r.totals.total_paise, 42_750);
    assert_eq!(r.discount, DiscountDto::Percent { basis_points: 500 });
    assert_eq!(r.payments.len(), 1, "cancelled payment not printed");
    assert_eq!((r.paid_paise, r.balance_paise), (20_000, 22_750));
    assert_eq!(r.paid_in_words, "Rupees Two Hundred Only");
    assert!(!r.void);
    assert_eq!(r.gstin, None, "GSTIN line only when set");
    assert_eq!(r.upi_qr_data_url, None, "no VPA -> no QR");
}

/// Bug caught: changing the clinic GSTIN later rewrites old receipts (the
/// GSTIN must be the snapshot at issue), or a void receipt is not marked.
#[test]
fn receipt_prints_the_gstin_snapshot_and_marks_void() {
    let e = env();
    set_fees(&e, 50_000, 30_000, Some("27AAAAA0000A1Z5"));
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let inv = create_demo(&svc, &e.pool, &v).invoice.unwrap();
    set_fees(&e, 50_000, 30_000, Some("29BBBBB1111B1Z5"));

    let r = svc
        .receipt(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id.clone(),
            },
        )
        .unwrap();
    assert_eq!(r.gstin.as_deref(), Some("27AAAAA0000A1Z5"));

    svc.invoice_void(
        &e.pool,
        InvoiceVoidRequest {
            invoice_id: inv.invoice_id.clone(),
            reason: "Test".into(),
            expected_row_version: inv.row_version,
        },
    )
    .unwrap();
    let rv = svc
        .receipt(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id,
            },
        )
        .unwrap();
    assert!(rv.void, "CANCELLED watermark");
    assert_eq!(rv.number, "2026-27/0001");
}

/// Bug caught: the QR panel shows without a VPA, encodes the wrong amount,
/// leaks the patient's name into the UPI link, or shows for a paid bill.
#[test]
fn upi_qr_available_only_with_vpa_and_balance_and_has_no_patient_data() {
    let e = env();
    let v = followup_visit(&e);
    let clock = TestClock::at(NOW);
    let svc = BillingService::new(&clock);
    let inv = create_demo(&svc, &e.pool, &v).invoice.unwrap();

    let none = svc
        .upi_qr(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id.clone(),
            },
        )
        .unwrap();
    assert!(
        !none.available && none.qr_data_url.is_none(),
        "no VPA -> no QR"
    );

    set_vpa(&e, "testclinic@upi");
    let got = svc
        .get_for_visit(
            &e.pool,
            InvoiceGetForVisitRequest {
                visit_id: v,
                local_today: TODAY.into(),
            },
        )
        .unwrap();
    assert!(got.upi_configured);
    let q = svc
        .upi_qr(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id.clone(),
            },
        )
        .unwrap();
    assert!(q.available);
    assert_eq!(q.amount_paise, 22_750);
    let url = q.upi_url.expect("url");
    assert!(url.starts_with("upi://pay?pa=testclinic@upi&"), "{url}");
    assert!(url.contains("am=227.50"), "{url}");
    assert!(url.contains("cu=INR"), "{url}");
    assert!(
        !url.contains("Patient") && !url.contains("HC-000001"),
        "no patient data: {url}"
    );
    assert!(q
        .qr_data_url
        .expect("qr")
        .starts_with("data:image/svg+xml;base64,"));
    let rc = svc
        .receipt(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id.clone(),
            },
        )
        .unwrap();
    assert!(
        rc.upi_qr_data_url.is_some(),
        "receipt shows the QR when balance > 0 and VPA set"
    );

    svc.payment_add(
        &e.pool,
        PaymentAddRequest {
            invoice_id: inv.invoice_id.clone(),
            payment: pay(22_750, PaymentMode::Upi, TODAY),
        },
    )
    .unwrap();
    let paid = svc
        .upi_qr(
            &e.pool,
            InvoiceIdRequest {
                invoice_id: inv.invoice_id,
            },
        )
        .unwrap();
    assert!(!paid.available, "fully paid -> no QR");
}

// ---------------------------------------------------------------------------
// Error contract (design §6.4)
// ---------------------------------------------------------------------------

/// Bug caught: the four R5 errors reach the UI as a generic "Something went
/// wrong", or a billing rule error is not mapped to the right code.
#[test]
fn r5_errors_map_to_distinct_codes_with_safe_messages() {
    for (e, code) in [
        (
            AppError::PaymentExceedsBalance,
            ErrorCode::PaymentExceedsBalance,
        ),
        (AppError::TotalBelowPaid, ErrorCode::TotalBelowPaid),
        (AppError::InvoiceVoided, ErrorCode::InvoiceVoided),
        (AppError::ExportFailed, ErrorCode::ExportFailed),
    ] {
        let u = map_error(&e);
        assert_eq!(u.code, code);
        assert!(!u.message.is_empty() && !u.suggested_action.is_empty());
        assert!(
            !u.message.contains('/') && !u.message.contains("Rs"),
            "no path / amount: {}",
            u.message
        );
    }
    for (b, code) in [
        (BillingError::Invalid, ErrorCode::Validation),
        (BillingError::DiscountTooLarge, ErrorCode::Validation),
        (
            BillingError::ExceedsBalance,
            ErrorCode::PaymentExceedsBalance,
        ),
        (BillingError::TotalBelowPaid, ErrorCode::TotalBelowPaid),
    ] {
        assert_eq!(map_error(&AppError::from(b.clone())).code, code, "{b:?}");
    }
}
