// @req CASE-002 NFR-030 SUX-001 VIS-001
// @tier stable
// @area case
// @targets linux
//
// HC-MVP1-M3ux — the two case-form UX fixes, proven end-to-end against the
// built desktop app (boot-gate aware, network disabled, isolated per-spec data
// dir, one provisioned launch). Mirrors the case-form.e2e.ts provisioning
// (first-run wizard -> register a MALE ADULT patient -> Take case), then:
//
//   UX2 — side-rail section TOGGLE (CASE-002):
//     * a COLLAPSED section (hpi) rail click EXPANDS it -> its panel appears;
//     * clicking the SAME rail item again HIDES it -> the panel is removed AND
//       the rail item is marked hidden (data-hidden="true" / aria-pressed=false)
//       so it stays discoverable to click back on;
//     * clicking it once more RE-SHOWS the panel (persisted via
//       case_template_set_visibility — reused, one-txn-one-audit).
//
//   UX1 — consistent Back navigation (00-conventions §3; NFR-030/SUX):
//     * the case form's Back control (`case-form-back`) returns to the patient
//       DASHBOARD (patient-dash-demographics present), NOT Today;
//     * the dashboard Back (`patient-dash-back`) returns to the patient LIST;
//     * re-entering the case form, the global Alt+Left chord also returns to
//       the dashboard (one step up the parent chain).
//
// The patient is MALE + adult (age 40, sex unset -> 'male'), so the schema-
// conditional menstrual_obstetric / child_development sections stay hidden and
// do not interfere with the rail-toggle assertions. Back never discards data
// (the clinical form autosaves, CASE-005); this spec only asserts navigation
// and visibility, never destruction. No sleeps — all waits via waitUntil /
// waitForDisplayed. The spec owns its data, so the flow is deterministic.
import { browser, expect } from "@wdio/globals";

import { bootPage } from "../../pages/boot.page.js";
import { casePage } from "../../pages/case.page.js";
import { patientsPage } from "../../pages/patients.page.js";
import { shellPage } from "../../pages/shell.page.js";
import { provisionAndEnterApp } from "../../helpers/setup-flow.js";

const PIN = "2468";
const PATIENT_NAME = "Navtoggle Testpatient";

// A section that starts COLLAPSED for a male adult (chief_complaints is the
// only section expanded on open). Its panel-presence marker is the collapse
// button the expanded SectionPanel renders (case-form-collapse-<key>).
const SECTION = "hpi";

function panelMarker(key: string): string {
  return `case-form-collapse-${key}`;
}

let patientId = "";
let visitId = "";

describe("R3ux S08 case-form UX: side-rail section toggle (UX2, CASE-002)", () => {
  it("toggles a rail section on then off then back on, keeping the hidden rail item discoverable", async () => {
    // ---- Boot-gate + provision + register a MALE adult patient -----------
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe("#/setup");
    await provisionAndEnterApp("main", PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await expect(patientsPage.form).toBeDisplayed();
    await patientsPage.fillCore({
      name: PATIENT_NAME,
      age: "40",
      city: "Pune",
    });
    await patientsPage.saveAndWaitForDashboard();
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);

    // ---- Take case -> S08 case form --------------------------------------
    await patientsPage.dashTakeCase();
    await casePage.waitForForm();
    const ids = await casePage.routeIds();
    patientId = ids.patientId;
    visitId = ids.visitId;
    expect(patientId.length).toBeGreaterThan(0);
    expect(visitId.length).toBeGreaterThan(0);
    // eslint-disable-next-line no-console
    console.log(`[ux] Take case -> /patient/${patientId}/case/${visitId}`);

    // The target section starts collapsed: its panel marker is absent.
    await casePage.section(SECTION).waitForDisplayed({ timeout: 15000 });
    expect(await casePage.panelFieldExists(panelMarker(SECTION))).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] rail section "${SECTION}" starts collapsed (panel absent)`,
    );

    // (1) Rail click EXPANDS -> the section panel APPEARS.
    await casePage.railToggle(SECTION);
    await browser.waitUntil(
      async () => casePage.panelFieldExists(panelMarker(SECTION)),
      {
        timeout: 10000,
        timeoutMsg: `panel for ${SECTION} did not appear after rail click`,
      },
    );
    expect(await casePage.panelFieldExists(panelMarker(SECTION))).toBe(true);
    expect(await casePage.sectionIsExpanded(SECTION)).toBe(true);
    expect(await casePage.sectionIsHidden(SECTION)).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] rail click #1 -> "${SECTION}" panel APPEARS (aria-expanded=true)`,
    );

    // (2) Click the SAME rail item again -> the panel is REMOVED and the rail
    //     item is marked hidden (discoverable to click back on).
    await casePage.railToggle(SECTION);
    await browser.waitUntil(
      async () => !(await casePage.panelFieldExists(panelMarker(SECTION))),
      {
        timeout: 10000,
        timeoutMsg: `panel for ${SECTION} did not disappear after 2nd rail click`,
      },
    );
    expect(await casePage.panelFieldExists(panelMarker(SECTION))).toBe(false);
    await browser.waitUntil(async () => casePage.sectionIsHidden(SECTION), {
      timeout: 10000,
      timeoutMsg: `rail item "${SECTION}" did not get its hidden indicator`,
    });
    expect(await casePage.sectionIsHidden(SECTION)).toBe(true);
    // The hidden rail item is STILL present (not gone like a dialog-hidden one).
    expect(await casePage.section(SECTION).isExisting()).toBe(true);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] rail click #2 -> "${SECTION}" panel REMOVED; rail item marked data-hidden/aria-pressed=false, still present`,
    );

    // (3) Click the hidden rail item again -> the panel RE-APPEARS.
    await casePage.railToggle(SECTION);
    await browser.waitUntil(
      async () => casePage.panelFieldExists(panelMarker(SECTION)),
      {
        timeout: 10000,
        timeoutMsg: `panel for ${SECTION} did not re-appear on re-show`,
      },
    );
    expect(await casePage.panelFieldExists(panelMarker(SECTION))).toBe(true);
    expect(await casePage.sectionIsHidden(SECTION)).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] rail click #3 -> "${SECTION}" RE-SHOWN (discoverable toggle round-trip proven)`,
    );
  });
});

describe("R3ux S08 case-form UX: consistent Back navigation (UX1, 00-conventions §3 / NFR-030)", () => {
  it("Back goes case form -> patient DASHBOARD (not Today), dashboard Back -> patient LIST, and Alt+Left -> dashboard", async () => {
    // Continue in the same provisioned launch; reopen the exact visit.
    await casePage.openVisit(patientId, visitId);
    expect(await casePage.hasBack()).toBe(true);
    // eslint-disable-next-line no-console
    console.log("[ux] case form has a first-class Back control (no dead end)");

    // Back -> patient DASHBOARD (/patients?id=:patientId), NOT Today.
    await casePage.clickBack();
    await patientsPage.waitForDashboard();
    const afterBackHash = await browser.execute(() => window.location.hash);
    expect(afterBackHash).toContain("/patients");
    expect(afterBackHash).toContain(`id=${encodeURIComponent(patientId)}`);
    expect(await patientsPage.dashboardText()).toContain(PATIENT_NAME);
    // Prove it is the DASHBOARD, not Today: the Today screen is absent.
    expect(await shellPage.todayScreen.isExisting()).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] case Back -> DASHBOARD hash="${afterBackHash}" (Today screen absent)`,
    );

    // Dashboard Back -> patient LIST. The /patients container (PatientsPage)
    // switches its S05/S06/S07 sub-views via internal React state, not the URL
    // hash (the ?id= deep-link only seeds the INITIAL view), so "landed on the
    // list" is proven by the rendered screen: the list title is shown and the
    // dashboard demographics are gone — not by the hash (which legitimately
    // keeps the seeding ?id=). The case->dashboard hop above IS hash-driven
    // because AppShell navigates /patients?id= for it.
    await patientsPage.dashBack();
    await patientsPage.waitForList();
    expect(await patientsPage.listTitle.isDisplayed()).toBe(true);
    expect(await patientsPage.dashDemographics.isExisting()).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      "[ux] dashboard Back -> LIST (list title shown, dashboard demographics gone)",
    );

    // Re-enter the case form and prove the global Alt+Left Back chord also
    // lands on the DASHBOARD (one step up the parent chain).
    await casePage.openVisit(patientId, visitId);
    await casePage.altLeftBack();
    await patientsPage.waitForDashboard();
    const afterAltHash = await browser.execute(() => window.location.hash);
    expect(afterAltHash).toContain("/patients");
    expect(afterAltHash).toContain(`id=${encodeURIComponent(patientId)}`);
    expect(await shellPage.todayScreen.isExisting()).toBe(false);
    // eslint-disable-next-line no-console
    console.log(
      `[ux] Alt+Left from case form -> DASHBOARD hash="${afterAltHash}"`,
    );
  });
});
