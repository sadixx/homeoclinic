// Page object for the S05/S06/S07 patient UI (docs/ui/S05-patient-list.md,
// S06-patient-form.md, S07-patient-dashboard.md; PAT-001/002/005/006/008,
// PSR-008). hc-e2e-testing rule: specs use page objects; selectors are
// data-testid only, never raw CSS/XPath in specs. No sleeps — all waits go
// through waitUntil / WebdriverIO auto-waiting waitForDisplayed.
//
// The /patients route is reached the way the app reaches it: in-page via the
// HashRouter (location.hash), the same technique setup.page / lock.page use
// (browser.url rejects a bare "#/patients"). Deep-links carry ?view=new (S06
// register) or ?id=<patientId> (S07 dashboard), exactly as AppShell's
// PatientsRoute reads them.
import { $, $$, browser } from "@wdio/globals";

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The patient list (S05), register/edit form (S06) and dashboard (S07). */
export class PatientsPage {
  // ---- S05 list ----------------------------------------------------------
  get listTitle(): ChainablePromiseElement {
    return byTestId("patient-list-title");
  }

  get listResults(): ChainablePromiseElement {
    return byTestId("patient-list-results");
  }

  get listRows(): ReturnType<typeof $$> {
    return $$('[data-testid="patient-list-row"]');
  }

  // ---- S06 register / edit form ------------------------------------------
  get form(): ChainablePromiseElement {
    return byTestId("patient-form");
  }

  get formTitle(): ChainablePromiseElement {
    return byTestId("patient-form-title");
  }

  get formCode(): ChainablePromiseElement {
    return byTestId("patient-form-code");
  }

  get formName(): ChainablePromiseElement {
    return byTestId("patient-form-name");
  }

  get formAge(): ChainablePromiseElement {
    return byTestId("patient-form-age");
  }

  get formMobile(): ChainablePromiseElement {
    return byTestId("patient-form-mobile");
  }

  get formCity(): ChainablePromiseElement {
    return byTestId("patient-form-city");
  }

  get formSave(): ChainablePromiseElement {
    return byTestId("patient-form-save");
  }

  // Photo column (PAT-038).
  get photoBox(): ChainablePromiseElement {
    return byTestId("patient-form-photo");
  }

  get photoImg(): ChainablePromiseElement {
    return byTestId("patient-form-photo-img");
  }

  get photoNone(): ChainablePromiseElement {
    return byTestId("patient-form-photo-none");
  }

  get photoWebcamBtn(): ChainablePromiseElement {
    return byTestId("patient-form-photo-webcam");
  }

  get photoFileInput(): ChainablePromiseElement {
    return byTestId("patient-form-photo-file-input");
  }

  get photoRemoveBtn(): ChainablePromiseElement {
    return byTestId("patient-form-photo-remove");
  }

  get photoDenied(): ChainablePromiseElement {
    return byTestId("patient-form-photo-denied");
  }

  // ---- S07 dashboard -----------------------------------------------------
  get dashDemographics(): ChainablePromiseElement {
    return byTestId("patient-dash-demographics");
  }

  get dashFamily(): ChainablePromiseElement {
    return byTestId("patient-dash-family");
  }

  get dashTimeline(): ChainablePromiseElement {
    return byTestId("patient-dash-timeline");
  }

  // ---- M3-RWv6 item 9: visits newest first + last prescription ----------
  /** Rendered visit rows, top to bottom: [date text, type text]. */
  async dashVisitRows(): Promise<{ date: string; type: string }[]> {
    return browser.execute(() =>
      Array.from(
        document.querySelectorAll('[data-testid="patient-dash-visit-row"]'),
      ).map((li) => {
        const spans = li.querySelectorAll("span");
        return {
          date: (spans[0]?.textContent ?? "").trim(),
          type: (spans[1]?.textContent ?? "").trim(),
        };
      }),
    );
  }

  /** Text of an optional dashboard element, or null when it is absent. */
  async dashTextOrNull(testId: string): Promise<string | null> {
    const el = byTestId(testId);
    if (!(await el.isExisting())) return null;
    return (await el.getText()).trim();
  }

  /** Attributes of an open preview: title name + href/src of its content. */
  async previewInfo(
    testId: string,
  ): Promise<{ name: string; href: string | null; download: string | null; src: string | null }> {
    return browser.execute((id: string) => {
      const root = document.querySelector(`[data-testid="${id}"]`);
      const a = root?.querySelector(`[data-testid="${id}-download"]`) ?? null;
      const img = root?.querySelector(`[data-testid="${id}-image"]`) ?? null;
      return {
        name: (root?.getAttribute("aria-label") ?? root?.querySelector("h2,h3")?.textContent ?? "").trim(),
        href: a?.getAttribute("href") ?? null,
        download: a?.getAttribute("download") ?? null,
        src: img?.getAttribute("src") ?? null,
      };
    }, testId);
  }

  get dashEdit(): ChainablePromiseElement {
    return byTestId("patient-dash-edit");
  }

  get dashDelete(): ChainablePromiseElement {
    return byTestId("patient-dash-delete");
  }

  get dashDeleteConfirm(): ChainablePromiseElement {
    return byTestId("patient-dash-delete-confirm");
  }

  get dashDeletedBanner(): ChainablePromiseElement {
    return byTestId("patient-dash-deleted-banner");
  }

  get dashRestore(): ChainablePromiseElement {
    return byTestId("patient-dash-restore");
  }

  // S08 consultation entry (R3, features.case): "New visit" / "Take case".
  get dashTakeCaseBtn(): ChainablePromiseElement {
    return byTestId("patient-dash-take-case");
  }

  get dashNewVisitBtn(): ChainablePromiseElement {
    return byTestId("patient-dash-new-visit");
  }

  // S07 dashboard Back control (UX1): returns to the patient LIST.
  get dashBackBtn(): ChainablePromiseElement {
    return byTestId("patient-dash-back");
  }

  /** Click the dashboard Back control (UX1 -> patient list). */
  async dashBack(timeout = 15000): Promise<void> {
    await this.dashBackBtn.waitForClickable({ timeout });
    await this.dashBackBtn.click();
  }

  /** Wait until the S07 dashboard demographics are shown (landed on dashboard). */
  async waitForDashboard(timeout = 20000): Promise<void> {
    await this.dashDemographics.waitForExist({ timeout });
    await this.dashDemographics.waitForDisplayed({ timeout });
  }

  /** Wait until the S05 patient list title is shown (landed on the list). */
  async waitForList(timeout = 20000): Promise<void> {
    await this.listTitle.waitForExist({ timeout });
    await this.listTitle.waitForDisplayed({ timeout });
  }

  /**
   * Click "Take case" on the S07 dashboard to open-or-create a First visit and
   * route into the S08 case form (CASE / VIS-001). Both this and "New visit"
   * call onTakeCase -> case_visit_open_or_create -> navigate
   * /patient/:id/case/:visitId; the caller waits for the case form.
   */
  async dashTakeCase(timeout = 15000): Promise<void> {
    await this.dashTakeCaseBtn.waitForClickable({ timeout });
    await this.dashTakeCaseBtn.click();
  }

  /**
   * Click "New visit" on the S07 dashboard. When the patient has a prior visit
   * the dashboard resolves this to onNewFollowup (S09 follow-up); with no prior
   * visit it falls back to onTakeCase (S08). The caller waits for the resulting
   * screen (followupPage.waitForScreen / casePage.waitForForm).
   */
  async dashNewVisit(timeout = 15000): Promise<void> {
    await this.dashNewVisitBtn.waitForClickable({ timeout });
    await this.dashNewVisitBtn.click();
  }

  // ---- navigation --------------------------------------------------------

  /** Open the S06 register form via the deep-link the search overlay uses. */
  async openRegister(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = "#/patients?view=new";
    });
    await this.form.waitForExist({ timeout });
    await this.form.waitForDisplayed({ timeout });
  }

  /** Open the S05 list. */
  async openList(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = "#/patients";
    });
    await this.listTitle.waitForExist({ timeout });
    await this.listTitle.waitForDisplayed({ timeout });
  }

  /** Open a specific patient's S07 dashboard by id (the search Enter path). */
  async openDashboard(patientId: string, timeout = 20000): Promise<void> {
    await browser.execute((id: string) => {
      window.location.hash = `#/patients?id=${encodeURIComponent(id)}`;
    }, patientId);
    await this.dashDemographics.waitForExist({ timeout });
    await this.dashDemographics.waitForDisplayed({ timeout });
  }

  // ---- form actions ------------------------------------------------------

  /** Fill the minimum required register fields (name + age), plus optionals. */
  async fillCore(fields: {
    name: string;
    age: string;
    mobile?: string;
    city?: string;
  }): Promise<void> {
    await this.formName.waitForDisplayed({ timeout: 10000 });
    await this.formName.setValue(fields.name);
    await this.formAge.setValue(fields.age);
    if (fields.mobile !== undefined) {
      await this.formMobile.setValue(fields.mobile);
    }
    if (fields.city !== undefined) {
      await this.formCity.setValue(fields.city);
    }
  }

  /**
   * Force the deterministic camera grant/deny via the window override the app
   * honours (photo.ts simulateCameraAccess), then click "Use webcam". With
   * 'grant' a captured frame is attached; with 'deny' the denied note shows.
   */
  async setCameraOverride(mode: "grant" | "deny"): Promise<void> {
    await browser.execute((m: "grant" | "deny") => {
      (window as unknown as { __HC_E2E_CAMERA__?: string }).__HC_E2E_CAMERA__ =
        m;
    }, mode);
  }

  async clickWebcam(): Promise<void> {
    await this.photoWebcamBtn.click();
  }

  /**
   * Attach a photo via the file input (PAT-038 file branch). The input is
   * visually hidden (`sr-only`) because real users trigger it through the
   * "Choose file" button; WebKitWebDriver refuses setValue on a
   * non-interactable element, so we momentarily drop the clipping class, upload
   * the file, then restore it. Focuses the SAME production <input type=file>
   * the button clicks, so the attach path under test is unchanged.
   */
  async attachPhotoFile(localPath: string): Promise<void> {
    await this.photoFileInput.waitForExist({ timeout: 10000 });
    await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="patient-form-photo-file-input"]',
      ) as HTMLElement | null;
      if (el !== null) {
        el.classList.remove("sr-only");
        el.style.position = "static";
        el.style.width = "auto";
        el.style.height = "auto";
        el.style.clip = "auto";
      }
    });
    await this.photoFileInput.setValue(localPath);
    await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="patient-form-photo-file-input"]',
      ) as HTMLElement | null;
      if (el !== null) {
        el.classList.add("sr-only");
      }
    });
  }

  async removePhoto(): Promise<void> {
    await this.photoRemoveBtn.click();
  }

  /** True when a photo preview <img> is attached to the form. */
  async hasPhoto(): Promise<boolean> {
    return this.photoImg.isExisting();
  }

  /**
   * Save the form and wait until the app leaves the form for the dashboard
   * (the S06 onSaved -> openDashboard transition). Returns nothing; callers
   * read the dashboard demographics afterwards.
   */
  async saveAndWaitForDashboard(timeout = 20000): Promise<void> {
    await this.formSave.waitForClickable({ timeout: 10000 });
    await this.formSave.click();
    await this.dashDemographics.waitForDisplayed({ timeout });
  }

  /** The visible demographics text on the dashboard (name/code/mobile/city). */
  async dashboardText(): Promise<string> {
    return (await this.dashDemographics.getText()).trim();
  }

  /** Move the open patient to the recycle bin (confirm dialog). */
  async recycle(timeout = 15000): Promise<void> {
    await this.dashDelete.click();
    await this.dashDeleteConfirm.waitForDisplayed({ timeout });
    await this.dashDeleteConfirm.click();
    await this.dashDeletedBanner.waitForDisplayed({ timeout });
  }

  /** Restore the open (soft-deleted) patient from the recycle bin. */
  async restore(timeout = 15000): Promise<void> {
    await this.dashRestore.click();
    await browser.waitUntil(
      async () => !(await this.dashDeletedBanner.isExisting()),
      {
        timeout,
        timeoutMsg: "patient still shows the recycle-bin banner after restore",
      },
    );
  }

  // ---- M3-RWv5 C1/C2: marital options + default gender avatar -------------
  get formMarital(): ChainablePromiseElement {
    return byTestId("patient-form-marital");
  }

  /** The marital <select> options as {value,label}, in order. */
  async maritalOptions(): Promise<{ value: string; label: string }[]> {
    await this.formMarital.waitForExist({ timeout: 10000 });
    return browser.execute(() => {
      const sel = document.querySelector(
        '[data-testid="patient-form-marital"]',
      ) as HTMLSelectElement | null;
      if (sel === null) return [];
      return Array.from(sel.options).map((o) => ({
        value: o.value,
        label: (o.textContent ?? "").trim(),
      }));
    });
  }

  async setMarital(value: string): Promise<void> {
    await this.formMarital.selectByAttribute("value", value);
  }

  /** Pick a sex radio (M / F / O) inside the patient-form-sex group. */
  async setSex(value: "M" | "F" | "O"): Promise<void> {
    const radio = $(`[data-testid="patient-form-sex"] input[value="${value}"]`);
    await radio.waitForExist({ timeout: 10000 });
    await radio.click();
  }

  /** `data-avatar` of the avatar with `testId`, or null when it is absent. */
  async avatarKind(testId: string): Promise<string | null> {
    const el = byTestId(testId);
    if (!(await el.isExisting())) return null;
    return el.getAttribute("data-avatar");
  }

  /** True when the dashboard photo slot shows a real <img>. */
  async dashHasPhotoImg(): Promise<boolean> {
    return browser.execute(
      () =>
        document.querySelector('[data-testid="patient-dash-photo"] img') !==
        null,
    );
  }

  // ---- S07 Lab reports & Scans PANEL (M3-RWv4 §4, two-way) ----------------
  get labReportsPanel(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-panel");
  }

  get labReportsList(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-list");
  }

  get labReportsEmpty(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-empty");
  }

  labReportsItem(n: number): ChainablePromiseElement {
    return byTestId(`patient-dash-lab-reports-item-${n}`);
  }

  labReportsBadge(n: number): ChainablePromiseElement {
    return byTestId(`patient-dash-lab-reports-badge-${n}`);
  }

  labReportsOpen(n: number): ChainablePromiseElement {
    return byTestId(`patient-dash-lab-reports-open-${n}`);
  }

  labReportsDelete(n: number): ChainablePromiseElement {
    return byTestId(`patient-dash-lab-reports-delete-${n}`);
  }

  get labReportsDeleteDialog(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-delete-dialog");
  }

  get labReportsDeleteConfirm(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-delete-confirm");
  }

  get labReportsDeleteCancel(): ChainablePromiseElement {
    return byTestId("patient-dash-lab-reports-delete-cancel");
  }

  /** Wait until the Lab reports & Scans panel is visible on the dashboard. */
  async waitForLabReportsPanel(timeout = 20000): Promise<void> {
    await this.labReportsPanel.waitForExist({ timeout });
    await this.labReportsPanel.waitForDisplayed({ timeout });
  }

  /** Number of lab-report items in the panel (0 when the list is absent). */
  async labReportsCount(): Promise<number> {
    if (!(await this.labReportsList.isExisting())) return 0;
    const items = await $(
      '[data-testid="patient-dash-lab-reports-list"]',
    ).$$("li");
    return items.length;
  }

  /** The visible display label/text of lab-report item n (1-based). */
  async labReportsLabel(n: number): Promise<string> {
    await this.labReportsItem(n).waitForDisplayed({ timeout: 15000 });
    // Read the label span's textContent via the DOM. The item is
    // `<li><div><span badge/><span label/></div><div>Open/Delete</div></li>`;
    // WebDriver getText() on the whole item also returns the badge + button
    // text (and the `truncate` label span can read empty under
    // WebKitWebDriver), so take the first span WITHOUT the badge testid.
    const label = await browser.execute((idx: number) => {
      const li = document.querySelector(`[data-testid="patient-dash-lab-reports-item-${idx}"]`);
      if (li === null) return "";
      const spans = Array.from(li.querySelectorAll("span"));
      for (const span of spans) {
        const tid = span.getAttribute("data-testid");
        if (tid === null || !tid.includes("lab-reports-badge")) {
          const txt = (span.textContent ?? "").trim();
          if (txt.length > 0) return txt;
        }
      }
      return (li.textContent ?? "").trim();
    }, n);
    return label;
  }

  /**
   * Delete lab-report item n from the panel behind the confirm dialog and wait
   * for the list to shrink to `expected` items.
   */
  async deleteLabReportAndWaitForCount(
    n: number,
    expected: number,
    timeout = 20000,
  ): Promise<void> {
    await this.labReportsDelete(n).waitForClickable({ timeout: 15000 });
    await this.labReportsDelete(n).click();
    await this.labReportsDeleteDialog.waitForDisplayed({ timeout: 15000 });
    await this.labReportsDeleteConfirm.waitForClickable({ timeout: 15000 });
    await this.labReportsDeleteConfirm.click();
    await browser.waitUntil(
      async () => (await this.labReportsCount()) === expected,
      {
        timeout,
        timeoutMsg: `lab-reports panel did not shrink to ${expected} item(s) after delete`,
      },
    );
  }
}

export const patientsPage = new PatientsPage();
