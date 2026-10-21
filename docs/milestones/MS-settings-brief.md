# MS — Settings and preferences (additional MVP1 milestone)

> Status: **SCOPED, not yet executed.** Added at the product owner's request
> (2026-10-21) as a standalone milestone so the doctor can change, after
> first-run setup, the values set during setup (profile, **fees**, ID prefix),
> the app preferences (**font size**, auto-lock, data folder), and choose the
> **camera/webcam device**. Screen: **S18 Settings** (`docs/ui/S18-settings.md`).
>
> This milestone realises the *editable* half of S18. The S18 spec's
> later-feature areas (case templates, advice library, print layout, audit-log
> viewer, full recycle-bin manager, diagnostics) stay deferred to their own
> milestones (R3/R4 data dependencies) and to R9/M10 (full S18), exactly as the
> release table already shows. MS can run any time after R2; it has no new data
> dependency beyond M1/M2.

## Doctor outcome

Open **Settings** from the left nav and change what was set at first-run: the
doctor profile, the clinic profile including **consultation and follow-up
fees** and the patient-ID prefix, the **font size** (Normal / Large / Extra
large), the **idle auto-lock** minutes, and the **data folder**. Pick which
**camera** the webcam capture uses from the cameras the computer exposes (e.g.
the laptop's built-in webcam), with a file fallback. Changes persist and take
effect immediately; nothing here needs the internet.

## Scope (this milestone)

In:
- **S18 Settings screen** mounted at `/settings` (nav item already present,
  gated by `features.settings`); reachable only after setup completes, under
  the same completion route-guard as the other shell routes.
- **Read current settings** — one command returning doctor, clinic (incl.
  `fee_consult`, `fee_followup`, `id_prefix`), and app prefs (autolock, font
  size, data folder).
- **Edit doctor profile** — qualification, phone, email, signature image.
  (Name + registration number become identity-locked only after a real licence
  is imported, R8/LIC-006; until then they are editable — reuse that guard.)
- **Edit clinic profile** — name, address, phone, timings, GSTIN, and the two
  **fees** and the **patient-ID prefix** (new codes use the updated prefix;
  existing codes are never rewritten, PAT-002).
- **Font size** (SET-005) — Normal / Large / Extra large, applied app-wide via
  the existing rem scale.
- **Auto-lock minutes** (SET-004) — change the idle timeout.
- **Data folder** (SET-006) — choose a new folder; move the data safely
  (atomic, with the same safety-copy discipline as restore).
- **Camera / webcam selection** (new, from the product owner):
  - enumerate the real camera devices the OS exposes (on a desktop with a
    webcam — e.g. the laptop's built-in camera — list it by label/id);
  - let the doctor pick the default capture device; persist the choice;
  - the S06 webcam capture honours the chosen device; **file upload remains the
    fallback**;
  - in a headless/CI environment with no camera, the picker shows "no camera
    found" and the capture falls back to the simulated/overridable seam already
    built in M2 (so E2E stays deterministic). Real multi-camera switching is
    verified on actual hardware.

Out (stay in their own milestones):
- Case templates (CASE-004, R3), advice library (RX-007, R4), print layout
  (RX-005, R4), audit-log viewer and full recycle-bin manager and diagnostics
  (ADM-002/005, R9/M10). The S18 controls for these render disabled with a
  "coming later" note (R-DEL-002), consistent with the rest of the app.

## Screens

- **S18 Settings** — `docs/ui/S18-settings.md` (editable sections only this
  milestone; the later-feature tabs are flagged off).
- Reuses S01 field definitions for the profile/clinic forms.

## Requirement ids

- SET-002, SET-003 (edit doctor/clinic profile after setup; ADM-001)
- SET-003 / PAT-002 (fees + ID prefix)
- SET-005 (font size), SET-004 (auto-lock), SET-006 (data folder)
- LIC-006 (identity lock gate on name/reg-no — editable until a real licence)
- **Camera selection** — new preference; no prior requirement id. Proposed
  **SET-007 "Camera device selection"**: the app lists available camera
  devices and lets the doctor choose the default for webcam photo capture,
  with a file fallback; add to `docs/requirements/01` section 1 (Settings) when
  this milestone is picked up.

## Backend commands (proposed, over existing hc-app + hc-storage)

- `get_settings() -> { doctor, clinic, app }` (ADM-001, SET-002..006)
- `update_doctor_profile(...)` (name/reg-no refused when identity-locked)
- `update_clinic_profile(...)` (incl. fees + id_prefix)
- `set_font_size({ size })` (SET-005)
- `set_autolock_minutes({ minutes })` (SET-004)
- `set_data_folder({ new_path })` (SET-006; atomic move + safety copy)
- `list_cameras() -> { cameras: [{ id, label }] }` and
  `set_default_camera({ camera_id })` (SET-007, new)

## Exit (Done when)

- From **Settings**, changing the doctor/clinic profile, **fees**, ID prefix,
  font size, auto-lock and data folder persists and takes effect; the values
  match on reopen.
- A new patient registered after a prefix change uses the new prefix; existing
  codes are unchanged.
- The camera picker lists the machine's real camera(s); the chosen device is
  used by S06 webcam capture; file upload still works; headless falls back to
  the simulated seam.
- Settings is reachable only after setup; no dead-end controls; earlier release
  demos still pass. Verified by unit + E2E; perf not applicable.

## Notes

- This is the *editable-settings* milestone. When M10/R9 builds the **full**
  S18 (audit log, recycle-bin manager, templates, advice, print layout), it
  extends this screen rather than replacing it.
- Positioning: run after R2 at the team's convenience; it is independent of
  the R3→R9 feature chain and improves day-one usability for the pilot.
