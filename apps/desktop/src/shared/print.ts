// Print seam (R5 design §8.1, BILL-003). The single place the app calls
// `window.print()`, so Vitest mocks this module and E2E stubs `window.print`.
// The OS print dialog also offers "Save as PDF" (WebView2) / "Print to File"
// (WebKitGTK), which is how a receipt PDF is made until the R4 engine ships.

/** Open the OS print dialog for the current page (PDF via "Save as PDF"). */
export function printPage(): void {
  window.print();
}
