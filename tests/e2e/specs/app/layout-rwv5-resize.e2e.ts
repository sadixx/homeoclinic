// @req NFR-030, SET-005, PAT-001, CASE-001
// @tier stable
// @area settings
// @targets linux
// Linux only: resizes the window under GDK_BACKEND=x11 on Xvfb.
//
// M3-RWv5 C fluid layout: at window sizes small (the app minimum, requested
// 900x600), large (1600x1000) and maximised, each at zoom 1.0 and 1.3, the
// Today, register-form, dashboard and case screens REFLOW — the page never
// scrolls sideways and no visible data-testid element crosses the left/right
// viewport edge — and the fluid containers track the window width (no fixed
// max-width column).
//
// Window sizing needs the app on X11: the before() hook sets GDK_BACKEND=x11
// and relaunches the driver chain (the env is fixed at driver spawn, see
// helpers/driver.ts) — otherwise GDK may attach to a host Wayland session
// instead of the runner's Xvfb. Under Xvfb there is no WM, so "maximised"
// falls back to the full screen size (layout.page.ts). No sleeps.
import { browser, expect } from '@wdio/globals';

import { appBarPage } from '../../pages/appbar.page.js';
import { bootPage } from '../../pages/boot.page.js';
import { caseRichPage } from '../../pages/case-rich.page.js';
import { layoutPage } from '../../pages/layout.page.js';
import { patientsPage } from '../../pages/patients.page.js';
import { shellPage } from '../../pages/shell.page.js';
import { provisionAndEnterApp } from '../../helpers/setup-flow.js';
import { evidence } from '../../helpers/evidence.js';
import { relaunchInto } from '../../helpers/launch.js';

const PIN = '8642';
const PATIENT_NAME = 'Fluida Testpatient';

describe('M3-RWv5 fluid resize: small / large / maximised x zoom 1.0 / 1.3 reflow without horizontal clipping (NFR-030, SET-005)', () => {
  before(async () => {
    process.env.GDK_BACKEND = 'x11';
    await relaunchInto('main');
  });

  after(() => {
    delete process.env.GDK_BACKEND;
  });

  it('reflows Today, register, dashboard and case screens at every size and zoom with no horizontal clipping', async () => {
    const decided = await bootPage.waitForDecidedScreen();
    expect(decided).toBe('#/setup');
    await provisionAndEnterApp('main', PIN);
    await shellPage.waitForShell();

    await patientsPage.openRegister();
    await patientsPage.fillCore({ name: PATIENT_NAME, age: '29', city: 'Pune' });
    await patientsPage.setSex('F');
    await patientsPage.saveAndWaitForDashboard();
    await patientsPage.dashTakeCase();
    await caseRichPage.waitForForm();
    const { patientId, visitId } = await caseRichPage.routeIds();
    await caseRichPage.addComplaint('Eczema');
    await caseRichPage.typeProse('Dry itchy patches on both forearms.');
    await caseRichPage.recordVitals({ sys: '110', dia: '70', pulse: '68', weight: '55', height: '160' });
    await caseRichPage.recordModalities('Weather', 'Winter', 'Summer');
    await caseRichPage.save();
    await caseRichPage.waitForSaved();

    const screens: { name: string; open: () => Promise<void>; fluidId: string }[] = [
      {
        name: 'today',
        open: async () => {
          await shellPage.navToday.click();
          await shellPage.todayScreen.waitForDisplayed({ timeout: 15000 });
        },
        fluidId: 'content-area',
      },
      { name: 'register', open: () => patientsPage.openRegister(), fluidId: 'patient-form' },
      { name: 'dashboard', open: () => patientsPage.openDashboard(patientId), fluidId: 'patient-dash-timeline' },
      { name: 'case', open: () => caseRichPage.openVisit(patientId, visitId), fluidId: 'case-form' },
    ];
    const sizes: { name: string; apply: () => Promise<{ w: number; h: number; via?: string }> }[] = [
      { name: 'small', apply: () => layoutPage.setSize(900, 600) },
      { name: 'large', apply: () => layoutPage.setSize(1600, 1000) },
      { name: 'maximised', apply: () => layoutPage.maximise() },
    ];
    const widths: Record<string, number> = {};
    const failures: string[] = [];

    for (const zoom of [1.0, 1.3]) {
      await appBarPage.zoomReset();
      for (let i = 0; i < Math.round((zoom - 1) * 10); i += 1) await appBarPage.zoomIn();
      await browser.waitUntil(async () => Math.abs((await appBarPage.scale()) - zoom) < 0.01, {
        timeout: 10000,
        timeoutMsg: `zoom did not reach ${zoom}`,
      });
      for (const size of sizes) {
        const got = await size.apply();
        for (const s of screens) {
          await s.open();
          // Let layout settle: the fluid container must report a stable width.
          let last = -1;
          await browser.waitUntil(
            async () => {
              const w = await layoutPage.widthOf(s.fluidId);
              const stable = w > 0 && w === last;
              last = w;
              return stable;
            },
            { timeout: 10000, interval: 200, timeoutMsg: `${s.name} layout did not settle` },
          );
          const m = await layoutPage.measure();
          widths[`${zoom}/${size.name}/${s.name}`] = last;
          const tag = `zoom ${zoom} ${size.name} ${got.w}x${got.h}${got.via ? ` via ${got.via}` : ''} ${s.name}`;
          evidence(
            `[rwv5-layout] ${tag}: docOverflowX=${m.docOverflowX} clipped=${m.clipped.length} ${s.fluidId}.width=${last} hiddenOverflow=${JSON.stringify(m.hiddenOverflow.slice(0, 3))}`,
          );
          if (m.docOverflowX > 1) failures.push(`${tag}: page scrolls sideways by ${m.docOverflowX}px`);
          if (m.clipped.length > 0) failures.push(`${tag}: clipped ${JSON.stringify(m.clipped.slice(0, 5))}`);
        }
      }
    }
    expect(failures).toEqual([]);

    // Reflow, not a fixed column: every fluid container is wider when maximised
    // than at the small size, at both zoom levels.
    for (const zoom of [1.0, 1.3]) {
      for (const s of screens) {
        const small = widths[`${zoom}/small/${s.name}`] ?? 0;
        const max = widths[`${zoom}/maximised/${s.name}`] ?? 0;
        expect(max).toBeGreaterThan(small);
      }
    }
    await appBarPage.zoomReset();
    evidence(`[rwv5-layout] fluid widths ${JSON.stringify(widths)}`);
  });
});
