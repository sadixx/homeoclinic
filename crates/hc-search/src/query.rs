//! Ranked UNION search query with keyset pagination (HC-MVP1-049, PSR-002/004).
//!
//! The query runs on a READER connection (050-note). It unions the match
//! buckets into a single ranked result set:
//!   rank 0: exact patient ID (code / code_digits) or exact mobile digits
//!   rank 1: exact full name (name_norm)
//!   rank 2: name prefix (patient_fts) / partial digits (patient_trgm)
//!   rank 3: phonetic (patient_fts name_phonetic)
//!   rank 4: other fields (city)
//! Ties within a rank break by most recent visit (`last_visit_at` DESC), then
//! `patient_id` for stability. Keyset-paginated (`LIMIT 20`, cursor, no
//! `OFFSET`). Parameterised only; never `LIKE '%x%'` on a base table
//! (R-SEC-001, R-DATA-007).

use crate::error::SearchError;
use crate::{normalize, phonetic};
use rusqlite::{params, Connection};

/// Page size for every search query (PSR-004 "top 20"; R-DATA-007 bounded).
pub const PAGE_LIMIT: usize = 20;

/// One search hit.
#[derive(Debug, Clone, PartialEq)]
pub struct SearchHit {
    /// `patient.id` (UUIDv7).
    pub patient_id: String,
    /// `patient.code` (e.g. `HC-000123`).
    pub code: String,
    /// Display name as stored.
    pub name: String,
    /// Match bucket: 0 best (exact id/mobile) … 4 worst (other fields).
    pub rank: i64,
    /// Most-recent-visit timestamp used for tie-ordering (`None` if no visit).
    pub last_visit_at: Option<String>,
}

/// Opaque keyset cursor for the next page: the ordering tuple of the last row
/// returned. Passed back to [`search`] to fetch the following page WITHOUT an
/// `OFFSET` scan (R-DATA-007).
#[derive(Debug, Clone, PartialEq)]
pub struct PageCursor {
    /// Rank bucket of the last row on the page just returned.
    pub rank: i64,
    /// `last_visit_at` of the last row on the page (the tie key).
    pub tie_at: Option<String>,
    /// `patient_id` of the last row on the page (final stable key).
    pub patient_id: String,
}

/// A page of up to [`PAGE_LIMIT`] hits plus the cursor for the next page.
#[derive(Debug, Clone)]
pub struct SearchPage {
    /// Hits in rank then recency then id order.
    pub hits: Vec<SearchHit>,
    /// Cursor for the next page, or `None` when the result set is exhausted.
    pub next: Option<PageCursor>,
}

/// NULL `last_visit_at` sorts last in the `DESC` recency order. We fold it to an
/// empty string sort key: since all real timestamps are RFC3339 (non-empty) and
/// an empty string compares less than any of them, it lands last under `DESC`.
/// The literal is interpolated below only via this constant (no external data).
const NULL_TIE_KEY: &str = "";

/// Run the ranked UNION patient search on a reader `conn`.
///
/// `raw_query` is the single free-text box (PSR-001); it is normalised
/// internally (digits for mobile/id, prefix tokens for name, phonetic key).
/// `after = None` returns the first page; pass the [`PageCursor`] returned in
/// [`SearchPage::next`] to page forward. Returns up to [`PAGE_LIMIT`] hits.
///
/// All SQL is parameterised; the FTS `MATCH` expressions are bound as
/// parameters, never string-concatenated into the statement (R-SEC-001). The
/// only interpolated value is the `LIMIT` (a compile-time constant) and the
/// null-tie sort literal (a constant), neither of which is caller input.
pub fn search(
    conn: &Connection,
    raw_query: &str,
    after: Option<&PageCursor>,
) -> Result<SearchPage, SearchError> {
    let q = raw_query.trim();
    if q.is_empty() {
        return Ok(SearchPage {
            hits: Vec::new(),
            next: None,
        });
    }

    // Derive the normalised match inputs once.
    let name_norm = normalize::name_norm(q);
    let digits = normalize::mobile_digits(q);
    let code_digits = normalize::code_digits(q);
    let phonetic = phonetic::phonetic_key(q);

    // FTS match expressions, built from NORMALISED tokens we control. Each token
    // is restricted to the FTS "bareword" alphabet (ASCII alnum) during
    // normalisation, so the assembled expression carries no FTS metacharacters.
    let name_prefix_expr = build_name_prefix_expr(&name_norm);
    let phonetic_expr = build_phrase_expr(&phonetic);
    // Trigram match needs at least 3 characters; below that the bucket is empty.
    let trgm_expr = if digits.chars().count() >= 3 {
        Some(digits.clone())
    } else {
        None
    };

    // Fetch PAGE_LIMIT + 1 so the presence of an extra row tells us whether a
    // further page exists, without a second COUNT query.
    let fetch = PAGE_LIMIT + 1;

    // One ranked CTE: union every bucket, keep each patient's best (minimum)
    // rank, then order by (rank, recency DESC, id) and apply the keyset
    // predicate. Keyset, never OFFSET (R-DATA-007).
    let sql = format!(
        "WITH matches(rowid, rank) AS (\n\
         -- rank 0: exact id (code or its digits) or exact mobile digits.\n\
         -- Split into single-column equalities so each branch uses its B-tree\n\
         -- index (R-DATA-008) instead of a scan over an OR.\n\
           SELECT rowid, 0 FROM patient WHERE code = ?1\n\
           UNION ALL\n\
           SELECT rowid, 0 FROM patient WHERE ?2 <> '' AND code_digits = ?2\n\
           UNION ALL\n\
           SELECT rowid, 0 FROM patient WHERE ?3 <> '' AND mobile_digits = ?3\n\
           UNION ALL\n\
         -- rank 1: exact full name\n\
           SELECT rowid, 1 FROM patient WHERE ?4 <> '' AND name_norm = ?4\n\
           UNION ALL\n\
         -- rank 2a: name prefix (any word) via FTS prefix index\n\
           SELECT rowid, 2 FROM patient_fts WHERE ?5 <> '' AND patient_fts MATCH ?6\n\
           UNION ALL\n\
         -- rank 2b: partial id/mobile digits via trigram index\n\
           SELECT rowid, 2 FROM patient_trgm WHERE ?7 <> '' AND patient_trgm MATCH ?8\n\
           UNION ALL\n\
         -- rank 3: phonetic key match\n\
           SELECT rowid, 3 FROM patient_fts WHERE ?9 <> '' AND patient_fts MATCH ?10\n\
           UNION ALL\n\
         -- rank 4: other fields (city prefix)\n\
           SELECT rowid, 4 FROM patient_fts WHERE ?11 <> '' AND patient_fts MATCH ?12\n\
         ),\n\
         best(rowid, rank) AS (\n\
           SELECT rowid, MIN(rank) FROM matches GROUP BY rowid\n\
         )\n\
         SELECT p.id, p.code, p.name, b.rank, p.last_visit_at\n\
         FROM best b JOIN patient p ON p.rowid = b.rowid\n\
         WHERE p.deleted_at IS NULL\n\
           AND (\n\
             ?13 = 0\n\
             OR b.rank > ?14\n\
             OR (b.rank = ?14 AND COALESCE(p.last_visit_at, '{null_tie}') < ?15)\n\
             OR (b.rank = ?14 AND COALESCE(p.last_visit_at, '{null_tie}') = ?15 \
                 AND p.id > ?16)\n\
           )\n\
         ORDER BY b.rank ASC, COALESCE(p.last_visit_at, '{null_tie}') DESC, p.id ASC\n\
         LIMIT {limit}",
        null_tie = NULL_TIE_KEY,
        limit = fetch,
    );

    // Keyset parameters: when `after` is None we pass a 0 "no cursor" flag and
    // dummy values that the predicate ignores.
    let (has_cursor, cur_rank, cur_tie, cur_id) = match after {
        Some(c) => (
            1i64,
            c.rank,
            c.tie_at.clone().unwrap_or_else(|| NULL_TIE_KEY.to_string()),
            c.patient_id.clone(),
        ),
        None => (0i64, 0i64, NULL_TIE_KEY.to_string(), String::new()),
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(
            params![
                q,                                     // ?1  exact code
                code_digits,                           // ?2  exact code digits
                digits,                                // ?3  exact mobile digits
                name_norm,                             // ?4  exact full name
                name_prefix_expr,                      // ?5  name-prefix guard
                name_prefix_expr,                      // ?6  name-prefix MATCH
                trgm_expr.clone().unwrap_or_default(), // ?7  trigram guard
                trgm_expr.unwrap_or_default(),         // ?8  trigram MATCH
                phonetic_expr,                         // ?9  phonetic guard
                phonetic_match(&phonetic_expr),        // ?10 phonetic MATCH
                build_city_expr(&name_norm),           // ?11 city guard
                build_city_match(&name_norm),          // ?12 city MATCH
                has_cursor,                            // ?13 cursor present?
                cur_rank,                              // ?14 cursor rank
                cur_tie,                               // ?15 cursor tie key
                cur_id,                                // ?16 cursor id
            ],
            |row| {
                Ok(SearchHit {
                    patient_id: row.get(0)?,
                    code: row.get(1)?,
                    name: row.get(2)?,
                    rank: row.get(3)?,
                    last_visit_at: row.get(4)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;

    Ok(paginate(rows))
}

/// Split the fetched (`PAGE_LIMIT + 1`) rows into a page and an optional cursor.
fn paginate(mut rows: Vec<SearchHit>) -> SearchPage {
    let has_more = rows.len() > PAGE_LIMIT;
    if has_more {
        rows.truncate(PAGE_LIMIT);
    }
    let next = if has_more {
        rows.last().map(|h| PageCursor {
            rank: h.rank,
            tie_at: h.last_visit_at.clone(),
            patient_id: h.patient_id.clone(),
        })
    } else {
        None
    };
    SearchPage { hits: rows, next }
}

/// Build an FTS5 prefix expression over the `name` column: each normalised token
/// becomes a prefix term, implicitly ANDed, e.g. `"ram ku"` →
/// `name:ram* name:ku*`. Empty when there are no tokens.
fn build_name_prefix_expr(name_norm: &str) -> String {
    name_norm
        .split_whitespace()
        .map(|t| format!("name:{t}*"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Build an FTS5 phrase expression from space-separated bareword tokens (used
/// for the phonetic key), e.g. `"laksm sarm"` → `laksm sarm` (implicit AND).
fn build_phrase_expr(tokens: &str) -> String {
    tokens.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Column-scope the phonetic phrase to the `name_phonetic` column.
fn phonetic_match(phrase: &str) -> String {
    if phrase.is_empty() {
        return String::new();
    }
    phrase
        .split_whitespace()
        .map(|t| format!("name_phonetic:{t}"))
        .collect::<Vec<_>>()
        .join(" ")
}

/// Guard string that is non-empty exactly when a city prefix query is possible.
fn build_city_expr(name_norm: &str) -> String {
    build_name_prefix_expr(name_norm)
}

/// City prefix match on the `city` column (rank 4 "other fields").
fn build_city_match(name_norm: &str) -> String {
    name_norm
        .split_whitespace()
        .map(|t| format!("city:{t}*"))
        .collect::<Vec<_>>()
        .join(" ")
}
