/**
 * hydration-safe-capability-probes.test.ts — THE-ELEVEN-MISMATCHES (2026-09-15)
 *
 * The server and the client must render the SAME markup for the same state.
 * A browser capability (WebAuthn's window.PublicKeyCredential) is genuinely
 * client-only — no server can know the browser's authenticator — so the only
 * honest server render is "not yet known", and the client's FIRST render must
 * say the same. Reading `typeof window` at render time breaks that: false on
 * the server, true in the browser, so the server HTML had no "Add passkey"
 * button and the client's did. React reported it as "Hydration failed because
 * the server rendered HTML didn't match the client" — once per visit of the
 * passkeys tab, ELEVEN times per e2e mint from 2026-09-10 to 2026-09-15, and
 * every spec passed because nothing read the console.
 *
 * These pins hold the pattern LoginFlow already used, now in PasskeySection
 * too: the probe runs in useEffect (after hydration) and lands in state whose
 * initial value is the server's answer.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = resolve(__dirname, "..");
const read = (rel: string): string => readFileSync(resolve(SRC, rel), "utf8");

/** Comment-stripped source: a prose mention of the old expression must not satisfy a pin. */
const stripComments = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s\/\/[^\n]*/g, "");

const PROBES = [
  { rel: "components/ui/passkey-section.tsx", state: "isSupported", setter: "setIsSupported" },
  {
    rel: "components/auth/login-flow.tsx",
    state: "isWebAuthnSupported",
    setter: "setIsWebAuthnSupported",
  },
];

describe("browser capability probes render the same markup on the server and the client's first render", () => {
  for (const { rel, state, setter } of PROBES) {
    describe(rel, () => {
      const src = stripComments(read(rel));

      it("never reads `typeof window` at render time", () => {
        // The exact expression that produced the eleven mismatches. Any
        // render-time read of `window` is a server/client branch; the only
        // one this component may keep is inside the effect below.
        expect(src, "a render-time `typeof window` branch is a hydration mismatch").not.toMatch(
          new RegExp(`const ${state}\\s*=\\s*typeof window`)
        );
        const outsideEffects = src.replace(/useEffect\(\(\) => \{[\s\S]*?\}, \[\]\);/g, "");
        expect(outsideEffects, "`typeof window` may appear only inside a mount effect").not.toMatch(
          /typeof window/
        );
      });

      it("starts from the server's answer (false) and probes after mount", () => {
        expect(src, "state initialised to what the server rendered").toMatch(
          new RegExp(`const \\[${state}, ${setter}\\] = useState\\(false\\)`)
        );
        expect(src, "the probe runs in a mount effect, after hydration").toMatch(
          new RegExp(
            `useEffect\\(\\(\\) => \\{\\s*${setter}\\(typeof window\\.PublicKeyCredential !== "undefined"\\);\\s*\\}, \\[\\]\\);`
          )
        );
      });
    });
  }
});
