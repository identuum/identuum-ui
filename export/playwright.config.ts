import { defineConfig, devices } from "@playwright/test";

// Playwright 1.63's failure-context snapshot can include enrollment material
// even when screenshots, video and tracing are disabled.
process.env.PLAYWRIGHT_NO_COPY_PROMPT = "1";

// THE-UI-THAT-GO-CAN-SERVE (Plan B): drives the export the OSS BINARY serves.
// Deliberately separate from the repository's playwright.config.ts, whose
// chromium project starts `next dev` as its webServer: here there is NO web
// server — the binary under test is started by the operator, and the phase
// (fresh / ready / outage) selects which proofs may run against it.
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: 0,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: process.env.IDENTUUM_E2E_EXPORT_BASE_URL ?? "http://localhost:7113",
    ignoreHTTPSErrors: false,
    // Authentication proofs must not persist credentials in network traces
    // or capture enrollment material in screenshots/video.
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
