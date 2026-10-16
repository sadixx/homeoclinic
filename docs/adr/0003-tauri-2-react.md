# ADR 0003: Tauri 2 + React desktop stack

Date: 2026-10-17. Status: accepted.

Design ADR id: 001 (from `docs/design/02-architecture-overview.md` section 7).

## Context

HomeoClinic must ship as a desktop application for Windows and Linux, with a
path to mobile from a single codebase, while keeping the installer small and
runtime memory low. Candidate stacks were Electron, Flutter, Java Swing (the
legacy approach) and .NET.

## Decision

Build the desktop app on Tauri 2 with a React frontend. The webview renders
the UI while a native Rust binary hosts all logic (see ADR 0005).

## Consequences

- Small installer and low RAM compared with Electron, and Windows + Linux +
  mobile are reachable from one codebase.
- Electron, Flutter, Java Swing (legacy) and .NET were rejected because they
  do not deliver the same combination of small footprint and cross-platform
  reach.
- The UI never touches SQL or file paths; it calls typed commands generated
  with `tauri-specta` (section 3).
