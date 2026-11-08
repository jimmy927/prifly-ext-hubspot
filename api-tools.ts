/**
 * The whole HubSpot API for what the curated tools do not cover:
 * `hubspot_api` sends any call to api.hubapi.com with the Service key (a GET,
 * and a POST to a `/search`, run at once; everything else waits for the
 * reader and is refused while writes are off), and `hubspot_api_docs` looks
 * an endpoint up in a bundled index of the common CRM endpoints.
 */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import { DOCS_INDEX, renderEntry } from "./docs-index";
import {
  API_BASE,
  API_HOST,
  type Args,
  ask,
  cut,
  type Deps,
  explain,
  field,
  type Hs,
  isRecord,
  propertyLines,
  type Reply,
  text,
  withKey,
  writeBlocked,
} from "./hubspot";
import { DATA_NOTE } from "./records";

const METHODS = new Set(["GET", "POST", "PATCH", "PUT", "DELETE"]);
const RESPONSE_CAP = 60_000;

/** `json` is the parsed request body, undefined when there is none. */
export type ApiCall = { method: string; url: URL; json: unknown };

function withQuery(url: URL, query: unknown): void {
  if (!isRecord(query)) return;
  for (const [name, value] of Object.entries(query)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      if (each === undefined || each === null) continue;
      url.searchParams.append(name, typeof each === "string" ? each : JSON.stringify(each));
    }
  }
}

/** The URL a path names, only ever on api.hubapi.com (the key goes nowhere else); otherwise why not. */
export function resolveUrl(path: string, query: unknown): URL | string {
  const trimmed = path.trim();
  let url: URL;
  try {
    url = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? new URL(trimmed)
      : new URL(`${API_BASE}/${trimmed.replace(/^\/+/, "")}`);
  } catch {
    return `Refused: "${path}" is not a URL.`;
  }
  const own = url.protocol === "https:" && url.hostname === API_HOST;
  if (!own || url.port !== "" || url.username !== "") {
    return `Refused: hubspot_api only reaches ${API_BASE}/…, not ${url.origin}.`;
  }
  withQuery(url, query);
  return url;
}

/** A read: a GET, or the POST HubSpot uses for a search. Nothing else runs without the reader. */
export function isRead(call: ApiCall): boolean {
  return call.method === "GET" || (call.method === "POST" && call.url.pathname.endsWith("/search"));
}

function callOf(args: Args): ApiCall | string {
  const method = (text(args, "method").trim() || "GET").toUpperCase();
  if (!METHODS.has(method)) return `Refused: ${method} is not one of ${[...METHODS].join(", ")}.`;
  const url = resolveUrl(text(args, "path"), args["query"]);
  if (typeof url === "string") return url;
  const given = args["body"];
  if (method === "GET" || given === undefined || given === null)
    return { method, url, json: undefined };
  if (typeof given !== "string") return { method, url, json: given };
  try {
    return { method, url, json: JSON.parse(given) as unknown };
  } catch {
    return "Refused: body is not JSON.";
  }
}

/** The properties a body sets, as `name: value` lines, when it has any that read plainly. */
function readableBody(json: unknown): string | null {
  const properties = field(json, "properties");
  const flat = isRecord(properties) ? properties : json;
  if (!isRecord(flat) || Object.keys(flat).length === 0) return null;
  return propertyLines(flat);
}

function describeCall(call: ApiCall): string {
  const where = `${call.url.pathname}${call.url.search}`;
  if (call.method === "DELETE") return `Delete (archive) in HubSpot: ${where}`;
  return `Send a ${call.method} request to HubSpot: ${where}`;
}

function answerText(reply: Reply): string {
  const head = `${reply.status}${reply.statusText === "" ? "" : ` ${reply.statusText}`}`;
  return `${head}\n\n${cut(reply.body, RESPONSE_CAP)}`;
}

/** The reader's confirm for a call that is not a read; null when it may go ahead, else what to answer. */
async function approve(api: ExtensionApi, call: ApiCall): Promise<string | null> {
  const blocked = writeBlocked(api);
  if (blocked !== null) return blocked;
  const content = readableBody(call.json);
  const body = call.json === undefined ? "" : `\n\n${JSON.stringify(call.json, null, 2)}`;
  return await ask(api, {
    title: "Call the HubSpot API",
    summary: describeCall(call),
    ...(content === null ? {} : { content }),
    details: `${call.method} ${call.url.href}${body}`,
  });
}

async function runApi(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const call = callOf(args);
  if (typeof call === "string") return call;
  if (!isRead(call)) {
    const refused = await approve(api, call);
    if (refused !== null) return refused;
  }
  const reply = await hs(call.method, call.url.href, { body: call.json });
  if ([401, 403, 429].includes(reply.status)) return explain(reply, call.method, call.url.pathname);
  return answerText(reply);
}

export function apiTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_api",
    description: `Any call to the HubSpot API (https://api.hubapi.com/…) with the Service key, for what the other hubspot_* tools do not cover (associations, properties, lists, batch calls, other object types). A GET, and a POST to a /search endpoint, run at once. Every other method is shown to the reader on a confirm card first, and is refused unless they turned on "Writes" in the extension's settings. Look the endpoint up with hubspot_api_docs. Answers the status and the response body. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        method: { type: "string", description: "GET (default), POST, PATCH, PUT or DELETE." },
        path: {
          type: "string",
          description:
            "/crm/v3/objects/contacts/{id}, /crm/v3/properties/deals, … or the whole https://api.hubapi.com URL.",
        },
        query: { type: "object", description: "Query parameters, by name." },
        body: { type: "object", description: "The JSON request body." },
      },
      required: ["path"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runApi(args, api, hs)),
  };
}

export function apiDocsTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_api_docs",
    description:
      "Look up a HubSpot CRM API endpoint in the extension's bundled index of the common ones (objects, search, batch, associations, properties, pipelines, owners, lists, engagements): method, path, what it does, the Service key scope it needs, and its parameters. An empty query lists every endpoint. For hubspot_api; HubSpot's full reference is at https://developers.hubspot.com/docs/api/overview.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: 'Words to find: "association", "batch", "pipelines"…',
        },
      },
    },
    // The index is local; the tool still follows the missing-key rule so every tool answers alike.
    call: (args, ctx) => withKey(deps, ctx.signal, async () => lookup(text(args, "query"))),
  };
}

/** The entries whose method, path or words match every word of `query`. */
export function lookup(query: string): string {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0)
    return DOCS_INDEX.map((each) => `${each.method} ${each.path}  ${each.what}`).join("\n");
  const found = DOCS_INDEX.filter((each) => {
    const hay = `${each.method} ${each.path} ${each.what} ${each.notes ?? ""}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
  if (found.length === 0)
    return `Nothing in the index matches "${query}". Try one word, or see https://developers.hubspot.com/docs/api/overview.`;
  return cut(found.slice(0, 12).map(renderEntry).join("\n\n"), 20_000);
}
