import path from "node:path";
import type { Plugin } from "vite";

/**
 * THE-UI-IN-THE-BINARY (Plan D): the static export renders the SAME page,
 * layout, action and component modules as the Next deployment. What differs
 * is only where a request travels and what the host runtime provides, so the
 * export substitutes a small set of modules at build time:
 *
 *   - by resolved FILE, whatever the import spelling ("@/lib/x" or "./x"):
 *     the IdP transport, runtime config, session and runtime-state readers;
 *   - by bare SPECIFIER: next/navigation, next/cache and server-only.
 *
 * Nothing else is substituted. A shared module that imports anything the
 * browser cannot provide (next/headers, node:fs) fails the build here rather
 * than failing at runtime.
 */
const repo = path.resolve(import.meta.dirname, "..");
const lib = (f: string) => path.join(repo, "src/lib", f);
const platform = (f: string) => path.join(repo, "export/src/platform", f);

export const PLATFORM_FILES: ReadonlyMap<string, string> = new Map([
  [lib("idp-transport.ts"), platform("idp-transport.ts")],
  [lib("runtime-config.ts"), platform("runtime-config.ts")],
  [lib("server-session.ts"), platform("server-session.ts")],
  [lib("server-runtime-state.ts"), platform("server-runtime-state.ts")],
]);

export const PLATFORM_SPECIFIERS: ReadonlyMap<string, string> = new Map([
  ["next/navigation", platform("next-navigation.ts")],
  ["next/cache", platform("next-cache.ts")],
  ["server-only", platform("server-only.ts")],
]);

export function exportPlatform(): Plugin {
  return {
    name: "identuum-export-platform",
    enforce: "pre",
    async resolveId(source, importer, options) {
      const bySpecifier = PLATFORM_SPECIFIERS.get(source);
      if (bySpecifier) return bySpecifier;
      // Relative, "@/"-aliased (Vite may already have rewritten it to an
      // absolute path) or absolute: resolve it and compare the FILE.
      const local = source.startsWith(".") || source.startsWith("@/") || path.isAbsolute(source);
      if (!importer || !local) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved) return null;
      return PLATFORM_FILES.get(resolved.id) ?? resolved;
    },
  };
}
