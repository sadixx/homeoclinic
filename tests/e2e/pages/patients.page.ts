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
import { $, $$, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** The patient list (S05), register/edit form (S06) and dashboard (S07). */
export class PatientsPage {
  // ---- S05 list ----------------------------------------------------------
  get listTitle(): ChainablePromiseElement {
    return byTestId('patient-list-title');
  }

  get listResults(): ChainablePromiseElement {
    return byTestId('patient-list-results');
  }

  get listRows(): ReturnType<typeof $$> {
    return $$('[data-testid="patient-list-row"]');
  }

  // ---- S06 register / edit form ------------------------------------------
  get form(): ChainablePromiseElement {
    return byTestId('patient-form');
  }

  get formTitle(): ChainablePromiseElement {
    return byTestId('patient-form-title');
  }

  get formCode(): ChainablePromiseElement {
    return byTestId('patient-form-code');
  }

  get formName(): ChainablePromiseElement {
    return byTestId('patient-form-name');
  }

  get formAge(): ChainablePromiseElement {
    return byTestId('patient-form-age');
  }

  get formMobile(): ChainablePromiseElement {
    return byTestId('patient-form-mobile');
  }

  get formCity(): ChainablePromiseElement {
    return byTestId('patient-form-city');
  }

  get formSave(): ChainablePromiseElement {
    return byTestId('patient-form-save');
  }

  // Photo column (PAT-038).
  get photoBox(): ChainablePromiseElement {
    return byTestId('patient-form-photo');
  }

  get photoImg(): ChainablePromiseElement {
    return byTestId('patient-form-photo-img');
  }

  get photoNone(): ChainablePromiseElement {
    return byTestId('patient-form-photo-none');
  }

  get photoWebcamBtn(): ChainablePromiseElement {
    return byTestId('patient-form-photo-webcam');
  }

  get photoFileInput(): ChainablePromiseElement {
    return byTestId('patient-form-photo-file-input');
  }

  get photoRemoveBtn(): ChainablePromiseElement {
    return byTestId('patient-form-photo-remove');
  }

  get photoDenied(): ChainablePromiseElement {
    return byTestId('patient-form-photo-denied');
  }

  // ---- S07 dashboard -----------------------------------------------------
  get dashDemographics(): ChainablePromiseElement {
    return byTestId('patient-dash-demographics');
  }

  get dashFamily(): ChainablePromiseElement {
    return byTestId('patient-dash-family');
  }

  get dashTimeline(): ChainablePromiseElement {
    return byTestId('patient-dash-timeline');
  }

  get dashEdit(): ChainablePromiseElement {
    return byTestId('patient-dash-edit');
  }

  get dashDelete(): ChainablePromiseElement {
    return byTestId('patient-dash-delete');
  }

  get dashDeleteConfirm(): ChainablePromiseElement {
    return byTestId('patient-dash-delete-confirm');
  }

  get dashDeletedBanner(): ChainablePromiseElement {
    return byTestId('patient-dash-deleted-banner');
  }

  get dashRestore(): ChainablePromiseElement {
    return byTestId('patient-dash-restore');
  }

  // ---- navigation --------------------------------------------------------

  /** Open the S06 register form via the deep-link the search overlay uses. */
  async openRegister(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/patients?view=new';
    });
    await this.form.waitForExist({ timeout });
    await this.form.waitForDisplayed({ timeout });
  }

  /** Open the S05 list. */
  async openList(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/patients';
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
  async setCameraOverride(mode: 'grant' | 'deny'): Promise<void> {
    await browser.execute((m: 'grant' | 'deny') => {
      (window as unknown as { __HC_E2E_CAMERA__?: string }).__HC_E2E_CAMERA__ = m;
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
        el.classList.remove('sr-only');
        el.style.position = 'static';
        el.style.width = 'auto';
        el.style.height = 'auto';
        el.style.clip = 'auto';
      }
    });
    await this.photoFileInput.setValue(localPath);
    await browser.execute(() => {
      const el = document.querySelector(
        '[data-testid="patient-form-photo-file-input"]',
      ) as HTMLElement | null;
      if (el !== null) {
        el.classList.add('sr-only');
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
    await browser.waitUntil(async () => !(await this.dashDeletedBanner.isExisting()), {
      timeout,
      timeoutMsg: 'patient still shows the recycle-bin banner after restore',
    });
  }
}

export const patientsPage = new PatientsPage();
