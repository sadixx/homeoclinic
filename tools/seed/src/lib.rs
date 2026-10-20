#![forbid(unsafe_code)]
//! `hc-seed` — synthetic data generator for HomeoClinic (HC-MVP1-056, NFR-007).
//!
//! Produces realistic, SYNTHETIC Indian patient data (R-PRIV-001: no real
//! patient data, ever). Two modes:
//!   * [`GenMode::Fixture`] — a small, deterministic functional-regression
//!     fixture (>= [`FIXTURE_MIN_PATIENTS`], many diseases, PSR-003 name
//!     variants) that M2's register/search/dashboard/recycle features test
//!     against.
//!   * [`GenMode::Scale`]`(n)` — a scale dataset of `n` patients for the
//!     NFR-007 perf runs (50k / 100k). The actual 50k/100k generation and the
//!     NFR-002/size budgets run in the M2-perf slice (HC-MVP1-057), not here.
//!
//! Patients are inserted THROUGH the real hc-storage write path, so the
//! migration-0004 triggers keep `patient_fts` / `patient_trgm` in sync in the
//! same transaction (PSR-012, R-DATA-006) and a seeded patient is immediately
//! findable by [`hc_search::query::search`]. The four normalised columns are
//! computed with [`hc_search::normalize`] / [`hc_search::phonetic`] — never
//! ad-hoc — so seeded rows are byte-identical to the writer's output.
//!
//! Deterministic: identical `(seed, mode)` yields an identical patient set.
//!
//! CODE-LAYOUT: leaf tool, depends on hc-domain / hc-storage / hc-search only.

pub mod diseases;
pub mod names;

use std::io::Write;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

/// Minimum patient count for the functional fixture (USER REQUIREMENT: >= 200).
pub const FIXTURE_MIN_PATIENTS: usize = 200;

/// Default fixture size (>= [`FIXTURE_MIN_PATIENTS`], "~200-250").
pub const FIXTURE_DEFAULT_PATIENTS: usize = 240;

/// Patient code prefix; the numeric part is the PSR-002 code digits.
pub const CODE_PREFIX: &str = "HC-";

/// Fixed reference instant for deterministic DOB / last-visit maths (no wall
/// clock — reproducible in CI).
pub const REFERENCE_DATE: &str = "2026-01-01";

/// What to generate.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GenMode {
    /// Deterministic functional-regression fixture of `n` patients
    /// (`n >= FIXTURE_MIN_PATIENTS`), spanning every [`diseases::DISEASES`] and
    /// every [`names::NAME_VARIANT_FAMILIES`] entry.
    Fixture(usize),
    /// Scale dataset of exactly `n` patients for the NFR-007 perf runs.
    Scale(usize),
}

/// Fully-resolved generation request.
#[derive(Debug, Clone)]
pub struct GenConfig {
    /// Mode (fixture or scale).
    pub mode: GenMode,
    /// RNG seed. Identical seed + mode => identical patient set.
    pub seed: u64,
    /// Output DB path (the encrypted clinic.db to create / populate).
    pub out: PathBuf,
}

impl GenConfig {
    /// A fixture config with the default size.
    pub fn fixture(seed: u64, out: PathBuf) -> Self {
        GenConfig {
            mode: GenMode::Fixture(FIXTURE_DEFAULT_PATIENTS),
            seed,
            out,
        }
    }

    /// A scale config of `n` patients.
    pub fn scale(n: usize, seed: u64, out: PathBuf) -> Self {
        GenConfig {
            mode: GenMode::Scale(n),
            seed,
            out,
        }
    }

    /// Number of patients this config will generate.
    pub fn patient_count(&self) -> usize {
        match self.mode {
            GenMode::Fixture(n) => n,
            GenMode::Scale(n) => n,
        }
    }

    /// True for the functional fixture mode.
    pub fn is_fixture(&self) -> bool {
        matches!(self.mode, GenMode::Fixture(_))
    }
}

/// One synthetic patient as pure data, before insertion. The four normalised
/// columns are computed with hc-search so they match the writer's output
/// exactly (findability contract).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratedPatient {
    /// e.g. "HC-000001" (CODE_PREFIX + 6-digit zero-padded sequence).
    pub code: String,
    /// Display name (region pool + PSR-003 variant).
    pub name: String,
    /// `hc_search::normalize::name_norm(name)`.
    pub name_norm: String,
    /// `hc_search::phonetic::phonetic_key(name)`.
    pub name_phonetic: String,
    /// "+91 " + 10-digit number (first digit 6-9).
    pub mobile: String,
    /// `hc_search::normalize::mobile_digits(mobile)` (10 digits).
    pub mobile_digits: String,
    /// `hc_search::normalize::code_digits(code)`.
    pub code_digits: String,
    /// City (synthetic).
    pub city: String,
    /// RFC3339 date (YYYY-MM-DD).
    pub dob: String,
    /// Age in years (derived).
    pub age_years: u32,
    /// "M" | "F".
    pub sex: &'static str,
    /// One of [`diseases::DISEASES`].
    pub diagnosis: &'static str,
    /// Index into [`names::NAME_VARIANT_FAMILIES`] if the name came from a
    /// variant family, else `None` — lets a findability test search a different
    /// spelling of the same family.
    pub variant_family: Option<usize>,
    /// RFC3339 most-recent-visit timestamp (ranking ties / dashboard), or None.
    pub last_visit_at: Option<String>,
}

/// Errors from the generator.
#[derive(Debug, thiserror::Error)]
pub enum SeedError {
    /// hc-storage pool / migration failure.
    #[error("storage operation failed")]
    Storage(#[from] hc_storage::StorageError),
    /// Direct rusqlite failure (parameterised INSERT).
    #[error("database operation failed")]
    Db(#[from] rusqlite::Error),
    /// Invalid CLI / config (e.g. fixture below the minimum).
    #[error("invalid configuration: {0}")]
    Config(String),
    /// Writing the plaintext JSONL fixture failed (filesystem / serialisation).
    #[error("fixture export failed")]
    Export(#[from] std::io::Error),
}

/// Build the patient set deterministically from `cfg`, WITHOUT touching a DB.
///
/// Same `(seed, mode)` => identical `Vec` (count, codes, names, phonetic keys,
/// diagnosis, every field), so the fixture is reproducible and the determinism
/// test needs no IO.
///
/// Guarantees (asserted by tests at green):
/// - `len() == cfg.patient_count()`.
/// - codes unique + sequential: `CODE_PREFIX` + 6-digit zero-padded index.
/// - `name_norm` / `name_phonetic` / `mobile_digits` / `code_digits` equal the
///   hc-search functions applied to `name` / `mobile` / `code`.
/// - fixture mode: every [`diseases::DISEASES`] appears >= once and every
///   [`names::NAME_VARIANT_FAMILIES`] entry contributes >= one patient.
pub fn build_patients(cfg: &GenConfig) -> Vec<GeneratedPatient> {
    use rand::{rngs::StdRng, Rng, SeedableRng};

    let count = cfg.patient_count();
    // StdRng seeded from the config seed: deterministic and reproducible across
    // platforms for a given seed (determinism contract, NFR-007).
    let mut rng = StdRng::seed_from_u64(cfg.seed);

    // Reference date components for deterministic DOB / age maths (no wall
    // clock). REFERENCE_DATE is "YYYY-MM-DD"; we only need the year for age.
    let ref_year: i64 = REFERENCE_DATE
        .split('-')
        .next()
        .and_then(|y| y.parse().ok())
        .unwrap_or(2026);

    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        // Code is sequential + zero-padded => unique by construction (PSR-002).
        let code = format!("{CODE_PREFIX}{:06}", i + 1);

        // Sex: always draw a seed-driven coin so the RNG advance is identical
        // regardless of the forced-coverage case; then force the coverage-phase
        // patient at the FEMALE_ONLY diagnosis index to be female so the
        // round-robin can cover PCOS. FEMALE_ONLY is at a known index.
        let female_only_idx = diseases::DISEASES
            .iter()
            .position(|&d| d == diseases::FEMALE_ONLY);
        let coin_female = rng.gen_bool(0.5);
        let force_female = i < diseases::DISEASES.len() && Some(i) == female_only_idx;
        let sex: &'static str = if force_female || coin_female {
            "F"
        } else {
            "M"
        };

        let picked = names::pick_name(&mut rng, i);
        let name = picked.display;

        // Diagnosis per the coverage/weighted schedule (female-only honoured).
        let diagnosis = diseases::pick_diagnosis(&mut rng, i, sex);

        // Mobile: Indian 10-digit, first digit 6-9 (PSR-002 realistic). Stored
        // display form carries the +91 prefix and a space; mobile_digits folds
        // it back to the 10 national digits via hc-search.
        let first: u8 = rng.gen_range(6..=9);
        let mut rest = String::with_capacity(9);
        for _ in 0..9 {
            rest.push(char::from(b'0' + rng.gen_range(0..=9u8)));
        }
        let mobile = format!("+91 {first}{rest}");

        // City (synthetic, seed-driven).
        let city = names::CITIES[rng.gen_range(0..names::CITIES.len())].to_string();

        // Age 1..=90 years; DOB derived from the reference year (Jan 1 for a
        // stable, deterministic date — we only need a valid RFC3339 date).
        let age_years: u32 = rng.gen_range(1..=90);
        let birth_year = ref_year - age_years as i64;
        let dob = format!("{birth_year:04}-01-01");

        // Most-recent-visit: a deterministic date within the last ~3 years of
        // the reference year, or None for some patients (dashboard ties).
        let last_visit_at = if rng.gen_bool(0.85) {
            let yr = ref_year - rng.gen_range(0..=2);
            let month = rng.gen_range(1..=12u32);
            let day = rng.gen_range(1..=28u32);
            Some(format!("{yr:04}-{month:02}-{day:02}T09:00:00Z"))
        } else {
            None
        };

        // Normalised columns via hc-search ONLY (no duplication); seeded rows
        // are byte-identical to the real writer's output (findability).
        let name_norm = hc_search::normalize::name_norm(&name);
        let name_phonetic = hc_search::phonetic::phonetic_key(&name);
        let mobile_digits = hc_search::normalize::mobile_digits(&mobile);
        let code_digits = hc_search::normalize::code_digits(&code);

        out.push(GeneratedPatient {
            code,
            name,
            name_norm,
            name_phonetic,
            mobile,
            mobile_digits,
            code_digits,
            city,
            dob,
            age_years,
            sex,
            diagnosis,
            variant_family: picked.variant_family,
            last_visit_at,
        });
    }
    out
}

/// Fixed audit timestamp for seeded rows (no wall clock; R-TEST-006 spirit).
const SEED_ROW_TS: &str = "2026-01-01T00:00:00Z";

/// Insert every generated patient through the pool WRITER in ONE transaction,
/// so the migration-0004 triggers keep `patient_fts` / `patient_trgm` in sync
/// in the same transaction (PSR-012, R-DATA-006) and every seeded patient is
/// immediately findable. Parameterised INSERT only (R-SEC-001). Returns the
/// number of rows inserted.
fn insert_all(pool: &hc_storage::Pool, patients: &[GeneratedPatient]) -> Result<usize, SeedError> {
    let n = pool.with_writer(|c| {
        let tx = c.transaction()?;
        {
            // Prepared once, executed per patient: parameterised, bypasses no
            // trigger (the AFTER INSERT trigger fires inside this transaction).
            let mut stmt = tx.prepare(
                "INSERT INTO patient \
                   (id, code, name, name_norm, name_phonetic, sex, dob, age_years, \
                    mobile, mobile_digits, code_digits, city, diagnosis, \
                    last_visit_at, created_at, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)",
            )?;
            for p in patients {
                // UUIDv7 id (R-DATA-005). Non-deterministic by design (time +
                // random); the DETERMINISTIC contract is over build_patients,
                // not the DB row ids.
                let id = uuid::Uuid::now_v7().to_string();
                stmt.execute(rusqlite::params![
                    id,
                    p.code,
                    p.name,
                    p.name_norm,
                    p.name_phonetic,
                    p.sex,
                    p.dob,
                    p.age_years,
                    p.mobile,
                    p.mobile_digits,
                    p.code_digits,
                    p.city,
                    p.diagnosis,
                    p.last_visit_at,
                    SEED_ROW_TS,
                ])?;
            }
        }
        tx.commit()?;
        Ok(patients.len())
    })?;
    Ok(n)
}

/// Open (creating) the encrypted DB at `cfg.out` via the hc-storage pool with
/// the dev/test key, run all migrations (0001..=0005), then insert every
/// generated patient through the pool WRITER so the migration-0004 triggers
/// keep `patient_fts` / `patient_trgm` in sync in-transaction (PSR-012,
/// R-DATA-006). Returns the number of patients inserted.
///
/// Parameterised INSERT only (R-SEC-001). No patient data logged (R-PRIV-001).
pub fn generate_into_pool(cfg: &GenConfig) -> Result<usize, SeedError> {
    let (_pool, patients) = generate_and_open(cfg)?;
    // Counts only, never names (R-PRIV-001).
    tracing::info!(patients = patients.len(), "hc-seed generated patient set");
    Ok(patients.len())
}

/// Build + insert, returning the open pool and the generated rows so a caller
/// (or a test) can immediately search the DB and assert findability. Keeps the
/// pool alive for the caller.
pub fn generate_and_open(
    cfg: &GenConfig,
) -> Result<(hc_storage::Pool, Vec<GeneratedPatient>), SeedError> {
    // Fixture mode must honour the >= 200 minimum (USER REQUIREMENT).
    if let GenMode::Fixture(n) = cfg.mode {
        if n < FIXTURE_MIN_PATIENTS {
            return Err(SeedError::Config(format!(
                "fixture size {n} is below the minimum {FIXTURE_MIN_PATIENTS}"
            )));
        }
    }

    let patients = build_patients(cfg);

    // Dev/test key only — never a production key (task constraint). Open the
    // pool and run every migration (0001..=0005) so the patient + FTS schema
    // and the diagnosis column exist before inserting.
    let key = hc_storage::key::DevKeyProvider::new_test();
    let pool = hc_storage::Pool::open(&cfg.out, &key as &dyn hc_storage::key::KeyProvider)?;
    hc_storage::migrate::run(&pool)?;

    let inserted = insert_all(&pool, &patients)?;
    debug_assert_eq!(inserted, patients.len());

    Ok((pool, patients))
}

// ---------------------------------------------------------------------------
// Plaintext JSONL fixture export (OPTION A E2E seeding path).
// ---------------------------------------------------------------------------
//
// The provisioned, boot-gated app opens `clinic.db` with a RANDOM, PIN-derived
// DEK (`KeyHierarchy::initialize`), so a seed-produced SQLCipher DB keyed with
// the fixed dev/test key cannot be opened by it (keys differ). Instead of
// sharing keys (which would touch production key security), the seed emits a
// portable, UNENCRYPTED, line-delimited JSON dataset that the app imports
// through its real `patient_create` path (feature `e2e-test-keys`), so FTS /
// trigram / phonetic stay in sync and NO key sharing is needed.
//
// The file carries SYNTHETIC data only (R-PRIV-001): the same fields a doctor
// would type into the S06 register form. It is not encrypted because it holds
// no real patient data and is consumed only by the E2E harness.

/// One synthetic patient as a portable, plaintext fixture record: exactly the
/// subset of fields the app's `patient_create` use case accepts (S06 register
/// form). Serialised one-per-line as JSON (JSONL) so the app can stream-import
/// a large fixture without loading it all into memory.
///
/// Field names are camelCase to match the app's `CreatePatientRequest` wire
/// contract, so the importer can deserialise straight into it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixtureRecord {
    /// Display name (required; drives name_norm + phonetic on import).
    pub name: String,
    /// "M" | "F".
    pub sex: String,
    /// RFC3339 date of birth (YYYY-MM-DD).
    pub dob: String,
    /// Age in years (derived; carried so an import without a DOB still has age).
    pub age_years: u32,
    /// Mobile as entered ("+91 " + 10 digits).
    pub mobile: String,
    /// City (synthetic).
    pub city: String,
    /// Diagnosis (one of [`diseases::DISEASES`]); carried for coverage. Stored
    /// by the app as free-text in the alerts/notes-free register path is NOT
    /// applicable — the importer maps it onto the request's optional fields
    /// only where a column exists, so this is advisory for the fixture shape.
    pub diagnosis: String,
}

impl FixtureRecord {
    /// Build a fixture record from a generated patient. Lossy by design: only
    /// the register-form fields cross into the app (the normalised columns are
    /// recomputed by the real write path, never trusted from the file).
    pub fn from_generated(p: &GeneratedPatient) -> Self {
        FixtureRecord {
            name: p.name.clone(),
            sex: p.sex.to_string(),
            dob: p.dob.clone(),
            age_years: p.age_years,
            mobile: p.mobile.clone(),
            city: p.city.clone(),
            diagnosis: p.diagnosis.to_string(),
        }
    }
}

/// Serialise the fixture for `cfg` as JSONL (one [`FixtureRecord`] per line) to
/// `writer`, WITHOUT touching a DB or any key. Deterministic for a given
/// `(seed, mode)` because it is a pure function of [`build_patients`]. Returns
/// the number of records written.
///
/// This is the plaintext dataset the app imports through its real
/// `patient_create` path (OPTION A). No SQLCipher, no DEK: the file is
/// synthetic data only (R-PRIV-001).
pub fn export_fixture_jsonl<W: Write>(cfg: &GenConfig, writer: &mut W) -> Result<usize, SeedError> {
    // Honour the fixture minimum so the E2E always has >= 200 patients.
    if let GenMode::Fixture(n) = cfg.mode {
        if n < FIXTURE_MIN_PATIENTS {
            return Err(SeedError::Config(format!(
                "fixture size {n} is below the minimum {FIXTURE_MIN_PATIENTS}"
            )));
        }
    }

    let patients = build_patients(cfg);
    let mut written = 0usize;
    for p in &patients {
        let rec = FixtureRecord::from_generated(p);
        // serde_json::to_string never fails for this plain struct; map any
        // theoretical error onto an IO error rather than unwrapping (R-RUST-002).
        let line = serde_json::to_string(&rec).map_err(std::io::Error::other)?;
        writer.write_all(line.as_bytes())?;
        writer.write_all(b"\n")?;
        written += 1;
    }
    writer.flush()?;
    // Counts only, never names (R-PRIV-001).
    tracing::info!(records = written, "hc-seed exported JSONL fixture");
    Ok(written)
}

/// Write the JSONL fixture for `cfg` to the file at `path`, creating/truncating
/// it. Convenience over [`export_fixture_jsonl`] for the CLI. Returns the
/// number of records written.
pub fn write_fixture_jsonl_file(
    cfg: &GenConfig,
    path: &std::path::Path,
) -> Result<usize, SeedError> {
    let file = std::fs::File::create(path)?;
    let mut buf = std::io::BufWriter::new(file);
    export_fixture_jsonl(cfg, &mut buf)
}
