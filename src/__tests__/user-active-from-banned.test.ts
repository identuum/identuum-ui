import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/runtime-config", () => ({
  loadRuntimeConfig: () => ({ idp: { enabled: true } }),
  idpBaseUrl: () => "http://fixture.invalid",
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ getAll: () => [] }) }));

import { getOrgUserById, listOrgUsers } from "@/lib/idp-admin-client";

afterEach(() => vi.unstubAllGlobals());

// OSS projects a user without `active` (toSafeUser, identuum-idp-oss
// internal/handlers/users.go): the account state is `banned`, and
// PUT {active} writes banned = !active. ABSENT ≠ NEGATIVE: an absent
// `active` must not read as disabled. Found by PLAN-D-2's browser run: every
// user, the signed-in admin included, was listed as Disabled.
const ID = "01990000-0000-7000-8000-0000000000u1";
const oss = (banned: boolean) => ({
  id: ID,
  email: "member@tenant-a.test",
  role: "org_admin",
  banned,
  email_verified: true,
});

function answer(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status: 200 }))
  );
}

it("reads an OSS user without `active` as active unless banned (list)", async () => {
  answer({ users: [oss(false), { ...oss(true), id: `${ID.slice(0, -1)}2` }], total: 2 });
  const result = await listOrgUsers();
  expect(result?.users.map((u) => u.active)).toEqual([true, false]);
});

it("reads an OSS user without `active` as active unless banned (detail)", async () => {
  answer(oss(false));
  expect((await getOrgUserById(ID))?.active).toBe(true);
  answer(oss(true));
  expect((await getOrgUserById(ID))?.active).toBe(false);
});

it("an explicit `active` still wins", async () => {
  answer({ ...oss(false), active: false });
  expect((await getOrgUserById(ID))?.active).toBe(false);
  answer({ users: [{ ...oss(true), active: true }], total: 1 });
  expect((await listOrgUsers())?.users[0]?.active).toBe(true);
});
