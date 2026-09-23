import type { Page } from "@playwright/test";
import { expect, it } from "vitest";
import {
  expectNoAuthMaterial,
  expectNoBrowserAuthMaterial,
  proofRequest,
} from "../../export/e2e/proof-privacy";

const marker = "synthetic-private-proof-material";

it.each([0, 1, 2])("detects a renamed credential on browser surface %i", async (surface) => {
  const values = ["", "{}", "{}"];
  values[surface] = `unexpected=${marker}`;
  const page = { evaluate: async () => values } as Pick<Page, "evaluate">;
  let failure: unknown;
  try {
    await expectNoBrowserAuthMaterial(page, [marker]);
  } catch (error) {
    failure = error;
  }
  expect(failure instanceof Error).toBe(true);
  expect(String(failure).includes(marker)).toBe(false);
  expect(JSON.stringify(failure)?.includes(marker) ?? false).toBe(false);
});

it("accepts browser state containing no known authentication material", async () => {
  const page = { evaluate: async () => ["", '{"theme":"light"}', "{}"] } as Pick<Page, "evaluate">;
  await expect(expectNoBrowserAuthMaterial(page, [marker])).resolves.toBeUndefined();
});

it("private-material assertions fail without putting the inspected value in diagnostics", () => {
  let failure: unknown;
  try {
    expectNoAuthMaterial(JSON.stringify({ access_token: marker }));
  } catch (error) {
    failure = error;
  }
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure).includes(marker)).toBe(false);
  expect(JSON.stringify(failure).includes(marker)).toBe(false);
});

it("still refuses a known credential even when it is carried under a different key", () => {
  expect(() => expectNoAuthMaterial(JSON.stringify({ unexpected: marker }), [marker])).toThrow();
  expect(() => expectNoAuthMaterial('{"ok":true}')).not.toThrow();
});

it("transport errors remain failures without exposing headers, causes or diagnostic properties", async () => {
  const original = Object.assign(new Error(`Authorization: Bearer ${marker}`), {
    cause: { requestHeaders: { authorization: marker } },
  });
  const failure = await proofRequest(() => Promise.reject(original)).catch((error) => error);
  expect(failure).toBeInstanceOf(Error);
  expect(String(failure).includes(marker)).toBe(false);
  expect(JSON.stringify(failure).includes(marker)).toBe(false);
  expect(failure.cause).toBeUndefined();
});

it("preserves successful HTTP responses for the original status and body assertions", async () => {
  const response = { status: 401, body: { reason: "refresh_refused" } };
  expect(await proofRequest(() => Promise.resolve(response))).toBe(response);
});
