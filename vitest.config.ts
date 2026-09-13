import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    // e2e/helpers holds the harness's own pure helpers (the TOTP issued-step
    // ledger, THE-SUITE-THAT-REPLAYED); their unit tests run here, the
    // Playwright specs never do.
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "e2e/helpers/**/*.test.ts"],
    exclude: ["node_modules", ".next", "e2e/**/*.spec.ts", "e2e-full", "playwright-report"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "server-only": path.resolve(__dirname, "src/__mocks__/server-only.ts"),
      "next/headers": path.resolve(__dirname, "src/__mocks__/next-headers.ts"),
    },
  },
});
