//! R5 collection export bytes: CSV + xlsx (BILL-004, HC-MVP1-153; R5 design
//! §4, §10, §13 T-EXPORT).
//!
//! CUT: the REAL `hc_docs::collection::{render_csv, render_xlsx}`. Pure; the
//! xlsx is unzipped with the `zip` dev-dep (test oracle only). Aggregates
//! only, no patient data. RED until hc-dev replaces the §13 stubs.

use std::io::Read as _;

use hc_docs::collection::{render_csv, render_xlsx, Cell, CollectionTable};

fn daily_table() -> CollectionTable {
    CollectionTable {
        title: "Daily collection 16-10-2026".to_string(),
        header: vec![
            "Mode".to_string(),
            "Payments".to_string(),
            "Amount (Rs)".to_string(),
        ],
        rows: vec![
            vec![
                Cell::Text("Cash".into()),
                Cell::Count(1),
                Cell::Paise(20_000),
            ],
            vec![
                Cell::Text("UPI".into()),
                Cell::Count(1),
                Cell::Paise(10_000),
            ],
            vec![Cell::Text("Card".into()), Cell::Count(0), Cell::Paise(0)],
            vec![Cell::Text("Other".into()), Cell::Count(0), Cell::Paise(0)],
        ],
        total: vec![
            Cell::Text("TOTAL".into()),
            Cell::Count(2),
            Cell::Paise(30_000),
        ],
    }
}

fn monthly_table() -> CollectionTable {
    CollectionTable {
        title: "Monthly collection 10-2026".to_string(),
        header: vec!["Date".into(), "Cash (Rs)".into(), "Total (Rs)".into()],
        rows: vec![
            vec![
                Cell::Date("2026-10-01".into()),
                Cell::Paise(13_250),
                Cell::Paise(13_250),
            ],
            vec![
                Cell::Date("2026-10-02".into()),
                Cell::Paise(12_345_675),
                Cell::Paise(12_345_675),
            ],
        ],
        total: vec![
            Cell::Text("TOTAL".into()),
            Cell::Paise(12_358_925),
            Cell::Paise(12_358_925),
        ],
    }
}

/// Split CSV content (after the BOM) into lines on CRLF.
fn csv_lines(csv: &str) -> Vec<String> {
    let body = csv
        .strip_prefix('\u{feff}')
        .unwrap_or_else(|| panic!("CSV must start with a UTF-8 BOM (Excel): {csv:?}"));
    assert!(
        !body.replace("\r\n", "").contains('\n'),
        "every line break must be CRLF: {body:?}"
    );
    body.trim_end_matches("\r\n")
        .split("\r\n")
        .map(str::to_string)
        .collect()
}

/// Bug caught: Excel opens the CSV as mojibake (no BOM), merges lines (LF
/// only), or the rows are out of order / missing the TOTAL line.
#[test]
fn render_csv_daily_layout_bom_crlf_and_plain_rupees() {
    let lines = csv_lines(&render_csv(&daily_table()));
    assert_eq!(
        lines,
        vec![
            "Daily collection 16-10-2026",
            "Mode,Payments,Amount (Rs)",
            "Cash,1,200.00",
            "UPI,1,100.00",
            "Card,0,0.00",
            "Other,0,0.00",
            "TOTAL,2,300.00",
        ]
    );
}

/// Bug caught: dates exported as ISO (doctor expects DD-MM-YYYY) or amounts
/// with Indian grouping commas that split the column.
#[test]
fn render_csv_monthly_dates_are_dd_mm_yyyy_and_amounts_ungrouped() {
    let lines = csv_lines(&render_csv(&monthly_table()));
    assert_eq!(lines[2], "01-10-2026,132.50,132.50");
    assert_eq!(lines[3], "02-10-2026,123456.75,123456.75");
    assert_eq!(lines[4], "TOTAL,123589.25,123589.25");
}

/// Bug caught: a text cell with a comma / quote / newline breaks the CSV
/// columns (RFC 4180 quoting missing).
#[test]
fn render_csv_quotes_text_with_comma_quote_or_newline() {
    let t = CollectionTable {
        title: "Test".into(),
        header: vec!["A".into(), "B".into()],
        rows: vec![vec![
            Cell::Text("Cash, counter \"1\"".into()),
            Cell::Text("line1\nline2".into()),
        ]],
        total: vec![Cell::Text("TOTAL".into()), Cell::Count(0)],
    };
    let csv = render_csv(&t);
    assert!(
        csv.contains("\"Cash, counter \"\"1\"\"\",\"line1\nline2\""),
        "RFC 4180 quoting: {csv:?}"
    );
}

/// Read one entry of the xlsx zip as a string.
fn zip_entry(bytes: &[u8], name: &str) -> String {
    let mut z = zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("xlsx is a zip");
    let mut f = z
        .by_name(name)
        .unwrap_or_else(|_| panic!("xlsx must contain {name}"));
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    s
}

/// All `<v>…</v>` numeric values in a sheet XML.
fn numeric_values(sheet: &str) -> Vec<f64> {
    sheet
        .split("<v>")
        .skip(1)
        .filter_map(|s| s.split("</v>").next())
        .filter_map(|v| v.parse::<f64>().ok())
        .collect()
}

/// Bug caught: the Excel export is not a real workbook (Excel refuses it).
#[test]
fn render_xlsx_produces_a_zip_workbook_with_one_sheet() {
    let bytes = render_xlsx(&daily_table()).expect("xlsx renders");
    assert!(bytes.starts_with(b"PK"), "xlsx must be a zip (PK header)");
    let wb = zip_entry(&bytes, "xl/workbook.xml");
    assert_eq!(wb.matches("<sheet ").count(), 1, "exactly one sheet");
}

/// Bug caught: money cells written as text (no SUM in Excel), scaled wrong
/// (paise instead of rupees) or rounded through f64 (off by a paisa).
#[test]
fn render_xlsx_writes_amounts_as_exact_rupee_numbers() {
    let bytes = render_xlsx(&monthly_table()).expect("xlsx renders");
    let sheet = zip_entry(&bytes, "xl/worksheets/sheet1.xml");
    let nums = numeric_values(&sheet);
    for want in [132.5_f64, 123_456.75, 123_589.25] {
        assert!(
            nums.contains(&want),
            "expected a numeric cell {want}, got {nums:?}"
        );
    }
    assert!(
        !nums.contains(&13_250.0),
        "amounts must be rupees, not paise: {nums:?}"
    );
}

/// Bug caught: labels/dates missing from the sheet, or dates as ISO, or the
/// Indian lakh/crore number format not applied.
#[test]
fn render_xlsx_has_labels_dd_mm_yyyy_dates_and_indian_number_format() {
    let bytes = render_xlsx(&monthly_table()).expect("xlsx renders");
    let sheet = zip_entry(&bytes, "xl/worksheets/sheet1.xml");
    // Strings may be shared or inline; search both.
    let strings = {
        let mut z = zip::ZipArchive::new(std::io::Cursor::new(&bytes[..])).unwrap();
        let mut s = String::new();
        if let Ok(mut f) = z.by_name("xl/sharedStrings.xml") {
            f.read_to_string(&mut s).unwrap();
        }
        s
    };
    let text = format!("{sheet}{strings}");
    for want in [
        "Monthly collection 10-2026",
        "Date",
        "Cash (Rs)",
        "TOTAL",
        "01-10-2026",
        "02-10-2026",
    ] {
        assert!(text.contains(want), "xlsx must contain {want:?}");
    }
    assert!(
        !text.contains("2026-10-01"),
        "dates must be DD-MM-YYYY, not ISO"
    );

    let styles = zip_entry(&bytes, "xl/styles.xml");
    assert!(
        styles.contains("##\\,##\\,##0.00") || styles.contains("##,##,##0.00"),
        "Indian grouping number format must be applied: {styles}"
    );
}
