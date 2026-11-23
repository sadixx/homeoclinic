//! R5 reports use-case tests (BILL-004, HC-MVP1-153; R5 design §6, §10, §13
//! T-REPORT / T-EXPORT).
//!
//! CUT: the REAL `hc_app::reports::ReportService` over a REAL migrated temp DB.
//! Invoices/payments are seeded with plain SQL against the real 0012 schema so
//! the report is tested independently of the billing service. Export writes
//! into a `TempDir` (R-TEST-006). Synthetic data only. RED until hc-core-dev
//! replaces the §13 stub bodies.

use hc_app::clock::Clock;
use hc_app::error::{map_error, ErrorCode};
use hc_app::reports::{
    DailyCollectionRequest, ExportFormat, ModeRow, MonthlySummaryRequest, ReportExportRequest,
    ReportService, ReportSpec,
};
use hc_domain::billing::PaymentMode;
use hc_storage::testing::{insert_visit_for, seed_patient, temp_db};
use hc_storage::Pool;

struct FixedClock;
impl Clock for FixedClock {
    fn now_rfc3339(&self) -> String {
        "2026-10-31T12:00:00Z".to_string()
    }
}

const AT: &str = "2026-10-16T05:00:00Z";

/// Insert one consistent unpaid invoice (`total`) for a fresh visit.
fn invoice(pool: &Pool, pid: &str, id: &str, seq: i64, issued_on: &str, total: i64, status: &str) {
    let visit = insert_visit_for(pool, pid, &format!("{issued_on}T04:00:00Z"), None);
    pool.with_writer(|c| {
        c.execute(
            "INSERT INTO invoice (id, patient_id, visit_id, fy, seq, number, issued_on, issued_at, status, \
               discount_kind, discount_value, subtotal_paise, discount_paise, total_paise, paid_paise, \
               balance_paise, created_at, updated_at) \
             VALUES (?1, ?2, ?3, '2026-27', ?4, ?5, ?6, ?7, ?8, 'none', 0, ?9, 0, ?9, ?10, ?11, ?7, ?7)",
            (
                id,
                pid,
                visit.as_str(),
                seq,
                format!("2026-27/{seq:04}"),
                issued_on,
                AT,
                status,
                total,
                0_i64,
                total,
            ),
        )?;
        Ok(())
    })
    .expect("seed invoice");
}

/// Insert one payment row against `inv-a` (voided when `voided`).
fn payment(pool: &Pool, pid: &str, id: &str, paid_on: &str, amount: i64, mode: &str, voided: bool) {
    let voided_at: Option<&str> = voided.then_some(AT);
    pool.with_writer(|c| {
        c.execute(
            "INSERT INTO payment (id, invoice_id, patient_id, paid_on, recorded_at, amount_paise, mode, \
               voided_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?5, ?5)",
            (id, "inv-a", pid, paid_on, AT, amount, mode, voided_at),
        )?;
        Ok(())
    })
    .expect("seed payment");
}

/// October 2026 fixture. 16-10: cash 200 + cash 50 + UPI 100 (+ a voided card
/// 99); 15-10 cash 10; 30-09 and 01-11 outside the month; 31-10 other 40.
/// Outstanding on bills issued 16-10: inv-b balance 132.50 (inv-v is void).
fn fixture() -> (tempfile::TempDir, Pool) {
    let (dir, pool) = temp_db();
    let pid = seed_patient(&pool, "HC-000001", "Test Patient R5");
    invoice(&pool, &pid, "inv-a", 1, "2026-09-30", 200_000, "issued");
    invoice(&pool, &pid, "inv-b", 2, "2026-10-16", 13_250, "issued");
    invoice(&pool, &pid, "inv-v", 3, "2026-10-16", 50_000, "void");
    for (id, day, amt, mode, void) in [
        ("p01", "2026-09-30", 1_000, "cash", false),
        ("p02", "2026-10-15", 1_000, "cash", false),
        ("p03", "2026-10-16", 20_000, "cash", false),
        ("p04", "2026-10-16", 5_000, "cash", false),
        ("p05", "2026-10-16", 10_000, "upi", false),
        ("p06", "2026-10-16", 9_900, "card", true),
        ("p07", "2026-10-31", 4_000, "other", false),
        ("p08", "2026-11-01", 7_000, "cash", false),
    ] {
        payment(&pool, &pid, id, day, amt, mode, void);
    }
    (dir, pool)
}

fn audits(pool: &Pool) -> i64 {
    pool.with_reader(|c| Ok(c.query_row("SELECT COUNT(*) FROM audit_log", [], |r| r.get(0))?))
        .unwrap()
}

fn row(mode: PaymentMode, count: i64, amount: i64) -> ModeRow {
    ModeRow {
        mode,
        count,
        amount_paise: amount,
    }
}

// ---------------------------------------------------------------------------
// Daily collection
// ---------------------------------------------------------------------------

/// Bug caught: daily collection counts voided payments, other days, or
/// groups by issue date; zero modes missing; outstanding wrong (A8).
#[test]
fn daily_collection_sums_live_payments_by_mode_in_fixed_order() {
    let (_d, pool) = fixture();
    let clock = FixedClock;
    let d = ReportService::new(&clock)
        .daily_collection(
            &pool,
            DailyCollectionRequest {
                date: "2026-10-16".into(),
            },
        )
        .expect("daily");
    assert_eq!(d.date, "2026-10-16");
    assert_eq!(
        d.by_mode,
        vec![
            row(PaymentMode::Cash, 2, 25_000),
            row(PaymentMode::Upi, 1, 10_000),
            row(PaymentMode::Card, 0, 0),
            row(PaymentMode::Other, 0, 0),
        ]
    );
    assert_eq!((d.total_count, d.total_paise), (3, 35_000));
    assert_eq!(
        d.outstanding_paise, 13_250,
        "non-void bills issued that day only"
    );
}

/// Bug caught: an empty day errors or omits rows (S16 empty state needs the
/// 4 zero rows + zero totals).
#[test]
fn daily_collection_empty_day_has_four_zero_rows() {
    let (_d, pool) = fixture();
    let clock = FixedClock;
    let d = ReportService::new(&clock)
        .daily_collection(
            &pool,
            DailyCollectionRequest {
                date: "2026-10-20".into(),
            },
        )
        .unwrap();
    assert_eq!(d.by_mode.len(), 4);
    assert!(d
        .by_mode
        .iter()
        .all(|m| m.count == 0 && m.amount_paise == 0));
    assert_eq!(
        (d.total_count, d.total_paise, d.outstanding_paise),
        (0, 0, 0)
    );
}

/// Bug caught: a malformed date runs an unbounded / wrong query.
#[test]
fn daily_collection_refuses_a_bad_date() {
    let (_d, pool) = fixture();
    let clock = FixedClock;
    for bad in ["", "16-10-2026", "2026-02-30", "2026-10-16T00:00:00Z"] {
        let r = ReportService::new(&clock)
            .daily_collection(&pool, DailyCollectionRequest { date: bad.into() });
        match r {
            Err(e) => assert_eq!(map_error(&e).code, ErrorCode::Validation, "{bad:?}"),
            Ok(v) => panic!("{bad:?} must be refused, got {v:?}"),
        }
    }
}

/// Bug caught (r5-review-9): a bad date / month is only refused AFTER the
/// folder picker asked the doctor for a folder. `validate_export` runs first.
#[test]
fn export_request_is_validated_before_any_folder_is_picked() {
    for (report, valid) in [
        (
            ReportSpec::Daily {
                date: "2026-10-16".into(),
            },
            true,
        ),
        (
            ReportSpec::Daily {
                date: "2026-02-30".into(),
            },
            false,
        ),
        (
            ReportSpec::Daily {
                date: "16-10-2026".into(),
            },
            false,
        ),
        (
            ReportSpec::Monthly {
                month: "2026-10".into(),
            },
            true,
        ),
        (
            ReportSpec::Monthly {
                month: "2026-13".into(),
            },
            false,
        ),
        (
            ReportSpec::Monthly {
                month: "10-2026".into(),
            },
            false,
        ),
    ] {
        let req = ReportExportRequest {
            report,
            format: ExportFormat::Csv,
        };
        match ReportService::validate_export(&req) {
            Ok(()) => assert!(valid, "{req:?} must be refused"),
            Err(e) => {
                assert!(!valid, "{req:?} must be accepted");
                assert_eq!(map_error(&e).code, ErrorCode::Validation);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Monthly summary
// ---------------------------------------------------------------------------

/// Bug caught: missing days, days from the neighbouring months, voided
/// payments counted, or day rows that do not add up to the month total.
#[test]
fn monthly_summary_lists_every_day_and_rows_sum_to_the_total() {
    let (_d, pool) = fixture();
    let clock = FixedClock;
    let m = ReportService::new(&clock)
        .monthly_summary(
            &pool,
            MonthlySummaryRequest {
                month: "2026-10".into(),
            },
        )
        .expect("monthly");
    assert_eq!(m.month, "2026-10");
    assert_eq!(m.days.len(), 31, "every calendar day");
    assert_eq!(m.days[0].date, "2026-10-01");
    assert_eq!(m.days[30].date, "2026-10-31");

    let d16 = m.days.iter().find(|d| d.date == "2026-10-16").unwrap();
    assert_eq!(
        (
            d16.cash_paise,
            d16.upi_paise,
            d16.card_paise,
            d16.other_paise,
            d16.count,
            d16.total_paise
        ),
        (25_000, 10_000, 0, 0, 3, 35_000)
    );
    let d31 = m.days.iter().find(|d| d.date == "2026-10-31").unwrap();
    assert_eq!((d31.other_paise, d31.total_paise), (4_000, 4_000));

    assert_eq!(m.total.date, "2026-10");
    assert_eq!(
        m.total.total_paise,
        1_000 + 35_000 + 4_000,
        "15th + 16th + 31st"
    );
    assert_eq!(m.total.count, 5);
    let sum = |f: fn(&hc_app::reports::DayRow) -> i64| m.days.iter().map(f).sum::<i64>();
    assert_eq!(sum(|d| d.cash_paise), m.total.cash_paise);
    assert_eq!(sum(|d| d.upi_paise), m.total.upi_paise);
    assert_eq!(sum(|d| d.card_paise), m.total.card_paise);
    assert_eq!(sum(|d| d.other_paise), m.total.other_paise);
    assert_eq!(sum(|d| d.count), m.total.count);
    assert_eq!(sum(|d| d.total_paise), m.total.total_paise);
}

/// Bug caught: February / leap years get the wrong number of days.
#[test]
fn monthly_summary_handles_february_and_leap_years() {
    let (_d, pool) = fixture();
    let clock = FixedClock;
    let svc = ReportService::new(&clock);
    assert_eq!(
        svc.monthly_summary(
            &pool,
            MonthlySummaryRequest {
                month: "2027-02".into()
            }
        )
        .unwrap()
        .days
        .len(),
        28
    );
    assert_eq!(
        svc.monthly_summary(
            &pool,
            MonthlySummaryRequest {
                month: "2028-02".into()
            }
        )
        .unwrap()
        .days
        .len(),
        29
    );
    for bad in ["2026-13", "2026-1", "", "2026-10-01"] {
        let r = svc.monthly_summary(&pool, MonthlySummaryRequest { month: bad.into() });
        match r {
            Err(e) => assert_eq!(map_error(&e).code, ErrorCode::Validation, "{bad:?}"),
            Ok(_) => panic!("{bad:?} must be refused"),
        }
    }
}

// ---------------------------------------------------------------------------
// Export (file only; no DB write; no patient data)
// ---------------------------------------------------------------------------

fn export(
    pool: &Pool,
    dir: &std::path::Path,
    report: ReportSpec,
    format: ExportFormat,
) -> hc_app::reports::ReportExportResult {
    let clock = FixedClock;
    ReportService::new(&clock)
        .export_to(pool, dir, ReportExportRequest { report, format })
        .expect("export")
}

/// Bug caught: the daily CSV has the wrong name, misses the BOM/CRLF, puts the
/// rows in a different order, or omits the outstanding line (§10 layout).
#[test]
fn export_daily_csv_writes_the_s16_layout() {
    let (_d, pool) = fixture();
    let out = tempfile::tempdir().unwrap();
    let before = audits(&pool);
    let r = export(
        &pool,
        out.path(),
        ReportSpec::Daily {
            date: "2026-10-16".into(),
        },
        ExportFormat::Csv,
    );
    assert!(r.saved);
    assert_eq!(
        r.file_name.as_deref(),
        Some("collection-daily-2026-10-16.csv")
    );
    assert_eq!(r.row_count, 4, "the 4 mode rows");
    assert_eq!(audits(&pool), before, "a read export writes no audit row");

    let bytes =
        std::fs::read(out.path().join("collection-daily-2026-10-16.csv")).expect("file written");
    let text = String::from_utf8(bytes).unwrap();
    let body = text.strip_prefix('\u{feff}').expect("UTF-8 BOM");
    let lines: Vec<&str> = body.trim_end_matches("\r\n").split("\r\n").collect();
    assert!(
        lines[0].contains("Daily collection") && lines[0].contains("16-10-2026"),
        "title: {:?}",
        lines[0]
    );
    assert_eq!(
        &lines[1..7],
        &[
            "Mode,Payments,Amount (Rs)",
            "Cash,2,250.00",
            "UPI,1,100.00",
            "Card,0,0.00",
            "Other,0,0.00",
            "TOTAL,3,350.00",
        ]
    );
    assert!(
        lines.iter().any(
            |l| l.starts_with("Outstanding on bills issued this day") && l.ends_with(",132.50")
        ),
        "outstanding line: {lines:?}"
    );
    assert!(
        !text.contains("Test Patient"),
        "aggregates only, no patient names"
    );
}

/// Bug caught: the monthly CSV misses days or the TOTAL row, or uses ISO dates.
#[test]
fn export_monthly_csv_has_a_row_per_day_and_a_total() {
    let (_d, pool) = fixture();
    let out = tempfile::tempdir().unwrap();
    let r = export(
        &pool,
        out.path(),
        ReportSpec::Monthly {
            month: "2026-10".into(),
        },
        ExportFormat::Csv,
    );
    assert_eq!(
        r.file_name.as_deref(),
        Some("collection-monthly-2026-10.csv")
    );
    assert_eq!(r.row_count, 31);
    let text = std::fs::read_to_string(out.path().join("collection-monthly-2026-10.csv")).unwrap();
    let lines: Vec<&str> = text
        .trim_start_matches('\u{feff}')
        .trim_end_matches("\r\n")
        .split("\r\n")
        .collect();
    let header = lines
        .iter()
        .position(|l| *l == "Date,Cash (Rs),UPI (Rs),Card (Rs),Other (Rs),Payments,Total (Rs)")
        .expect("header");
    assert_eq!(lines[header + 1], "01-10-2026,0.00,0.00,0.00,0.00,0,0.00");
    assert_eq!(
        lines[header + 16],
        "16-10-2026,250.00,100.00,0.00,0.00,3,350.00"
    );
    assert_eq!(
        lines[header + 31],
        "31-10-2026,0.00,0.00,0.00,40.00,1,40.00"
    );
    assert_eq!(
        lines[header + 32],
        "TOTAL,260.00,100.00,0.00,40.00,5,400.00"
    );
}

/// Bug caught: "Export Excel" writes a CSV, an empty file, or the wrong name.
#[test]
fn export_monthly_xlsx_writes_a_workbook() {
    let (_d, pool) = fixture();
    let out = tempfile::tempdir().unwrap();
    let r = export(
        &pool,
        out.path(),
        ReportSpec::Monthly {
            month: "2026-10".into(),
        },
        ExportFormat::Xlsx,
    );
    assert_eq!(
        r.file_name.as_deref(),
        Some("collection-monthly-2026-10.xlsx")
    );
    let bytes = std::fs::read(out.path().join("collection-monthly-2026-10.xlsx")).unwrap();
    assert!(bytes.len() > 100 && bytes.starts_with(b"PK"), "xlsx zip");
}

/// Bug caught: a second export overwrites the first file the doctor already
/// sent to the CA.
#[test]
fn export_never_overwrites_and_adds_a_numbered_suffix() {
    let (_d, pool) = fixture();
    let out = tempfile::tempdir().unwrap();
    let first = out.path().join("collection-daily-2026-10-16.csv");
    std::fs::write(&first, b"doctor's copy").unwrap();
    let r = export(
        &pool,
        out.path(),
        ReportSpec::Daily {
            date: "2026-10-16".into(),
        },
        ExportFormat::Csv,
    );
    assert_eq!(
        r.file_name.as_deref(),
        Some("collection-daily-2026-10-16 (2).csv")
    );
    assert_eq!(
        std::fs::read(&first).unwrap(),
        b"doctor's copy",
        "existing file untouched"
    );
    assert!(out
        .path()
        .join("collection-daily-2026-10-16 (2).csv")
        .exists());
}

/// Bug caught: an unwritable folder surfaces a raw OS error / path to the UI.
#[test]
fn export_to_an_unwritable_folder_is_export_failed_without_a_path() {
    let (_d, pool) = fixture();
    let out = tempfile::tempdir().unwrap();
    let missing = out.path().join("no-such-folder");
    let clock = FixedClock;
    let r = ReportService::new(&clock).export_to(
        &pool,
        &missing,
        ReportExportRequest {
            report: ReportSpec::Daily {
                date: "2026-10-16".into(),
            },
            format: ExportFormat::Csv,
        },
    );
    match r {
        Err(e) => {
            let u = map_error(&e);
            assert_eq!(u.code, ErrorCode::ExportFailed);
            assert!(
                !u.message.contains("no-such-folder"),
                "no path in the message"
            );
        }
        Ok(v) => panic!("expected ExportFailed, got {v:?}"),
    }
}
