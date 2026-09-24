import path from "node:path";
import { defineConfig } from "vite";
import { exportPlatform } from "./platform-plugin.mts";

// THE-UI-THAT-GO-CAN-SERVE (Plan B): the OSS static export — a SEPARATE build
// configuration for the OSS binary to serve, permitted beside the Next
// standalone build that the CE/AG deployment keeps unchanged. It emits a
// shell (index.html) and hashed assets under out/, which is gitignored and
// biome-excluded exactly as Next's own export directory is. No React plugin:
// Vite's default automatic JSX runtime is enough, so the lockfile does not
// move. Source maps are OFF: whether an export may publish them is the
// owner's (Plan E), not this build's.
//
// Plan D: exportPlatform() lets the export render the shared Next page and
// layout modules unchanged (see platform-plugin.mts).
export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  plugins: [exportPlatform()],
  build: {
    outDir: path.resolve(import.meta.dirname, "../out"),
    emptyOutDir: true,
    sourcemap: false,
    // PLAN-E-1: the OSS binary vendors this output in its tree, and
    // identuum-idp-oss's tracked-binary-check refuses any tracked file over
    // 1 MiB (with no allowlist, on purpose). One bundle measured 1,204,927
    // bytes; library code goes to its own chunks, each capped well below
    // that line, so every emitted file stays under it.
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [{ name: "vendor", test: /node_modules/, maxSize: 700_000 }],
        },
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
  },
});
