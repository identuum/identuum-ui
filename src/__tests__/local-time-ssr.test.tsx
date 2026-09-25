import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { OrganizationsClient } from "@/app/site-admin/organizations/client";
import type { OrgListResult } from "@/lib/types";

// UI-DATES (owner decision U-020). The nightly e2e-full failure: the Next
// server rendered /site-admin/organizations' created_at in ITS time zone and
// the browser hydrated it in the viewer's, so between the UTC and the local
// midnight the two disagreed on the calendar day. A server render must not
// depend on the process's time zone at all: it emits the UTC instant in a
// <time> element (dateTime and title), and only the browser formats it.

const CREATED = "2026-09-24T23:30:00Z";
const DATA: OrgListResult = {
  organizations: [
    {
      id: "0198b2d0-0000-7000-8000-000000000001",
      name: "Acme",
      domain: "acme.example",
      slug: "acme",
      active: true,
      deleted: false,
      has_admin: true,
      can_assign_admin: false,
      created_at: CREATED,
      updated_at: CREATED,
    },
  ],
  total_count: 1,
  count: 1,
  offset: 0,
  limit: 20,
};

const original = process.env.TZ;
afterEach(() => {
  process.env.TZ = original;
});

function renderIn(tz: string): string {
  process.env.TZ = tz;
  return renderToString(<OrganizationsClient initialData={DATA} page={1} stateFilter="current" />);
}

describe("a server render of a date does not depend on the process time zone", () => {
  it("renders identical HTML under UTC+14 and UTC-12 (26 hours apart: different calendar days)", () => {
    expect(renderIn("Pacific/Kiritimati")).toBe(renderIn("Etc/GMT+12"));
  });

  it("emits the UTC instant as a <time> element with the exact UTC ISO title", () => {
    const html = renderIn("Pacific/Kiritimati");
    expect(html).toContain(
      '<time dateTime="2026-09-24T23:30:00.000Z" title="2026-09-24T23:30:00.000Z"'
    );
  });
});
