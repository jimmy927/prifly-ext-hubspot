/**
 * The test world: the fake api with a Service key and settings, and a fake
 * `fetch` standing in for api.hubapi.com. Nothing here reaches the network:
 * a request no route answers is a 404 and is kept like every other.
 */

import { afterEach } from "bun:test";
import type { ExtensionModule, SettingValues } from "@prifly/extension-api";
import * as extension from "../index";
import { type FakeApi, fakeApi } from "./fake-api";

const module: ExtensionModule = extension;

export const KEY = "pat-eu1-test-key";

/** A request the extension sent, parsed. */
export type Seen = { method: string; url: URL; headers: Headers; body: unknown };

export type Route = (seen: Seen) => unknown;

/** `Response` is passed on as it is; any other value is the JSON body of a 200. */
export type Routes = Record<string, Route | unknown>;

export type World = {
  fake: FakeApi;
  /** Every request sent to the fake HubSpot, in order. */
  seen: Seen[];
  call: (tool: string, args?: Record<string, unknown>) => Promise<string>;
};

const originalFetch = globalThis.fetch;
let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
  globalThis.fetch = originalFetch;
});

export type WorldOptions = {
  key?: string | null;
  settings?: Partial<Record<string, SettingValues[string]>>;
  confirm?: boolean;
  routes?: Routes;
};

/** A fake HubSpot, installed as the global `fetch`; routes are keyed `METHOD /path`. */
export function installFetch(routes: Routes): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    // The extension always passes a URL string; Bun types a string and a Request as separate overloads.
    const request = new Request(typeof input === "string" ? input : String(input), init);
    const text = await request.text();
    const entry: Seen = {
      method: request.method,
      url: new URL(request.url),
      headers: request.headers,
      body: text === "" ? null : (JSON.parse(text) as unknown),
    };
    seen.push(entry);
    const route = routes[`${entry.method} ${entry.url.pathname}`];
    if (route === undefined)
      return Response.json({ message: "no such fake route" }, { status: 404 });
    const answer = typeof route === "function" ? (route as Route)(entry) : route;
    return answer instanceof Response ? answer : Response.json(answer);
  }) as typeof fetch;
  return seen;
}

export async function world(options: WorldOptions = {}): Promise<World> {
  const key = options.key === undefined ? KEY : options.key;
  const settings: SettingValues = {
    accessToken: key !== null,
    portal: "47907702",
    writes: false,
    ...options.settings,
  };
  const fake = fakeApi({
    settings,
    ...(key === null ? {} : { secrets: { accessToken: key } }),
    ...(options.confirm === undefined ? {} : { confirm: options.confirm }),
  });
  const seen = installFetch(options.routes ?? {});
  stop = (await module.activate(fake.api)) ?? undefined;
  return { fake, seen, call: (tool, args = {}) => fake.callTool(tool, args) };
}

export const TOOLS = [
  "hubspot_search",
  "hubspot_record",
  "hubspot_owners",
  "hubspot_pipeline",
  "hubspot_create",
  "hubspot_update",
  "hubspot_log_note",
  "hubspot_api_docs",
  "hubspot_api",
];

/** Minimal valid arguments for each tool, to show a missing key beats argument checks. */
export const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  hubspot_search: { object: "contacts" },
  hubspot_record: { object: "contacts", id: "1" },
  hubspot_owners: {},
  hubspot_pipeline: {},
  hubspot_create: { object: "contacts", properties: { firstname: "Ada" } },
  hubspot_update: { object: "contacts", id: "1", properties: { phone: "1" } },
  hubspot_log_note: { object: "contacts", id: "1", body: "hi" },
  hubspot_api_docs: { query: "owners" },
  hubspot_api: { path: "/crm/v3/owners" },
};

export const OWNERS = {
  results: [
    { id: "101", email: "jimmy@artemis.example", firstName: "Jimmy", lastName: "Engelbrecht" },
    { id: "102", email: "maryam@artemis.example", firstName: "Maryam", lastName: "Hosseini" },
  ],
};

export const AMY = {
  id: "501",
  properties: { firstname: "Amy", lastname: "Adams", email: "amy@example.com", phone: "070 1" },
};

export type { FakeApi };
