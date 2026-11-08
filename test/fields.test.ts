import { expect, test } from "bun:test";
import { isRecord } from "../hubspot";
import { AMY, DEAL_PIPELINES, LEAD_STATUS, OWNERS, type Seen, world } from "./world";

/** The `properties` the search request number `index` asked HubSpot for. */
function askedOf(seen: Seen[], index: number): string[] {
  const body = seen[index]?.body;
  const asked = isRecord(body) ? body["properties"] : undefined;
  return Array.isArray(asked)
    ? asked.filter((each): each is string => typeof each === "string")
    : [];
}

test("search asks for the created and last-modified dates of every object, and shows them", async () => {
  const { call, seen } = await world({
    routes: {
      "POST /crm/v3/objects/contacts/search": {
        results: [
          {
            ...AMY,
            properties: {
              ...AMY.properties,
              createdate: "2026-01-02T03:04:05Z",
              lastmodifieddate: "2026-02-03T04:05:06Z",
            },
          },
        ],
      },
      "POST /crm/v3/objects/deals/search": {
        results: [
          {
            id: "8",
            properties: {
              dealname: "Big one",
              createdate: "2026-03-04T00:00:00Z",
              hs_lastmodifieddate: "2026-04-05T00:00:00Z",
            },
          },
        ],
      },
    },
  });
  const contacts = await call("hubspot_search", { object: "contacts" });
  expect(contacts).toContain("createdate: 2026-01-02T03:04:05Z");
  expect(contacts).toContain("lastmodifieddate: 2026-02-03T04:05:06Z");
  const deals = await call("hubspot_search", { object: "deals" });
  expect(deals).toContain("createdate: 2026-03-04T00:00:00Z");
  expect(deals).toContain("hs_lastmodifieddate: 2026-04-05T00:00:00Z");

  expect(askedOf(seen, 0)).toEqual(expect.arrayContaining(["createdate", "lastmodifieddate"]));
  expect(askedOf(seen, 1)).toEqual(expect.arrayContaining(["createdate", "hs_lastmodifieddate"]));
});

test("search shows a contact's lead status as its label, and the raw value when none matches", async () => {
  const { call, seen } = await world({
    routes: {
      "POST /crm/v3/objects/contacts/search": {
        results: [
          { id: "1", properties: { firstname: "A", hs_lead_status: "ATTEMPTED_TO_CONTACT" } },
          { id: "2", properties: { firstname: "B", hs_lead_status: "NEW" } },
          { id: "3", properties: { firstname: "C", hs_lead_status: "CUSTOM_ONE" } },
        ],
      },
      "GET /crm/v3/properties/contacts/hs_lead_status": LEAD_STATUS,
    },
  });
  const answer = await call("hubspot_search", { object: "contacts" });
  expect(answer).toContain("hs_lead_status: Attempted to contact");
  expect(answer).toContain("hs_lead_status: New");
  expect(answer).toContain("hs_lead_status: CUSTOM_ONE");
  expect(askedOf(seen, 0)).toContain("hs_lead_status");
  expect(seen.filter((each) => each.url.pathname.includes("/properties/"))).toHaveLength(1);
});

test("search keeps the raw lead status when the options call fails", async () => {
  const { call } = await world({
    routes: {
      "POST /crm/v3/objects/contacts/search": {
        results: [{ id: "1", properties: { firstname: "A", hs_lead_status: "NEW" } }],
      },
    },
  });
  expect(await call("hubspot_search", { object: "contacts" })).toContain("hs_lead_status: NEW");
});

test("search and record show deal stage and pipeline as labels, asking for the pipelines once", async () => {
  const deal = { dealname: "Big one", dealstage: "5830995184", pipeline: "default" };
  const { call, seen } = await world({
    routes: {
      "POST /crm/v3/objects/deals/search": {
        results: [
          { id: "8", properties: deal },
          { id: "9", properties: { ...deal, dealstage: "5830995183" } },
        ],
      },
      "GET /crm/v3/objects/deals/8": { id: "8", properties: deal },
      "GET /crm/v3/pipelines/deals": DEAL_PIPELINES,
    },
  });
  const found = await call("hubspot_search", { object: "deals" });
  expect(found).toContain("dealstage: Proposal sent (5830995184)");
  expect(found).toContain("dealstage: Qualified (5830995183)");
  expect(found).toContain("pipeline: Sales Pipeline (default)");
  expect(seen.filter((each) => each.url.pathname === "/crm/v3/pipelines/deals")).toHaveLength(1);

  const one = await call("hubspot_record", { object: "deals", id: "8" });
  expect(one).toContain("dealstage: Proposal sent (5830995184)");
  expect(one).toContain("pipeline: Sales Pipeline (default)");
});

test("search asks for a company's owner and shows the owner's name", async () => {
  const { call, seen } = await world({
    routes: {
      "POST /crm/v3/objects/companies/search": {
        results: [
          { id: "9", properties: { name: "Acme", hubspot_owner_id: "102" } },
          { id: "10", properties: { name: "Beta", hubspot_owner_id: "101" } },
        ],
      },
      "GET /crm/v3/owners": OWNERS,
    },
  });
  const answer = await call("hubspot_search", { object: "companies" });
  expect(answer).toContain("hubspot_owner_id: Maryam Hosseini (102)");
  expect(answer).toContain("hubspot_owner_id: Jimmy Engelbrecht (101)");
  expect(askedOf(seen, 0)).toContain("hubspot_owner_id");
  expect(seen.filter((each) => each.url.pathname === "/crm/v3/owners")).toHaveLength(1);
});

test("a property the caller lists is shown when present, an unlisted hs_ one is not", async () => {
  const { call, seen } = await world({
    routes: {
      "POST /crm/v3/objects/companies/search": {
        results: [
          {
            id: "9",
            properties: {
              name: "Acme",
              hs_object_id: "9",
              hs_analytics_source: "ORGANIC_SEARCH",
              createdate: "2026-01-01T00:00:00Z",
              website: "",
            },
          },
        ],
      },
    },
  });
  const listed = await call("hubspot_search", {
    object: "companies",
    properties: ["name", "hs_analytics_source", "createdate", "website"],
  });
  expect(listed).toContain("hs_analytics_source: ORGANIC_SEARCH");
  expect(listed).toContain("createdate: 2026-01-01T00:00:00Z");
  expect(listed).not.toContain("website");
  expect(listed).not.toContain("hs_object_id");
  expect(seen).toHaveLength(1);

  const unlisted = await call("hubspot_search", { object: "companies" });
  expect(unlisted).not.toContain("hs_analytics_source");
});
