import { expect, test } from "bun:test";
import { resolveUrl } from "../api-tools";
import { CANCELLED } from "../hubspot";
import { world } from "./world";

test("a GET runs at once, with no card, even while writes are off", async () => {
  const { call, fake, seen } = await world({
    routes: { "GET /crm/v3/properties/contacts": { results: [{ name: "email" }] } },
  });
  const answer = await call("hubspot_api", {
    path: "/crm/v3/properties/contacts",
    query: { archived: false },
  });
  expect(answer).toStartWith("200");
  expect(answer).toContain('"email"');
  expect(seen[0]?.url.search).toBe("?archived=false");
  expect(fake.confirms).toEqual([]);
});

test("a POST to a /search endpoint runs at once", async () => {
  const { call, fake, seen } = await world({
    routes: { "POST /crm/v3/objects/tickets/search": { results: [], total: 0 } },
  });
  const answer = await call("hubspot_api", {
    method: "POST",
    path: "/crm/v3/objects/tickets/search",
    body: { query: "x" },
  });
  expect(answer).toStartWith("200");
  expect(seen[0]?.body).toEqual({ query: "x" });
  expect(fake.confirms).toEqual([]);
});

test("a PATCH needs a card with writes on, and is refused with writes off", async () => {
  const off = await world();
  expect(
    await off.call("hubspot_api", {
      method: "PATCH",
      path: "/crm/v3/objects/contacts/1",
      body: { properties: { phone: "1" } },
    }),
  ).toContain("writes are off");
  expect(off.fake.confirms).toEqual([]);
  expect(off.seen).toEqual([]);

  const on = await world({
    settings: { writes: true },
    routes: { "PATCH /crm/v3/objects/contacts/1": { id: "1" } },
  });
  const answer = await on.call("hubspot_api", {
    method: "patch",
    path: "/crm/v3/objects/contacts/1",
    body: { properties: { phone: "1" } },
  });
  expect(on.fake.confirms).toHaveLength(1);
  expect(on.fake.confirms[0]?.summary).toBe(
    "Send a PATCH request to HubSpot: /crm/v3/objects/contacts/1",
  );
  expect(on.fake.confirms[0]?.content).toBe("phone: 1");
  expect(answer).toStartWith("200");
  expect(on.seen.map((each) => each.method)).toEqual(["PATCH"]);
});

test("a cancelled PATCH sends nothing", async () => {
  const { call, seen } = await world({ settings: { writes: true }, confirm: false });
  expect(await call("hubspot_api", { method: "DELETE", path: "/crm/v3/objects/contacts/1" })).toBe(
    CANCELLED,
  );
  expect(seen).toEqual([]);
});

test("a POST that is not a search needs a card too", async () => {
  const { call, fake } = await world({
    settings: { writes: true },
    routes: { "POST /crm/v3/objects/contacts/batch/read": { results: [] } },
  });
  await call("hubspot_api", {
    method: "POST",
    path: "/crm/v3/objects/contacts/batch/read",
    body: { inputs: [] },
  });
  expect(fake.confirms).toHaveLength(1);
});

test("the key goes only to api.hubapi.com", async () => {
  const { call, seen } = await world();
  expect(await call("hubspot_api", { path: "https://evil.example/crm/v3/owners" })).toContain(
    "only reaches",
  );
  expect(await call("hubspot_api", { path: "https://api.hubapi.com.evil.example/x" })).toContain(
    "only reaches",
  );
  expect(await call("hubspot_api", { path: "https://user@api.hubapi.com/x" })).toContain(
    "only reaches",
  );
  expect(await call("hubspot_api", { path: "/crm/v3/owners", method: "TRACE" })).toContain(
    "Refused",
  );
  expect(seen).toEqual([]);
  expect(String(resolveUrl("crm/v3/owners", { limit: 5 }))).toBe(
    "https://api.hubapi.com/crm/v3/owners?limit=5",
  );
});

test("a 403 from hubspot_api names the scope its path needs", async () => {
  const { call } = await world({
    routes: { "GET /crm/v3/objects/deals/1": new Response("{}", { status: 403 }) },
  });
  expect(await call("hubspot_api", { path: "/crm/v3/objects/deals/1" })).toContain(
    "crm.objects.deals.read",
  );
});

test("other errors come back with their status and body", async () => {
  const { call } = await world({
    routes: {
      "GET /crm/v3/objects/deals/1": new Response('{"message":"bad id"}', { status: 400 }),
    },
  });
  const answer = await call("hubspot_api", { path: "/crm/v3/objects/deals/1" });
  expect(answer).toStartWith("400");
  expect(answer).toContain("bad id");
});

test("api_docs finds an endpoint in the bundled index, and says when nothing matches", async () => {
  const { call, seen } = await world();
  const found = await call("hubspot_api_docs", { query: "association" });
  expect(found).toContain(
    "PUT /crm/v4/objects/{fromObject}/{id}/associations/default/{toObject}/{toId}",
  );
  expect(await call("hubspot_api_docs", { query: "zzzz" })).toContain("Nothing in the index");
  expect(await call("hubspot_api_docs", {})).toContain("GET /crm/v3/owners");
  expect(seen).toEqual([]);
});
