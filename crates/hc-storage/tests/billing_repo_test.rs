//! R5 billing repository tests (BILL-001..004; R5 design §2, §5, §13 T-SEQ,
//! T-DUES, T-REPORT).
//!
//! CUT: the REAL `hc_storage::billing` functions over a REAL migrated
//! SQLCipher temp DB (`hc_storage::testing::temp_db`). No fakes besides the
//! DB itself. Synthetic data only (R-TEST-004). RED until hc-data-dev replaces
//! the §13 stub bodies.

use hc_storage::billing::{
    collection_by_day_mode, collection_by_mode, get_invoice, insert_invoice, insert_payment,
    live_invoice_for_visit, next_receipt_seq, open_invoices_for_patient, outstanding_issued_on,
    payments_for_invoice, refresh_invoice_paid, refresh_patient_balance, update_invoice_header,
    void_invoice, void_payment, DayModeTotal, InvoiceLineRow, InvoiceRow, ModeTotal, PaymentRow,
};
use hc_storage::testing::{insert_visit_for, seed_patient, temp_db};
use hc_storage::Pool;

const NOW: &str = "2026-10-16T05:00:00Z";

fn seq(pool: &Pool, fy: &str) -> i64 {
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let n = next_receipt_seq(&tx, fy, NOW)?;
        tx.commit()?;
        Ok(n)
    })
    .expect("next_receipt_seq")
}

/// An issued invoice row with one line of `total` paise, nothing paid.
fn invoice(id: &str, pid: &str, vid: &str, s: i64, issued_on: &str, total: i64) -> InvoiceRow {
    InvoiceRow {
        id: id.to_string(),
        patient_id: pid.to_string(),
        visit_id: Some(vid.to_string()),
        fy: "2026-27".to_string(),
        seq: s,
        number: format!("2026-27/{s:04}"),
        issued_on: issued_on.to_string(),
        issued_at: NOW.to_string(),
        status: "issued".to_string(),
        discount_kind: "none".to_string(),
        discount_value: 0,
        subtotal_paise: total,
        discount_paise: 0,
        total_paise: total,
        paid_paise: 0,
        balance_paise: total,
        gstin_snapshot: None,
        voided_at: None,
        void_reason: None,
        row_version: 0,
    }
}

fn one_line(inv: &str, total: i64) -> Vec<InvoiceLineRow> {
    vec![InvoiceLineRow {
        id: format!("{inv}-l0"),
        invoice_id: inv.to_string(),
        position: 0,
        kind: "consultation".to_string(),
        description: "Consultation (follow-up)".to_string(),
        qty: 1,
        rate_paise: total,
        amount_paise: total,
    }]
}

fn payment(id: &str, inv: &str, pid: &str, paid_on: &str, amount: i64, mode: &str) -> PaymentRow {
    PaymentRow {
        id: id.to_string(),
        invoice_id: inv.to_string(),
        patient_id: pid.to_string(),
        batch_id: None,
        paid_on: paid_on.to_string(),
        recorded_at: NOW.to_string(),
        amount_paise: amount,
        mode: mode.to_string(),
        reference: None,
        voided_at: None,
        void_reason: None,
    }
}

/// Insert an invoice, optional payments, refresh paid + patient dues; commit.
fn seed_invoice(pool: &Pool, inv: &InvoiceRow, pays: &[PaymentRow]) {
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        insert_invoice(&tx, inv, &one_line(&inv.id, inv.total_paise), NOW)?;
        for p in pays {
            insert_payment(&tx, p, NOW)?;
        }
        refresh_invoice_paid(&tx, &inv.id, NOW)?;
        refresh_patient_balance(&tx, &inv.patient_id, NOW)?;
        tx.commit()?;
        Ok(())
    })
    .expect("seed invoice");
}

fn patient_balance(pool: &Pool, pid: &str) -> i64 {
    pool.with_reader(|c| {
        Ok(c.query_row(
            "SELECT balance_paise FROM patient WHERE id = ?1",
            [pid],
            |r| r.get(0),
        )?)
    })
    .unwrap()
}

fn fixture() -> (tempfile::TempDir, Pool, String, String, String) {
    let (dir, pool) = temp_db();
    let pid = seed_patient(&pool, "HC-0001", "Test Patient R5");
    let v1 = insert_visit_for(&pool, &pid, "2026-10-15T05:00:00Z", None);
    let v2 = insert_visit_for(&pool, &pid, "2026-10-16T05:00:00Z", None);
    (dir, pool, pid, v1, v2)
}

// ---------------------------------------------------------------------------
// Receipt sequence (T-SEQ)
// ---------------------------------------------------------------------------

/// Bug caught: the counter does not start at 1, skips, or repeats.
#[test]
fn next_receipt_seq_counts_1_2_3_per_fy_and_restarts_for_a_new_fy() {
    let (_d, pool) = temp_db();
    assert_eq!(seq(&pool, "2026-27"), 1);
    assert_eq!(seq(&pool, "2026-27"), 2);
    assert_eq!(seq(&pool, "2026-27"), 3);
    assert_eq!(seq(&pool, "2027-28"), 1, "a new FY restarts at 1");
    assert_eq!(seq(&pool, "2026-27"), 4, "the old FY keeps counting");
}

/// Bug caught: a rolled-back issue (e.g. the save failed) burns a number,
/// leaving a gap in the receipt book.
#[test]
fn next_receipt_seq_is_gap_free_when_the_transaction_rolls_back() {
    let (_d, pool) = temp_db();
    assert_eq!(seq(&pool, "2026-27"), 1);
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let n = next_receipt_seq(&tx, "2026-27", NOW)?;
        assert_eq!(n, 2);
        drop(tx); // rollback
        Ok(())
    })
    .expect("rolled-back increment");
    assert_eq!(
        seq(&pool, "2026-27"),
        2,
        "the rolled-back number is reused, no gap"
    );
}

/// Bug caught: two writers racing on the counter get the same number
/// (the single writer + ON CONFLICT … RETURNING must serialise them).
#[test]
fn next_receipt_seq_never_repeats_across_threads() {
    let (_d, pool) = temp_db();
    let pool = std::sync::Arc::new(pool);
    let handles: Vec<_> = (0..4)
        .map(|_| {
            let p = pool.clone();
            std::thread::spawn(move || (0..10).map(|_| seq(&p, "2026-27")).collect::<Vec<_>>())
        })
        .collect();
    let mut all: Vec<i64> = handles
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect();
    all.sort_unstable();
    assert_eq!(
        all,
        (1..=40).collect::<Vec<_>>(),
        "40 distinct, gap-free numbers"
    );
}

// ---------------------------------------------------------------------------
// Invoice + payment + dues
// ---------------------------------------------------------------------------

/// Bug caught: paid/balance not recomputed from live payments, or the
/// patient's running dues not updated in the same transaction.
#[test]
fn refresh_paid_and_patient_balance_sum_live_payments_over_issued_invoices() {
    let (_d, pool, pid, v1, v2) = fixture();
    seed_invoice(
        &pool,
        &invoice("inv-a", &pid, &v1, 1, "2026-10-15", 35_000),
        &[payment(
            "pay-a1",
            "inv-a",
            &pid,
            "2026-10-15",
            20_000,
            "cash",
        )],
    );
    seed_invoice(
        &pool,
        &invoice("inv-b", &pid, &v2, 2, "2026-10-16", 15_000),
        &[],
    );

    let a = pool
        .with_reader(|c| get_invoice(c, "inv-a"))
        .unwrap()
        .unwrap();
    assert_eq!((a.paid_paise, a.balance_paise), (20_000, 15_000));
    assert_eq!(
        patient_balance(&pool, &pid),
        30_000,
        "15,000 + 15,000 across invoices"
    );
}

/// Bug caught: a voided payment still counts as paid; a voided invoice still
/// counts towards dues; the void loses the receipt number.
#[test]
fn void_payment_and_void_invoice_update_balances_and_keep_the_number() {
    let (_d, pool, pid, v1, v2) = fixture();
    seed_invoice(
        &pool,
        &invoice("inv-a", &pid, &v1, 1, "2026-10-15", 35_000),
        &[payment(
            "pay-a1",
            "inv-a",
            &pid,
            "2026-10-15",
            20_000,
            "cash",
        )],
    );
    seed_invoice(
        &pool,
        &invoice("inv-b", &pid, &v2, 2, "2026-10-16", 15_000),
        &[payment("pay-b1", "inv-b", &pid, "2026-10-16", 5_000, "upi")],
    );

    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let voided = void_payment(&tx, "pay-a1", "Entered twice", NOW)?;
        assert!(voided.voided_at.is_some());
        refresh_invoice_paid(&tx, "inv-a", NOW)?;
        refresh_patient_balance(&tx, &pid, NOW)?;
        tx.commit()?;
        Ok(())
    })
    .unwrap();
    assert_eq!(patient_balance(&pool, &pid), 35_000 + 10_000);

    pool.with_writer(|c| {
        let tx = c.transaction()?;
        let ids = void_invoice(&tx, "inv-b", "Wrong patient", NOW)?;
        assert_eq!(
            ids,
            vec!["pay-b1".to_string()],
            "its live payment is voided too"
        );
        refresh_patient_balance(&tx, &pid, NOW)?;
        tx.commit()?;
        Ok(())
    })
    .unwrap();
    let b = pool
        .with_reader(|c| get_invoice(c, "inv-b"))
        .unwrap()
        .unwrap();
    assert_eq!(b.status, "void");
    assert_eq!(b.number, "2026-27/0002", "void keeps its number");
    assert_eq!(b.void_reason.as_deref(), Some("Wrong patient"));
    assert_eq!(
        patient_balance(&pool, &pid),
        35_000,
        "void invoice drops out of dues"
    );

    let pays = pool
        .with_reader(|c| payments_for_invoice(c, "inv-b"))
        .unwrap();
    assert_eq!(pays.len(), 1, "voided payments stay listed");
    assert!(pays[0].voided_at.is_some());
    assert!(pool
        .with_reader(|c| live_invoice_for_visit(c, &v2))
        .unwrap()
        .is_none());
}

/// Bug caught: a stale editor overwrites a newer save (lost update).
#[test]
fn update_invoice_header_refuses_a_stale_row_version_and_changes_nothing() {
    let (_d, pool, pid, v1, _v2) = fixture();
    let inv = invoice("inv-a", &pid, &v1, 1, "2026-10-15", 35_000);
    seed_invoice(&pool, &inv, &[]);

    let mut edited = inv.clone();
    edited.discount_kind = "amount".into();
    edited.discount_value = 5_000;
    edited.discount_paise = 5_000;
    edited.total_paise = 30_000;
    edited.balance_paise = 30_000;
    let r = pool.with_writer(|c| {
        let tx = c.transaction()?;
        update_invoice_header(&tx, &edited, 7, NOW)?;
        tx.commit()?;
        Ok(())
    });
    assert!(r.is_err(), "stale row_version must be refused");
    let now = pool
        .with_reader(|c| get_invoice(c, "inv-a"))
        .unwrap()
        .unwrap();
    assert_eq!(now.total_paise, 35_000, "row unchanged");
}

/// Bug caught: Clear dues allocates newest-first, or includes paid / void
/// invoices.
#[test]
fn open_invoices_for_patient_are_oldest_first_and_exclude_paid_and_void() {
    let (_d, pool, pid, v1, v2) = fixture();
    let v3 = insert_visit_for(&pool, &pid, "2026-10-17T05:00:00Z", None);
    let v4 = insert_visit_for(&pool, &pid, "2026-10-18T05:00:00Z", None);
    // Inserted newest first on purpose.
    seed_invoice(
        &pool,
        &invoice("inv-new", &pid, &v4, 4, "2026-10-18", 4_000),
        &[],
    );
    seed_invoice(
        &pool,
        &invoice("inv-paid", &pid, &v3, 3, "2026-10-17", 3_000),
        &[payment("pp", "inv-paid", &pid, "2026-10-17", 3_000, "cash")],
    );
    seed_invoice(
        &pool,
        &invoice("inv-old", &pid, &v1, 1, "2026-10-15", 1_000),
        &[],
    );
    seed_invoice(
        &pool,
        &invoice("inv-void", &pid, &v2, 2, "2026-10-16", 2_000),
        &[],
    );
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        void_invoice(&tx, "inv-void", "Test", NOW)?;
        tx.commit()?;
        Ok(())
    })
    .unwrap();

    let open = pool
        .with_reader(|c| open_invoices_for_patient(c, &pid, 500))
        .unwrap();
    let ids: Vec<&str> = open.iter().map(|i| i.id.as_str()).collect();
    assert_eq!(ids, vec!["inv-old", "inv-new"]);
}

// ---------------------------------------------------------------------------
// Reports reads (T-REPORT)
// ---------------------------------------------------------------------------

/// Bug caught: daily collection groups by issue date instead of payment date,
/// counts voided payments, or mixes in other days.
#[test]
fn collection_by_mode_sums_live_payments_of_that_paid_on_day_only() {
    let (_d, pool, pid, v1, v2) = fixture();
    seed_invoice(
        &pool,
        &invoice("inv-a", &pid, &v1, 1, "2026-10-15", 100_000),
        &[
            payment("p1", "inv-a", &pid, "2026-10-15", 10_000, "cash"), // other day
            payment("p2", "inv-a", &pid, "2026-10-16", 20_000, "cash"),
            payment("p3", "inv-a", &pid, "2026-10-16", 5_000, "cash"),
            payment("p4", "inv-a", &pid, "2026-10-16", 7_500, "upi"),
            payment("p5", "inv-a", &pid, "2026-10-16", 9_900, "card"), // voided below
        ],
    );
    seed_invoice(
        &pool,
        &invoice("inv-b", &pid, &v2, 2, "2026-10-16", 1_000),
        &[],
    );
    pool.with_writer(|c| {
        let tx = c.transaction()?;
        void_payment(&tx, "p5", "Mistake", NOW)?;
        refresh_invoice_paid(&tx, "inv-a", NOW)?;
        refresh_patient_balance(&tx, &pid, NOW)?;
        tx.commit()?;
        Ok(())
    })
    .unwrap();

    let mut got = pool
        .with_reader(|c| collection_by_mode(c, "2026-10-16"))
        .unwrap();
    got.sort_by(|a, b| a.mode.cmp(&b.mode));
    assert_eq!(
        got,
        vec![
            ModeTotal {
                mode: "cash".into(),
                count: 2,
                amount_paise: 25_000
            },
            ModeTotal {
                mode: "upi".into(),
                count: 1,
                amount_paise: 7_500
            },
        ]
    );

    // Outstanding on bills ISSUED on 2026-10-16 = inv-b only.
    assert_eq!(
        pool.with_reader(|c| outstanding_issued_on(c, "2026-10-16"))
            .unwrap(),
        1_000
    );
    // inv-a issued 10-15: 100,000 - 10,000 - 25,000 - 7,500 = 57,500.
    assert_eq!(
        pool.with_reader(|c| outstanding_issued_on(c, "2026-10-15"))
            .unwrap(),
        57_500
    );
}

/// Bug caught: the month range is off by one at either end.
#[test]
fn collection_by_day_mode_covers_the_inclusive_range() {
    let (_d, pool, pid, v1, _v2) = fixture();
    seed_invoice(
        &pool,
        &invoice("inv-a", &pid, &v1, 1, "2026-09-30", 100_000),
        &[
            payment("p0", "inv-a", &pid, "2026-09-30", 1_000, "cash"),
            payment("p1", "inv-a", &pid, "2026-10-01", 2_000, "cash"),
            payment("p2", "inv-a", &pid, "2026-10-01", 3_000, "upi"),
            payment("p3", "inv-a", &pid, "2026-10-31", 4_000, "other"),
            payment("p4", "inv-a", &pid, "2026-11-01", 5_000, "cash"),
        ],
    );
    let mut got = pool
        .with_reader(|c| collection_by_day_mode(c, "2026-10-01", "2026-10-31"))
        .unwrap();
    got.sort_by(|a, b| {
        (a.paid_on.as_str(), a.mode.as_str()).cmp(&(b.paid_on.as_str(), b.mode.as_str()))
    });
    assert_eq!(
        got,
        vec![
            DayModeTotal {
                paid_on: "2026-10-01".into(),
                mode: "cash".into(),
                count: 1,
                amount_paise: 2_000
            },
            DayModeTotal {
                paid_on: "2026-10-01".into(),
                mode: "upi".into(),
                count: 1,
                amount_paise: 3_000
            },
            DayModeTotal {
                paid_on: "2026-10-31".into(),
                mode: "other".into(),
                count: 1,
                amount_paise: 4_000
            },
        ]
    );
}
