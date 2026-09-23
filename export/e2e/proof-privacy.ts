import { expect, type Page } from "@playwright/test";

/** Assert only booleans: failure diagnostics must never hold the inspected value. */
export function expectNoAuthMaterial(value: string, knownValues: string[] = []): void {
  expect(value.includes("access_token"), "access material must not reach page script").toBe(false);
  expect(value.includes("refresh_token"), "refresh material must not reach page script").toBe(
    false
  );
  for (const known of knownValues.filter(Boolean)) expect(value.includes(known)).toBe(false);
}

/** Check every browser-persisted surface without exposing its contents on failure. */
export async function expectNoBrowserAuthMaterial(
  page: Pick<Page, "evaluate">,
  knownValues: string[]
): Promise<void> {
  const values = await page.evaluate(() => [
    document.cookie,
    JSON.stringify({ ...localStorage }),
    JSON.stringify({ ...sessionStorage }),
  ]);
  for (const value of values) expectNoAuthMaterial(value, knownValues);
}

/** Preserve request results; transport failures must still fail the proof. */
export async function proofRequest<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    // Playwright errors can include submitted headers or field values.
    // Preserve failure, without its message, cause or diagnostic properties.
    throw new Error("credentialed proof operation failed");
  }
}
