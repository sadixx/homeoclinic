# ADR 0010: HTML templates rendered to PDF by the webview

Date: 2026-10-17. Status: accepted.

Design ADR id: 008 (from `docs/design/02-architecture-overview.md` section 7).

## Context

Document layouts (prescriptions, bills, reports) must be doctor-editable and
must render Unicode Indian scripts correctly. The legacy JasperReports
approach and a native PDF library do not give editable layouts with reliable
Indian-script support.

## Decision

Render documents from HTML templates to PDF using the webview. The `hc-docs`
crate drives rendering, amount-in-words and Indian number formatting
(section 3).

## Consequences

- Doctor-editable layouts and correct Unicode Indian scripts.
- JasperReports (legacy) and a native PDF library were rejected because they do
  not provide editable layouts or the needed script support.
- Document rendering reuses the webview already present for the UI.
