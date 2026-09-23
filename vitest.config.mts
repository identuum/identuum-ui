import path from "node:path";
import { defineConfig } from "vitest/config";
import { exportPlatform } from "./export/platform-plugin.mts";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "server-only": path.resolve(import.meta.dirname, "src/__mocks__/server-only.ts"),
      "next/headers": path.resolve(import.meta.dirname, "src/__mocks__/next-headers.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "next",
          environment: "node",
          globals: false,
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["node_modules", ".next", "e2e", "playwright-report"],
        },
      },
      {
        // Plan D: the shared pages as the static export runs them — the same
        // modules with the export's platform substitutions (browser transport
        // through /bff, the export router for next/navigation and next/cache).
        extends: true,
        plugins: [exportPlatform()],
        test: {
          name: "export",
          environment: "node",
          globals: false,
          include: ["export/__tests__/**/*.test.ts", "export/__tests__/**/*.test.tsx"],
        },
      },
    ],
  },
});
