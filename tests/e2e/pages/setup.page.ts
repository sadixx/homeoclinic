// Page object for the S01 first-run setup wizard (docs/ui/S01-first-run-setup.md).
// hc-e2e-testing rule: specs use page objects; selectors are data-testid only,
// never raw CSS/XPath in specs. No sleeps — all waits go through waitUntil /
// WebdriverIO auto-waiting waitForDisplayed.
import { $, browser } from '@wdio/globals';

function byTestId(id: string): ChainablePromiseElement {
  return $(`[data-testid="${id}"]`);
}

/** Council every shared-setup spec picks from the Step 1 dropdown. */
export const DEFAULT_COUNCIL_LABEL =
  'Maharashtra — Maharashtra Council of Homoeopathy';

/** The four-step first-run wizard (SET-001..004, LIC-063 dev trial). */
export class SetupPage {
  get wizard(): ChainablePromiseElement {
    return byTestId('setup-wizard');
  }

  get stepIndicator(): ChainablePromiseElement {
    return byTestId('setup-step-indicator');
  }

  get next(): ChainablePromiseElement {
    return byTestId('setup-next');
  }

  get finish(): ChainablePromiseElement {
    return byTestId('setup-finish');
  }

  // Step 3 security / recovery.
  get recoveryCode(): ChainablePromiseElement {
    return byTestId('setup-recovery-code');
  }

  get recoveryPrint(): ChainablePromiseElement {
    return byTestId('setup-recovery-print');
  }

  get recoveryAck(): ChainablePromiseElement {
    return byTestId('setup-recovery-ack');
  }

  // Step 4 licence.
  get licenceDevTrial(): ChainablePromiseElement {
    // The "Development trial" heading panel on the licence step.
    return byTestId('setup-licence-choice');
  }

  /**
   * Navigate the app to the first-run wizard route and wait for it. The app
   * uses a HashRouter served from a tauri:// origin, so we drive the route by
   * setting location.hash in-page (browser.url rejects a bare "#/setup" as an
   * invalid URL) rather than reloading.
   */
  async open(timeout = 20000): Promise<void> {
    await browser.execute(() => {
      window.location.hash = '#/setup';
    });
    await this.wizard.waitForExist({ timeout });
    await this.wizard.waitForDisplayed({ timeout });
  }

  private async setField(testid: string, value: string): Promise<void> {
    const el = byTestId(testid);
    await el.waitForDisplayed({ timeout: 10000 });
    await el.setValue(value);
  }

  get back(): ChainablePromiseElement {
    return byTestId('setup-back');
  }

  // Step 1 registration council (HC-MVP1-M3set): a <select> of the verified
  // registering authorities + "Other (type manually)" revealing a text box.
  get council(): ChainablePromiseElement {
    return byTestId('setup-doctor-council');
  }

  get councilError(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-error');
  }

  get councilOther(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-other');
  }

  get councilOtherError(): ChainablePromiseElement {
    return byTestId('setup-doctor-council-other-error');
  }

  /**
   * Choose a council by its visible label. The current build renders a
   * <select>; an older build (the R1 binary driven by upgrade-path PHASE C)
   * still renders a free-text <input>, so type the label there instead.
   */
  async selectCouncil(label: string): Promise<void> {
    const el = this.council;
    await el.waitForDisplayed({ timeout: 10000 });
    if ((await el.getTagName()).toLowerCase() === 'select') {
      await el.selectByVisibleText(label);
      await browser.waitUntil(async () => (await el.getValue()) !== '', {
        timeout: 10000,
        timeoutMsg: `council option "${label}" was not selected`,
      });
    } else {
      await el.setValue(label);
    }
  }

  /** Visible texts of every council <option>, in DOM order (read via the testid'd select). */
  async councilOptionTexts(): Promise<string[]> {
    const el = await this.council;
    await el.waitForDisplayed({ timeout: 10000 });
    return browser.execute(
      (sel: HTMLSelectElement) =>
        Array.from(sel.options).map((o) => o.text),
      el as unknown as HTMLSelectElement,
    );
  }

  /** Current value of the council <select> ('' | listed label | '__other__'). */
  async councilValue(): Promise<string> {
    return this.council.getValue();
  }

  /** Type into the Other council text box (shown only when Other is chosen). */
  async typeCouncilOther(text: string): Promise<void> {
    await this.setField('setup-doctor-council-other', text);
  }

  /** Fill the non-council required step-1 fields with synthetic data. */
  async fillDoctorBasics(): Promise<void> {
    await this.setField('setup-doctor-name', 'Dr Aarti Rao');
    await this.setField('setup-doctor-qualification', 'BHMS');
    await this.setField('setup-doctor-regno', 'HMC-12345');
  }

  /** Press Next and wait until the step rail reports `step`. */
  async nextAndWaitForStep(step: number, what: string): Promise<void> {
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(` ${step} `),
      { timeout: 10000, timeoutMsg: `did not advance to step ${step} (${what})` },
    );
  }

  /** Press Back and wait until the step rail reports `step`. */
  async backAndWaitForStep(step: number): Promise<void> {
    await this.back.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(` ${step} `),
      { timeout: 10000, timeoutMsg: `did not go back to step ${step}` },
    );
  }

  /** Fill step 1 (doctor) and advance. */
  async fillDoctorAndNext(): Promise<void> {
    await this.fillDoctorBasics();
    await this.selectCouncil(DEFAULT_COUNCIL_LABEL);
    await this.nextAndWaitForStep(2, 'clinic');
  }

  /** Fill step 2 (clinic) and advance. */
  async fillClinicAndNext(): Promise<void> {
    await this.setField('setup-clinic-name', 'Rao Homoeo Clinic');
    await this.setField('setup-clinic-address', '12 MG Road, Pune 411001');
    await this.setField('setup-clinic-fee-first', '500');
    await this.setField('setup-clinic-fee-followup', '300');
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(' 3 '),
      { timeout: 10000, timeoutMsg: 'did not advance to step 3 (security)' },
    );
  }

  /**
   * Step 3 phase 1: set + confirm the PIN and press Next, which reveals the
   * one-time recovery code (SET-004). Returns the revealed code text.
   */
  async setPinAndRevealRecovery(pin: string): Promise<string> {
    await this.setField('setup-pin', pin);
    await this.setField('setup-pin-confirm', pin);
    await this.next.click();
    await this.recoveryCode.waitForDisplayed({
      timeout: 10000,
    });
    const code = (await this.recoveryCode.getText()).trim();
    return code;
  }

  /** Step 3 phase 2: acknowledge the recovery code then advance to licence. */
  async ackRecoveryAndNext(): Promise<void> {
    await this.recoveryAck.click();
    await this.next.click();
    await browser.waitUntil(
      async () => (await this.stepIndicator.getText()).includes(' 4 '),
      { timeout: 10000, timeoutMsg: 'did not advance to step 4 (licence)' },
    );
  }

  /** Step 4: finish setup (development-trial path is the default). */
  async finishSetup(): Promise<void> {
    await this.finish.waitForDisplayed({ timeout: 10000 });
    await this.finish.click();
  }
}

export const setupPage = new SetupPage();
