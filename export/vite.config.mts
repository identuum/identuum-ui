import path from "node:path";
import { defineConfig } from "vite";

// THE-UI-THAT-GO-CAN-SERVE (Plan B): the OSS static export — a SEPARATE build
// configuration for the OSS binary to serve, permitted beside the Next
// standalone build that the CE/AG deployment keeps unchanged. It emits a
// shell (index.html) and hashed assets under out/, which is gitignored and
// biome-excluded exactly as Next's own export directory is. No React plugin:
// Vite's default automatic JSX runtime is enough, so the lockfile does not
// move. Source maps are OFF: whether an export may publish them is the
// owner's (Plan E), not this build's.
export default defineConfig({
  root: import.meta.dirname,
  base: "/",
  build: {
    outDir: path.resolve(import.meta.dirname, "../out"),
    emptyOutDir: true,
    sourcemap: false,
  },
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "../src") },
  },
});
