//! RED tests for the M2-D SEARCH / LIST use-case service methods
//! (HC-MVP1-050/051/052, PSR-001..008, PSR-012). CUT:
//! `hc_app::patient::PatientService::{patient_search, patient_recent,
//! touch_recent, list_query, list_export_csv}` and the `hc_storage::patient`
//! repositories + migration 0007 they drive.
//!
//! The ONLY fakes are DEPENDENCIES (R-TEST-002): the encrypted-file keystore
//! with a REAL wrapped DEK (`KeyHierarchy::initialize`), a deterministic
//! `FakeClock` (R-TEST-006), and the real `hc_search` engine + real DB. No CUT
//! is faked. Synthetic data only (R-TEST-004). Names carry the req id
//! (R-TEST-008). Each test asserts resulting data (R-TEST-003), not `is_ok()`.
//!
//! Red-first: the search/list service methods do not exist yet, so this fails
//! to compile against the absent CUT; once `hc-core-dev` implements them to the
//! contract below, the assertions are what must hold.

use hc_app::clock::Clock;
use hc_app::patient::{
    CreatePatientRequest, GetDashboardRequest, ListExportCsvRequest, ListQueryRequest,
    PatientFilter, PatientSort, RecentRequest, SearchRequest, SortDir, SortField,
    TouchRecentRequest,
};

use hc_storage::key::KeyHierarchy;
use hc_storage::keystore::FileKeystore;
use hc_storage::Pool;

/// Deterministic clock (dependency fake, R-TEST-006).
struct FakeClock {
    now: std::sync::Mutex<String>,
}
impl FakeClock {
    fn at(now: &str) -> Self {
        FakeClock {
            now: std::sync::Mutex::new(now.to_string()),
        }
    }
    /// Advance the clock to a new fixed instant (for recency ordering tests).
    fn set(&self, now: &str) {
        *self.now.lock().unwrap() = now.to_string();
    }
}
impl Clock for FakeClock {
    fn now_rfc3339(&self) -> String {
        self.now.lock().unwrap().clone()
    }
}

const TEST_PIN: &str = "2468";

/// Build the real unlock path: file keystore with a REAL DEK, encrypted DB
/// migrated through the latest migration, and the owning temp dirs.
fn env() -> (tempfile::TempDir, tempfile::TempDir, FileKeystore, Pool) {
    let ks_dir = tempfile::tempdir().expect("keystore dir");
    let data_dir = tempfile::tempdir().expect("data dir");
    let keystore = FileKeystore::open(ks_dir.path()).expect("open file keystore");

    let (_recovery, dek) = KeyHierarchy::new(&keystore)
        .initialize(TEST_PIN)
        .expect("mint DEK");
    let pool = Pool::open(&data_dir.path().join("clinic.db"), &dek).expect("open encrypted DB");
    hc_storage::migrate::run(&pool).expect("run migrations (through 0007)");

    (ks_dir, data_dir, keystore, pool)
}

/// A minimal valid create request with the demographic fields the list/search
/// rows read. `age_years` drives the age filter; `city` + `sex` the facets.
fn patient(name: &str, sex: &str, city: &str, age: i64, mobile: &str) -> CreatePatientRequest {
    CreatePatientRequest {
        name: name.to_string(),
        sex: Some(sex.to_string()),
        age_years: Some(age),
        mobile: Some(mobile.to_string()),
        city: Some(city.to_string()),
        ..Default::default()
    }
}

// ---------------------------------------------------------------------------
// patient_search (HC-MVP1-050, PSR-001..004, PSR-012).
// ---------------------------------------------------------------------------

/// PSR-001/002 (R-TEST-008): a name-prefix query returns the matching patient
/// as an enriched SearchRow carrying the demographics the S04 row shows.
#[test]
fn psr050_search_returns_enriched_ranked_rows_for_a_name_prefix() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(
        &pool,
        patient("Ramesh Kumar", "M", "Pune", 34, "+91 98765 43210"),
    )
    .expect("create");

    let resp = svc
        .patient_search(
            &pool,
            SearchRequest {
                query: "ram ku".to_string(),
                limit: 20,
                cursor: None,
            },
        )
        .expect("search");

    let hit = resp
        .results
        .iter()
        .find(|r| r.name == "Ramesh Kumar")
        .expect("name-prefix query must find 'Ramesh Kumar' (PSR-002)");
    assert_eq!(hit.city.as_deref(), Some("Pune"), "row carries city (S04)");
    assert_eq!(hit.sex.as_deref(), Some("M"), "row carries sex (S04)");
    // MVP1 single doctor: full mobile, NO masking (PSR-005 open-Q).
    assert_eq!(
        hit.mobile.as_deref(),
        Some("+91 98765 43210"),
        "mobile is the FULL number in MVP1 (PSR-005 open-Q, no masking)"
    );
    assert_eq!(hit.dues_paise, 0, "dues are 0 for R2 (R-DEL-002)");
    assert!(
        !hit.match_type.is_empty(),
        "every row carries a match_type tag for the ranking display (PSR-004)"
    );
}

/// PSR-003/PSR-004 (R-TEST-008): a phonetic misspelling finds the patient and
/// an exact-name match ranks ABOVE the phonetic one. Catches exact-only search
/// and a ranking that puts phonetic first.
#[test]
fn psr050_search_matches_phonetic_variant_and_exact_ranks_above_phonetic() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    // Two patients whose phonetic key collides; query matches one exactly.
    svc.create(
        &pool,
        patient("Lakshmi Narayan", "F", "Pune", 40, "90000 00001"),
    )
    .expect("create exact");
    svc.create(
        &pool,
        patient("Laxmi Narain", "F", "Nashik", 42, "90000 00002"),
    )
    .expect("create phonetic variant");

    let resp = svc
        .patient_search(
            &pool,
            SearchRequest {
                query: "Lakshmi Narayan".to_string(),
                limit: 20,
                cursor: None,
            },
        )
        .expect("search");

    let exact_pos = resp
        .results
        .iter()
        .position(|r| r.name == "Lakshmi Narayan")
        .expect("exact name must be found");
    let variant_pos = resp
        .results
        .iter()
        .position(|r| r.name == "Laxmi Narain")
        .expect("phonetic variant must also be found (PSR-003)");
    assert!(
        exact_pos < variant_pos,
        "exact name must rank above the phonetic variant (PSR-004)"
    );
}

/// PSR-002 (R-TEST-008): the last digits of a mobile find the patient (digit
/// search, +91/spaces ignored). Catches a search that only matches names.
#[test]
fn psr050_search_finds_by_mobile_digits() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    let created = svc
        .create(
            &pool,
            patient("Asha Patil", "F", "Pune", 28, "+91 91234 56789"),
        )
        .expect("create");

    let resp = svc
        .patient_search(
            &pool,
            SearchRequest {
                query: "56789".to_string(),
                limit: 20,
                cursor: None,
            },
        )
        .expect("search by mobile digits");
    assert!(
        resp.results
            .iter()
            .any(|r| r.patient_id == created.patient_id),
        "mobile-digit query must find the patient (PSR-002)"
    );
}

// ---------------------------------------------------------------------------
// patient_recent (HC-MVP1-050, PSR-007).
// ---------------------------------------------------------------------------

/// PSR-007 (R-TEST-008): opening a patient's dashboard records it in the recent
/// list, most-recent first. Catches a dashboard that does not track opens and a
/// recent list in the wrong order.
#[test]
fn psr050_recent_returns_last_opened_most_recent_first() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T09:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    let a = svc
        .create(&pool, patient("Patient A", "M", "Pune", 30, "90000 00001"))
        .expect("create A");
    let b = svc
        .create(&pool, patient("Patient B", "F", "Pune", 31, "90000 00002"))
        .expect("create B");

    // Open A first, then B later: B must come first in the recent list.
    clock.set("2026-02-01T10:00:00Z");
    svc.get_dashboard(
        &pool,
        GetDashboardRequest {
            patient_id: a.patient_id.clone(),
        },
    )
    .expect("open A");
    clock.set("2026-02-01T11:00:00Z");
    svc.get_dashboard(
        &pool,
        GetDashboardRequest {
            patient_id: b.patient_id.clone(),
        },
    )
    .expect("open B");

    let resp = svc
        .patient_recent(&pool, RecentRequest { limit: 20 })
        .expect("recent");
    assert_eq!(
        resp.results.first().map(|r| r.patient_id.as_str()),
        Some(b.patient_id.as_str()),
        "the most recently opened patient (B) is first (PSR-007)"
    );
    assert!(
        resp.results.iter().any(|r| r.patient_id == a.patient_id),
        "the earlier-opened patient (A) is still in the recent list (PSR-007)"
    );
}

/// PSR-007 (R-TEST-008): re-opening a patient moves it to the front without
/// duplicating it. Catches a recent list that grows a duplicate per open.
#[test]
fn psr050_recent_dedupes_and_promotes_on_reopen() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T09:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    let a = svc
        .create(&pool, patient("Patient A", "M", "Pune", 30, "90000 00001"))
        .expect("create A");
    let b = svc
        .create(&pool, patient("Patient B", "F", "Pune", 31, "90000 00002"))
        .expect("create B");

    svc.touch_recent(
        &pool,
        TouchRecentRequest {
            patient_id: a.patient_id.clone(),
        },
    )
    .expect("touch A");
    clock.set("2026-02-01T09:05:00Z");
    svc.touch_recent(
        &pool,
        TouchRecentRequest {
            patient_id: b.patient_id.clone(),
        },
    )
    .expect("touch B");
    clock.set("2026-02-01T09:10:00Z");
    svc.touch_recent(
        &pool,
        TouchRecentRequest {
            patient_id: a.patient_id.clone(),
        },
    )
    .expect("re-touch A");

    let resp = svc
        .patient_recent(&pool, RecentRequest { limit: 20 })
        .expect("recent");
    assert_eq!(
        resp.results.first().map(|r| r.patient_id.as_str()),
        Some(a.patient_id.as_str()),
        "re-opening A promotes it to the front (PSR-007)"
    );
    let a_count = resp
        .results
        .iter()
        .filter(|r| r.patient_id == a.patient_id)
        .count();
    assert_eq!(a_count, 1, "A appears exactly once (no duplicate, PSR-007)");
}

// ---------------------------------------------------------------------------
// patient_list_query (HC-MVP1-052, PSR-008) — R2 filters only.
// ---------------------------------------------------------------------------

/// PSR-008 (R-TEST-008): the sex filter returns only matching patients. Catches
/// a facet that is parsed but not applied.
#[test]
fn psr052_list_query_filters_by_sex() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(&pool, patient("Male One", "M", "Pune", 30, "90000 00001"))
        .expect("create");
    svc.create(&pool, patient("Female One", "F", "Pune", 31, "90000 00002"))
        .expect("create");

    let resp = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter {
                    sex: Some("F".to_string()),
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
        .expect("list query");
    assert!(
        !resp.rows.is_empty() && resp.rows.iter().all(|r| r.sex.as_deref() == Some("F")),
        "the sex filter returns only F patients (PSR-008)"
    );
}

/// PSR-008 (R-TEST-008): the age range + city filters AND together. Catches a
/// filter set that ORs instead of ANDing, or an age filter that is ignored.
#[test]
fn psr052_list_query_filters_by_age_range_and_city_anded() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(
        &pool,
        patient("In Range Pune", "M", "Pune", 35, "90000 00001"),
    )
    .expect("create");
    svc.create(
        &pool,
        patient("In Range Nashik", "M", "Nashik", 35, "90000 00002"),
    )
    .expect("create");
    svc.create(
        &pool,
        patient("Too Young Pune", "M", "Pune", 10, "90000 00003"),
    )
    .expect("create");

    let resp = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter {
                    age_min: Some(30),
                    age_max: Some(40),
                    city: Some("Pune".to_string()),
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
        .expect("list query");
    let names: Vec<&str> = resp.rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["In Range Pune"],
        "age 30-40 AND city=Pune returns exactly the one matching patient (PSR-008)"
    );
}

/// PSR-008 (R-TEST-008): sort by name ascending orders the rows. Catches an
/// unsorted result.
#[test]
fn psr052_list_query_sorts_by_name_ascending() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(&pool, patient("Charlie", "M", "Pune", 30, "90000 00001"))
        .expect("create");
    svc.create(&pool, patient("Alice", "F", "Pune", 31, "90000 00002"))
        .expect("create");
    svc.create(&pool, patient("Bob", "M", "Pune", 32, "90000 00003"))
        .expect("create");

    let resp = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter::default(),
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
                cursor: None,
                limit: 20,
            },
        )
        .expect("list query");
    let names: Vec<&str> = resp.rows.iter().map(|r| r.name.as_str()).collect();
    assert_eq!(
        names,
        vec!["Alice", "Bob", "Charlie"],
        "rows are sorted by name ascending (PSR-008)"
    );
}

/// PSR-008 / R-DATA-007 (R-TEST-008): results keyset-paginate with no OFFSET —
/// page 1 then page 2 (via the returned cursor) cover all rows with no overlap.
/// Catches a missing cursor and a page that repeats rows.
#[test]
fn psr052_list_query_keyset_pages_without_overlap() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    for i in 0..5 {
        svc.create(
            &pool,
            patient(
                &format!("Patient {i:02}"),
                "M",
                "Pune",
                30 + i,
                &format!("9000000{i:03}"),
            ),
        )
        .expect("create");
    }

    let page1 = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter::default(),
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
                cursor: None,
                limit: 2,
            },
        )
        .expect("page 1");
    assert_eq!(page1.rows.len(), 2, "page 1 holds the requested 2 rows");
    let cursor = page1
        .next_cursor
        .clone()
        .expect("a further page exists, so a cursor is returned (R-DATA-007)");

    let page2 = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter::default(),
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
                cursor: Some(cursor),
                limit: 2,
            },
        )
        .expect("page 2");

    let p1: std::collections::HashSet<&str> =
        page1.rows.iter().map(|r| r.patient_id.as_str()).collect();
    let overlap = page2
        .rows
        .iter()
        .any(|r| p1.contains(r.patient_id.as_str()));
    assert!(
        !overlap,
        "page 2 must not repeat any row from page 1 (keyset, no OFFSET, R-DATA-007)"
    );
}

/// PSR-008 / R-DEL-002 (R-TEST-008): `dues_positive=true` matches NOTHING at R2
/// (balance_paise is always 0; billing is R5). Catches a dues filter that
/// fabricates matches.
#[test]
fn psr052_list_query_dues_positive_matches_nothing_at_r2() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(&pool, patient("Patient A", "M", "Pune", 30, "90000 00001"))
        .expect("create");

    let resp = svc
        .list_query(
            &pool,
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
        .expect("list query");
    assert!(
        resp.rows.is_empty(),
        "dues>0 matches nothing at R2 (billing is R5, R-DEL-002)"
    );
}

/// A soft-deleted patient must not appear in the list (PSR-008 reads live rows).
#[test]
fn psr052_list_query_excludes_soft_deleted() {
    use hc_app::patient::SoftDeleteRequest;
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    let kept = svc
        .create(&pool, patient("Kept", "M", "Pune", 30, "90000 00001"))
        .expect("create kept");
    let gone = svc
        .create(&pool, patient("Gone", "M", "Pune", 31, "90000 00002"))
        .expect("create gone");
    svc.soft_delete(
        &pool,
        SoftDeleteRequest {
            patient_id: gone.patient_id.clone(),
        },
    )
    .expect("soft delete");

    let resp = svc
        .list_query(
            &pool,
            ListQueryRequest {
                filters: PatientFilter::default(),
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
                cursor: None,
                limit: 20,
            },
        )
        .expect("list query");
    let ids: Vec<&str> = resp.rows.iter().map(|r| r.patient_id.as_str()).collect();
    assert!(
        ids.contains(&kept.patient_id.as_str()),
        "the live row is listed"
    );
    assert!(
        !ids.contains(&gone.patient_id.as_str()),
        "a soft-deleted row is excluded from the list (PSR-008)"
    );
}

// ---------------------------------------------------------------------------
// patient_list_export_csv (HC-MVP1-052, PSR-011).
// ---------------------------------------------------------------------------

/// PSR-011 (R-TEST-008): export writes a CSV file holding the current filtered,
/// sorted list with a header row and one data row per patient. Catches an
/// export that writes nothing or ignores the filter/sort.
#[test]
fn psr052_export_csv_writes_the_filtered_sorted_list() {
    let (_ks, data_dir, keystore, pool) = env();
    let clock = FakeClock::at("2026-02-01T00:00:00Z");
    let svc = hc_app::patient::PatientService::new(&keystore, &clock, data_dir.path());

    svc.create(&pool, patient("Alice", "F", "Pune", 31, "90000 00002"))
        .expect("create");
    svc.create(&pool, patient("Bob", "M", "Nashik", 32, "90000 00003"))
        .expect("create");

    let resp = svc
        .list_export_csv(
            &pool,
            ListExportCsvRequest {
                filters: PatientFilter {
                    city: Some("Pune".to_string()),
                    ..Default::default()
                },
                sort: PatientSort {
                    field: SortField::Name,
                    dir: SortDir::Asc,
                },
            },
        )
        .expect("export csv");

    let body = std::fs::read_to_string(&resp.file_path).expect("CSV file must exist");
    let lines: Vec<&str> = body.lines().collect();
    assert!(
        lines.first().map(|h| h.contains("name")).unwrap_or(false),
        "the CSV has a header row naming the columns (PSR-011)"
    );
    assert!(
        body.contains("Alice"),
        "the Pune patient is in the exported CSV (PSR-011)"
    );
    assert!(
        !body.contains("Bob"),
        "a non-matching (Nashik) patient is NOT in the filtered export (PSR-011)"
    );
}
