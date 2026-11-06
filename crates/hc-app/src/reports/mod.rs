//! R5 reports: daily collection by mode, monthly summary, CSV/xlsx export
//! (BILL-004, HC-MVP1-153; R5 design §6, §10). Grouped by payment date
//! (`paid_on`); voided payments excluded; aggregates only (no patient data).
//!
//! Exports write a new file into the folder the doctor picked; an existing
//! file is never overwritten (a ` (2)` suffix is added). No path ever reaches
//! the UI or the logs.

use std::path::Path;

use serde::{Deserialize, Serialize};
use specta::Type;

use hc_domain::billing::PaymentMode;
use hc_storage::Pool;

use hc_docs::collection::{render_csv_with_footer, render_xlsx_with_footer, Cell, CollectionTable};
use hc_domain::billing::{days_in_month, parse_iso_date};
use hc_domain::error::DomainError;

use crate::clock::Clock;
use crate::error::AppError;

/// One mode row (always 4 rows: cash, upi, card, other).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ModeRow {
    /// Payment mode.
    pub mode: PaymentMode,
    /// Number of live payments.
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
    /// Sum, paise.
    #[specta(type = specta_typescript::Number)]
    pub amount_paise: i64,
}

/// `report_daily_collection` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DailyCollection {
    /// Local date `YYYY-MM-DD`.
    pub date: String,
    /// Always 4 rows: cash, upi, card, other.
    pub by_mode: Vec<ModeRow>,
    /// Payments that day.
    #[specta(type = specta_typescript::Number)]
    pub total_count: i64,
    /// Collected that day, paise.
    #[specta(type = specta_typescript::Number)]
    pub total_paise: i64,
    /// Balance on non-void bills issued that day.
    #[specta(type = specta_typescript::Number)]
    pub outstanding_paise: i64,
}

/// One day of the monthly summary.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DayRow {
    /// Local date `YYYY-MM-DD`.
    pub date: String,
    /// Cash, paise.
    #[specta(type = specta_typescript::Number)]
    pub cash_paise: i64,
    /// UPI, paise.
    #[specta(type = specta_typescript::Number)]
    pub upi_paise: i64,
    /// Card, paise.
    #[specta(type = specta_typescript::Number)]
    pub card_paise: i64,
    /// Other, paise.
    #[specta(type = specta_typescript::Number)]
    pub other_paise: i64,
    /// Number of live payments.
    #[specta(type = specta_typescript::Number)]
    pub count: i64,
    /// Collected that day, paise.
    #[specta(type = specta_typescript::Number)]
    pub total_paise: i64,
}

/// `report_monthly_summary` response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySummary {
    /// `YYYY-MM`.
    pub month: String,
    /// Every calendar day of the month.
    pub days: Vec<DayRow>,
    /// Month total (`date` = the month).
    pub total: DayRow,
}

/// Which report to export.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ReportSpec {
    /// The daily collection of one local date.
    Daily {
        /// Local date `YYYY-MM-DD`.
        date: String,
    },
    /// The monthly summary of one month.
    Monthly {
        /// Month `YYYY-MM`.
        month: String,
    },
}

/// Export format.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum ExportFormat {
    /// UTF-8 CSV with a BOM (opens in Excel).
    Csv,
    /// Excel workbook (one sheet).
    Xlsx,
}

/// `report_export` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportExportRequest {
    /// Which report.
    pub report: ReportSpec,
    /// CSV or xlsx.
    pub format: ExportFormat,
}

/// `report_export` response (no path ever crosses to the UI).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ReportExportResult {
    /// `false` when the picker was cancelled.
    pub saved: bool,
    /// Saved file name (never a path).
    pub file_name: Option<String>,
    /// Body rows written.
    #[specta(type = specta_typescript::Number)]
    pub row_count: i64,
}

/// `report_daily_collection` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DailyCollectionRequest {
    /// Local date `YYYY-MM-DD`.
    pub date: String,
}

/// `report_monthly_summary` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MonthlySummaryRequest {
    /// Month `YYYY-MM`.
    pub month: String,
}

/// The four payment modes in their fixed report order.
const MODES: [PaymentMode; 4] = [
    PaymentMode::Cash,
    PaymentMode::Upi,
    PaymentMode::Card,
    PaymentMode::Other,
];

fn invalid() -> AppError {
    AppError::Validation(DomainError::Invalid)
}

fn mode_key(m: PaymentMode) -> &'static str {
    match m {
        PaymentMode::Cash => "cash",
        PaymentMode::Upi => "upi",
        PaymentMode::Card => "card",
        PaymentMode::Other => "other",
    }
}

fn mode_label(m: PaymentMode) -> &'static str {
    match m {
        PaymentMode::Cash => "Cash",
        PaymentMode::Upi => "UPI",
        PaymentMode::Card => "Card",
        PaymentMode::Other => "Other",
    }
}

/// Strict `YYYY-MM` -> (year, month).
fn parse_month(s: &str) -> Option<(i32, u32)> {
    let b = s.as_bytes();
    if b.len() != 7 || b[4] != b'-' {
        return None;
    }
    if !s[..4].bytes().all(|c| c.is_ascii_digit()) || !s[5..].bytes().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let y: i32 = s[..4].parse().ok()?;
    let m: u32 = s[5..].parse().ok()?;
    (1..=12).contains(&m).then_some((y, m))
}

/// `YYYY-MM-DD` -> `DD-MM-YYYY` for titles.
fn dd_mm_yyyy(iso: &str) -> String {
    match (iso.get(..4), iso.get(5..7), iso.get(8..10)) {
        (Some(y), Some(m), Some(d)) => format!("{d}-{m}-{y}"),
        _ => iso.to_string(),
    }
}

/// Reports use-case service.
pub struct ReportService<'a> {
    clock: &'a dyn Clock,
}

impl<'a> ReportService<'a> {
    /// New service over the injected clock.
    pub fn new(clock: &'a dyn Clock) -> Self {
        Self { clock }
    }

    /// `report_daily_collection`: live payments of one local day by mode
    /// (always 4 rows), totals, and the outstanding balance on the non-void
    /// bills issued that day (A8).
    pub fn daily_collection(
        &self,
        pool: &Pool,
        req: DailyCollectionRequest,
    ) -> Result<DailyCollection, AppError> {
        if parse_iso_date(&req.date).is_none() {
            return Err(invalid());
        }
        let (rows, outstanding) = pool.with_reader(|c| {
            Ok((
                hc_storage::billing::collection_by_mode(c, &req.date)?,
                hc_storage::billing::outstanding_issued_on(c, &req.date)?,
            ))
        })?;
        let by_mode: Vec<ModeRow> = MODES
            .iter()
            .map(|m| {
                let hit = rows.iter().find(|r| r.mode == mode_key(*m));
                ModeRow {
                    mode: *m,
                    count: hit.map_or(0, |r| r.count),
                    amount_paise: hit.map_or(0, |r| r.amount_paise),
                }
            })
            .collect();
        Ok(DailyCollection {
            total_count: by_mode.iter().map(|r| r.count).sum(),
            total_paise: by_mode.iter().map(|r| r.amount_paise).sum(),
            by_mode,
            date: req.date,
            outstanding_paise: outstanding,
        })
    }

    /// `report_monthly_summary`: one row per calendar day (per-mode columns)
    /// plus the month total; the rows add up to the total by construction.
    pub fn monthly_summary(
        &self,
        pool: &Pool,
        req: MonthlySummaryRequest,
    ) -> Result<MonthlySummary, AppError> {
        let (y, m) = parse_month(&req.month).ok_or_else(invalid)?;
        let last = days_in_month(y, m);
        let from = format!("{}-01", req.month);
        let to = format!("{}-{last:02}", req.month);
        let rows =
            pool.with_reader(|c| hc_storage::billing::collection_by_day_mode(c, &from, &to))?;
        let empty = |date: String| DayRow {
            date,
            cash_paise: 0,
            upi_paise: 0,
            card_paise: 0,
            other_paise: 0,
            count: 0,
            total_paise: 0,
        };
        let mut days: Vec<DayRow> = (1..=last)
            .map(|d| empty(format!("{}-{d:02}", req.month)))
            .collect();
        let mut total = empty(req.month.clone());
        for r in rows {
            let Some(day) = days.iter_mut().find(|d| d.date == r.paid_on) else {
                continue;
            };
            for target in [&mut *day, &mut total] {
                match r.mode.as_str() {
                    "cash" => target.cash_paise += r.amount_paise,
                    "upi" => target.upi_paise += r.amount_paise,
                    "card" => target.card_paise += r.amount_paise,
                    _ => target.other_paise += r.amount_paise,
                }
                target.count += r.count;
                target.total_paise += r.amount_paise;
            }
        }
        Ok(MonthlySummary {
            month: req.month,
            days,
            total,
        })
    }

    /// Check an export request before the folder picker opens, so a bad
    /// date / month is refused without asking for a folder (r5-review-9).
    pub fn validate_export(req: &ReportExportRequest) -> Result<(), AppError> {
        let ok = match &req.report {
            ReportSpec::Daily { date } => parse_iso_date(date).is_some(),
            ReportSpec::Monthly { month } => parse_month(month).is_some(),
        };
        if ok {
            Ok(())
        } else {
            Err(invalid())
        }
    }

    /// Build + write the export into `dir` (the picker's folder). A read
    /// export: no DB write, no audit row. Any IO problem is `ExportFailed`
    /// with no path in the message.
    pub fn export_to(
        &self,
        pool: &Pool,
        dir: &Path,
        req: ReportExportRequest,
    ) -> Result<ReportExportResult, AppError> {
        let _ = self.clock;
        let (table, footer, base, row_count) = match &req.report {
            ReportSpec::Daily { date } => {
                let d =
                    self.daily_collection(pool, DailyCollectionRequest { date: date.clone() })?;
                let table = CollectionTable {
                    title: format!("Daily collection {}", dd_mm_yyyy(&d.date)),
                    header: vec![
                        "Mode".to_string(),
                        "Payments".to_string(),
                        "Amount (Rs)".to_string(),
                    ],
                    rows: d
                        .by_mode
                        .iter()
                        .map(|r| {
                            vec![
                                Cell::Text(mode_label(r.mode).to_string()),
                                Cell::Count(r.count),
                                Cell::Paise(r.amount_paise),
                            ]
                        })
                        .collect(),
                    total: vec![
                        Cell::Text("TOTAL".to_string()),
                        Cell::Count(d.total_count),
                        Cell::Paise(d.total_paise),
                    ],
                };
                let footer = vec![vec![
                    Cell::Text("Outstanding on bills issued this day".to_string()),
                    Cell::Empty,
                    Cell::Paise(d.outstanding_paise),
                ]];
                let rows = i64::try_from(d.by_mode.len()).unwrap_or(0);
                (table, footer, format!("collection-daily-{}", d.date), rows)
            }
            ReportSpec::Monthly { month } => {
                let m = self.monthly_summary(
                    pool,
                    MonthlySummaryRequest {
                        month: month.clone(),
                    },
                )?;
                let money_row = |first: Cell, r: &DayRow| {
                    vec![
                        first,
                        Cell::Paise(r.cash_paise),
                        Cell::Paise(r.upi_paise),
                        Cell::Paise(r.card_paise),
                        Cell::Paise(r.other_paise),
                        Cell::Count(r.count),
                        Cell::Paise(r.total_paise),
                    ]
                };
                let title_month = match (m.month.get(..4), m.month.get(5..7)) {
                    (Some(y), Some(mm)) => format!("{mm}-{y}"),
                    _ => m.month.clone(),
                };
                let table = CollectionTable {
                    title: format!("Monthly collection {title_month}"),
                    header: [
                        "Date",
                        "Cash (Rs)",
                        "UPI (Rs)",
                        "Card (Rs)",
                        "Other (Rs)",
                        "Payments",
                        "Total (Rs)",
                    ]
                    .iter()
                    .map(|s| s.to_string())
                    .collect(),
                    rows: m
                        .days
                        .iter()
                        .map(|d| money_row(Cell::Date(d.date.clone()), d))
                        .collect(),
                    total: money_row(Cell::Text("TOTAL".to_string()), &m.total),
                };
                let rows = i64::try_from(m.days.len()).unwrap_or(0);
                (
                    table,
                    Vec::new(),
                    format!("collection-monthly-{}", m.month),
                    rows,
                )
            }
        };
        let (bytes, name) = match req.format {
            ExportFormat::Csv => (
                render_csv_with_footer(&table, &footer).into_bytes(),
                format!("{base}.csv"),
            ),
            ExportFormat::Xlsx => (
                render_xlsx_with_footer(&table, &footer).map_err(|_| AppError::ExportFailed)?,
                format!("{base}.xlsx"),
            ),
        };
        // The storage layer joins the name onto the picked folder and writes
        // it exclusively (R-ARCH-009); no path crosses back to the UI.
        let file_name = hc_storage::export::write_new_export_file(dir, &name, &bytes)
            .map_err(|_| AppError::ExportFailed)?;
        Ok(ReportExportResult {
            saved: true,
            file_name: Some(file_name),
            row_count,
        })
    }
}
