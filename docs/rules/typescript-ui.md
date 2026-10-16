# R-UI: TypeScript and UI

Family token `R-UI`. These rules keep the React UI strict, typed, testable,
keyboard-first, accessible, formatted for India and localisable, and calling
the backend only through generated bindings. They derive from
`docs/requirements/05-nfr-and-acceptance.md` (NFR-030, NFR-032, NFR-033,
NFR-034, NFR-035, section 6), `docs/design/02-architecture-overview.md`
sections 3 and 8, `docs/CODE-LAYOUT.md` (UI modules) and
`hc-agents/agents/hc-lint-fixer`.

Default scope for this family: `apps/desktop/src`.

---

### R-UI-001 Strict TypeScript, no any
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: `tsc` runs in strict mode with zero errors; `any`, `as any`, `@ts-ignore` and `@ts-expect-error` are forbidden; use the precise types from `bindings.ts`.
- Why: requirements/06 section 6 (TypeScript strict); hc-lint-fixer policy.

### R-UI-002 Call generated bindings, never raw invoke
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: components call the typed wrappers in `bindings.ts`; raw `@tauri-apps/api` `invoke()` and hand-written IPC are forbidden.
- Why: design section 3; product rule 4.

```ts
// bad
import { invoke } from "@tauri-apps/api/core";
await invoke("register_patient", { patient });
// good
import { commands } from "@/bindings";
await commands.registerPatient(patient);
```

### R-UI-003 Interactive elements have stable data-testids
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: inputs, buttons, result rows and key regions carry a stable `data-testid` matching the screen spec in `docs/ui`, so the tauri-driver E2E suite can target them.
- Why: requirements/06 section 6 (E2E flows); `docs/ui` conventions.

### R-UI-004 Keyboard-first operation
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: every core flow is fully operable by keyboard (focus order, Enter/Esc, documented shortcuts); no action is mouse-only.
- Why: NFR-032 (full keyboard operation); NFR-030.

### R-UI-005 Accessibility: labels, contrast, font, 1366x768
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: controls carry screen-reader labels, meet WCAG 2.1 AA contrast, use at least a 14 px font, and layouts work at 1366x768 with no horizontal scroll.
- Why: NFR-032, NFR-034.

### R-UI-006 Indian formats come from shared helpers only
- Severity: defect
- Scope: `apps/desktop/src/shared/**`, `apps/desktop/src/**`
- Rule: money (paise to rupees, lakh/crore grouping), dates and numbers are formatted only through `shared/` formatters; no inline `toLocaleString` or hand-rolled money maths in components.
- Why: design section 8 (Indian number format); product rule 8.

### R-UI-007 User-facing text comes from the strings file
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: visible text lives in `locales/en.json` and is referenced by key; hardcoded user-facing strings in components are forbidden.
- Why: design section 8 (i18n strings from day one); review guideline `i18n/hardcoded-string`.

### R-UI-008 Errors shown in plain language, never a stack trace
- Severity: defect
- Scope: `apps/desktop/src/**`
- Rule: error UI shows the mapped plain-language message and a suggested action; a raw error, error code or stack trace is never shown to the doctor.
- Why: NFR-033; SUX-007.

### R-UI-009 Destructive actions are undoable
- Severity: advisory
- Scope: `apps/desktop/src/**`
- Rule: destructive actions (remove rubric from clipboard, delete Rx line, delete a record) offer an undo or a confirm step.
- Why: NFR-035.
