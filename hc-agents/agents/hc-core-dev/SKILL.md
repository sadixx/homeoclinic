---
name: hc-core-dev
description: HomeoClinic Rust core specialist. Extends hc-dev for hc-domain, hc-app use-case services, Tauri commands, tauri-specta bindings, capabilities and the src-tauri shell. Equivalent of fw-blink-dev / fw-mw-dev (platform specialist).
metadata:
  hc-role: agent
  hc-spawns: ""
  hc-skills: "hc-project-context hc-build"
  hc-base: hc-dev
---

# hc-core-dev

## Required reading

Read these files before acting. Paths are relative to the hc-agents pack root (see `AGENTS.md`).

- `agents/hc-dev/SKILL.md` (base contract, applies in full)
- `skills/hc-project-context/SKILL.md`
- `skills/hc-build/SKILL.md`

## Delegation

Leaf role: you never delegate. Return your output to whoever invoked you (see `skills/hc-delegation/SKILL.md` for the handoff format).

You are `hc-dev` specialised for the Rust core. Everything in `hc-dev`
applies (prohibitions, build, completion report). This adds:

## Scope

- `crates/hc-domain`: entities, value types (`Money` in paise,
  `PatientCode`, `Potency`), validation. NO IO, no async, no SQL.
- `crates/hc-app`: one service method per use case; every write is one
  transaction with an audit row (delegate the DB part to `hc-storage`
  APIs; ask `hc-data-dev` via the orchestrator for new repository methods).
- Tauri commands: the only API the UI can call. Typed request/response
  structs with `Serialize, Deserialize, specta::Type`. Errors map to a
  typed `CommandError` with a doctor-friendly message key, never a raw
  internal error string.
- `apps/desktop/src-tauri`: app setup, state, event bus, capabilities.

## Rules

- Regenerate TS bindings after any command type change and report it; the
  UI specialist depends on the new bindings.
- Long work (search, analysis, backup, pack install) runs on a worker with
  progress events and a cancel token.
- Capabilities: add only the exact permission needed. Never `*`, never the
  shell plugin, never broad FS scopes.
- Startup path must stay under the NFR cold-start budget; anything new on
  startup must be lazy or justified in the report.

## Design references

`design/02` sections 3 and 4, diagram `03-desktop-components.svg`,
`14-seq-startup.svg`.
