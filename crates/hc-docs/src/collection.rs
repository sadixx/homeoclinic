//! Collection report export bytes: CSV and xlsx (BILL-004; R5 design §4, §10).
//! No file IO here; `hc-app` writes the bytes. Aggregates only, never patient
//! data.

use rust_xlsxwriter::{Format, Workbook};

use crate::inr::rupees_plain;
use crate::DocsError;

/// Indian lakh/crore grouping as an Excel number format (design §4).
pub const INDIAN_NUMBER_FORMAT: &str =
    "[>=10000000]##\\,##\\,##\\,##0.00;[>=100000]##\\,##\\,##0.00;##,##0.00";

/// One export cell.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Cell {
    /// Free text.
    Text(String),
    /// A count.
    Count(i64),
    /// Money in paise.
    Paise(i64),
    /// A local date `YYYY-MM-DD` (rendered DD-MM-YYYY).
    Date(String),
    /// An empty cell.
    Empty,
}

/// One report table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionTable {
    /// Title row (first line), e.g. `"Daily collection"`.
    pub title: String,
    /// Header labels.
    pub header: Vec<String>,
    /// Body rows.
    pub rows: Vec<Vec<Cell>>,
    /// The TOTAL row.
    pub total: Vec<Cell>,
}

/// `YYYY-MM-DD` -> `DD-MM-YYYY`; any other shape is passed through unchanged.
fn dd_mm_yyyy(iso: &str) -> String {
    let parts: Vec<&str> = iso.split('-').collect();
    match parts.as_slice() {
        [y, m, d] if y.len() == 4 && m.len() == 2 && d.len() == 2 => format!("{d}-{m}-{y}"),
        _ => iso.to_string(),
    }
}

/// RFC 4180 field: quoted when it holds a comma, quote or line break.
fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn csv_cell(c: &Cell) -> String {
    match c {
        Cell::Text(s) => csv_field(s),
        Cell::Count(n) => n.to_string(),
        Cell::Paise(p) => rupees_plain(*p),
        Cell::Date(d) => csv_field(&dd_mm_yyyy(d)),
        Cell::Empty => String::new(),
    }
}

fn csv_row(cells: &[Cell], out: &mut String) {
    let joined: Vec<String> = cells.iter().map(csv_cell).collect();
    out.push_str(&joined.join(","));
    out.push_str("\r\n");
}

/// UTF-8 BOM + RFC-4180 CSV with CRLF line ends.
pub fn render_csv(t: &CollectionTable) -> String {
    render_csv_with_footer(t, &[])
}

/// [`render_csv`] plus extra rows after TOTAL (the daily "Outstanding" line).
pub fn render_csv_with_footer(t: &CollectionTable, footer: &[Vec<Cell>]) -> String {
    let mut out = String::from('\u{feff}');
    out.push_str(&csv_field(&t.title));
    out.push_str("\r\n");
    let header: Vec<Cell> = t.header.iter().cloned().map(Cell::Text).collect();
    csv_row(&header, &mut out);
    for r in &t.rows {
        csv_row(r, &mut out);
    }
    csv_row(&t.total, &mut out);
    for r in footer {
        csv_row(r, &mut out);
    }
    out
}

/// One-sheet xlsx workbook bytes.
pub fn render_xlsx(t: &CollectionTable) -> Result<Vec<u8>, DocsError> {
    render_xlsx_with_footer(t, &[])
}

/// [`render_xlsx`] plus extra rows after TOTAL. Paise cells are numbers in
/// rupees with the Indian number format; dates are DD-MM-YYYY text; the
/// title, header and TOTAL rows are bold.
pub fn render_xlsx_with_footer(
    t: &CollectionTable,
    footer: &[Vec<Cell>],
) -> Result<Vec<u8>, DocsError> {
    let mut wb = Workbook::new();
    let plain = Format::new();
    let bold = Format::new().set_bold();
    let money = Format::new().set_num_format(INDIAN_NUMBER_FORMAT);
    let money_bold = Format::new()
        .set_num_format(INDIAN_NUMBER_FORMAT)
        .set_bold();
    {
        let ws = wb.add_worksheet();
        let x = |_e| DocsError::Xlsx;
        ws.write_string_with_format(0, 0, &t.title, &bold)
            .map_err(x)?;
        for (c, h) in t.header.iter().enumerate() {
            let col = u16::try_from(c).map_err(|_| DocsError::Xlsx)?;
            ws.write_string_with_format(1, col, h, &bold).map_err(x)?;
            ws.set_column_width(col, if c == 0 { 36 } else { 14 })
                .map_err(x)?;
        }
        let body = t
            .rows
            .iter()
            .map(|r| (r, false))
            .chain(std::iter::once((&t.total, true)))
            .chain(footer.iter().map(|r| (r, false)));
        for (row, (cells, is_total)) in (2_u32..).zip(body) {
            let (txt, num) = if is_total {
                (&bold, &money_bold)
            } else {
                (&plain, &money)
            };
            for (c, cell) in cells.iter().enumerate() {
                let col = u16::try_from(c).map_err(|_| DocsError::Xlsx)?;
                match cell {
                    Cell::Text(s) => {
                        ws.write_string_with_format(row, col, s, txt).map_err(x)?;
                    }
                    Cell::Date(d) => {
                        ws.write_string_with_format(row, col, dd_mm_yyyy(d), txt)
                            .map_err(x)?;
                    }
                    Cell::Count(n) => {
                        // Counts are small; exact in f64.
                        ws.write_number_with_format(row, col, *n as f64, txt)
                            .map_err(x)?;
                    }
                    Cell::Paise(p) => {
                        // R-DATA-004 exemption: xlsx cell boundary (ADR 0021).
                        // Values are < 2^53 and computed in i64, so the
                        // conversion is exact to the paisa.
                        ws.write_number_with_format(row, col, *p as f64 / 100.0, num)
                            .map_err(x)?;
                    }
                    Cell::Empty => {}
                }
            }
        }
    }
    wb.save_to_buffer().map_err(|_| DocsError::Xlsx)
}
