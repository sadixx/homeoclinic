//! Last-prescription preview for the patient dashboard (PAT-005, M3-RWv6
//! item 9).
//!
//! Until the R4 Rx engine exists, a prescription is the labelled PLACEHOLDER
//! table the case editor inserts into the opaque `case-rich` v3 `data_json`
//! (`table` node with `attrs.hcTableType == "prescription"`). This module
//! reads that document READ-ONLY (storage keeps it opaque; nothing is written
//! back) and builds the one-line `items_preview`: per body row (the header row
//! is skipped) `"<medicine> <potency>, <dosage>"`, rows joined with `"; "`.
//! Within one document the LAST prescription table in document order is the
//! latest (a follow-up carries the earlier entries forward). Never logs.

use serde_json::Value;

/// `hcTableType` of the prescription placeholder table.
const PRESCRIPTION_TABLE: &str = "prescription";

/// Separator between prescription rows in the one-line preview.
const ROW_SEPARATOR: &str = "; ";

/// The items preview of the latest prescription table in a `case-rich`
/// `data_json`, or `None` when the document is not JSON, holds no prescription
/// table, or its latest table has no non-empty medicine/potency/dosage row.
pub(crate) fn latest_prescription_preview(data_json: &str) -> Option<String> {
    let doc: Value = serde_json::from_str(data_json).ok()?;
    let mut latest: Option<&Value> = None;
    // `complaints[]` in order, each complaint's `doc` in document order.
    if let Some(complaints) = doc.get("complaints").and_then(Value::as_array) {
        for complaint in complaints {
            if let Some(d) = complaint.get("doc") {
                find_prescription_tables(d, &mut latest);
            }
        }
    }
    let table = latest?;
    let rows = table.get("content").and_then(Value::as_array)?;
    let items: Vec<String> = rows
        .iter()
        .skip(1) // header row
        .filter_map(row_preview)
        .collect();
    if items.is_empty() {
        None
    } else {
        Some(items.join(ROW_SEPARATOR))
    }
}

/// Depth-first, document-order walk keeping the LAST prescription table seen.
fn find_prescription_tables<'a>(node: &'a Value, latest: &mut Option<&'a Value>) {
    let is_rx_table = node.get("type").and_then(Value::as_str) == Some("table")
        && node
            .get("attrs")
            .and_then(|a| a.get("hcTableType"))
            .and_then(Value::as_str)
            == Some(PRESCRIPTION_TABLE);
    if is_rx_table {
        *latest = Some(node);
        return;
    }
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            find_prescription_tables(child, latest);
        }
    }
}

/// `"<medicine> <potency>, <dosage>"` for one body row (cells 0..3), or `None`
/// when all three are empty.
fn row_preview(row: &Value) -> Option<String> {
    let cells = row.get("content").and_then(Value::as_array)?;
    let cell = |i: usize| -> String {
        cells
            .get(i)
            .map(|c| {
                let mut s = String::new();
                collect_text(c, &mut s);
                s.trim().to_string()
            })
            .unwrap_or_default()
    };
    let (medicine, potency, dosage) = (cell(0), cell(1), cell(2));
    let head = [medicine, potency]
        .into_iter()
        .filter(|s| !s.is_empty())
        .collect::<Vec<_>>()
        .join(" ");
    match (head.is_empty(), dosage.is_empty()) {
        (true, true) => None,
        (false, true) => Some(head),
        (true, false) => Some(dosage),
        (false, false) => Some(format!("{head}, {dosage}")),
    }
}

/// Concatenate every text node under `node`.
fn collect_text(node: &Value, out: &mut String) {
    if node.get("type").and_then(Value::as_str) == Some("text") {
        if let Some(t) = node.get("text").and_then(Value::as_str) {
            out.push_str(t);
        }
        return;
    }
    if let Some(children) = node.get("content").and_then(Value::as_array) {
        for child in children {
            collect_text(child, out);
        }
    }
}
