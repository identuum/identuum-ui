// UI-SEC-HEADERS (M1): the binary serves this export under a script policy
// without 'unsafe-eval'. zod 4 otherwise probes eval (`new Function("")`) on
// its first object parse, and the browser reports that probe as a policy
// violation even though zod catches it. jitless skips the probe and keeps the
// same validation, without the generated fast path. main.tsx imports this
// module first, before anything that can parse.
import { z } from "zod";

z.config({ jitless: true });
