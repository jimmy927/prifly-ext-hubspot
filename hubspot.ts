/**
 * What every tool shares: the Service key (kept in the extension's own sealed
 * secrets, never in prifly's vault), the HubSpot request, the sentence for a
 * failure the reader can act on, the record links, and the confirm card every
 * write goes through first.
 */

import type { ConfirmSpec, ExtensionApi } from "@prifly/extension-api";

export const API_HOST = "api.hubapi.com";
export const API_BASE = `https://${API_HOST}`;

export const NO_KEY = "Add the HubSpot Service key in Settings → Extensions → HubSpot.";
export const CANCELLED = "Not done: you cancelled";
export const NO_CONFIRM =
  "Not done: this version of prifly cannot ask the reader before a write. Update prifly.";
export const WRITES_OFF =
  'Not done: writes are off. The reader can turn on "Writes" in Settings → Extensions → HubSpot (the Service key then needs the crm.objects.*.write scopes).';

export type Args = Record<string, unknown>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type Deps = { api: () => ExtensionApi | null; fetch: FetchLike };

/** The CRM objects the curated tools handle, with their HubSpot object type id. */
export const OBJECTS = {
  contacts: { typeId: "0-1", singular: "contact" },
  companies: { typeId: "0-2", singular: "company" },
  deals: { typeId: "0-3", singular: "deal" },
} as const;
export type ObjectName = keyof typeof OBJECTS;

export const OBJECT_ENUM = Object.keys(OBJECTS);

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** `value[name]` when `value` is an object, else undefined. */
export function field(value: unknown, name: string): unknown {
  return isRecord(value) ? value[name] : undefined;
}

/** The cursor for the next page of a list or search answer, or null on the last page. */
export function nextCursor(data: unknown): string | null {
  return str(field(field(field(data, "paging"), "next"), "after"));
}

export function str(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A string argument, "" when absent or not a string. */
export function text(args: Args, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value : "";
}

export function cut(value: string, cap: number): string {
  return value.length <= cap ? value : `${value.slice(0, cap)}\n… (cut at ${cap} characters)`;
}

/** The object an argument names, or the sentence for why not. */
export function objectArg(args: Args): { object: ObjectName } | { problem: string } {
  const name = text(args, "object").trim().toLowerCase();
  const found = OBJECT_ENUM.find((each) => each === name);
  if (found !== undefined) return { object: found as ObjectName };
  return { problem: `object is one of ${OBJECT_ENUM.join(", ")}.` };
}

/** The record id an argument names (digits only), or the sentence for why not. */
export function idArg(args: Args): string {
  const raw = args["id"];
  const id = typeof raw === "number" ? String(raw) : text(args, "id").trim();
  if (!/^\d+$/.test(id)) throw new Error("id is the record's numeric HubSpot id");
  return id;
}

/** The record's page in HubSpot's web app. */
export function recordLink(api: ExtensionApi, object: ObjectName, id: string): string {
  const portal = str(api.settings?.["portal"])?.trim() ?? "47907702";
  return `https://app-eu1.hubspot.com/contacts/${portal}/record/${OBJECTS[object].typeId}/${id}`;
}

/** The Service key, or null when none is stored. */
export async function keyOf(api: ExtensionApi): Promise<string | null> {
  const key = await api.secrets?.get("accessToken");
  return key === undefined || key === null || key.trim() === "" ? null : key.trim();
}

export const writesOn = (api: ExtensionApi): boolean => api.settings?.["writes"] === true;

export type Reply = {
  status: number;
  ok: boolean;
  statusText: string;
  body: string;
  data: unknown;
};
export type Hs = (
  method: string,
  path: string,
  options?: { body?: unknown; query?: Record<string, string | undefined> },
) => Promise<Reply>;

function parseJson(body: string): unknown {
  try {
    return body === "" ? null : (JSON.parse(body) as unknown);
  } catch {
    return null;
  }
}

function requestInit(method: string, key: string, signal: AbortSignal, body: unknown): RequestInit {
  const hasBody = body !== undefined;
  return {
    method,
    signal,
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(hasBody ? { "Content-Type": "application/json" } : {}),
    },
    ...(hasBody ? { body: JSON.stringify(body) } : {}),
  };
}

/** A request to HubSpot with the key; `path` is `/crm/v3/…`. */
export function hubspot(deps: Deps, key: string, signal: AbortSignal): Hs {
  return async (method, path, options = {}) => {
    const url = new URL(path.startsWith("http") ? path : `${API_BASE}${path}`);
    for (const [name, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined) url.searchParams.set(name, value);
    }
    const response = await deps.fetch(url.href, requestInit(method, key, signal, options.body));
    const body = await response.text();
    return {
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      body,
      data: parseJson(body),
    };
  };
}

/** The scopes a 403's `errors` name: in their context, else in the "[scope, scope]" of the message. */
function scopesNamed(data: unknown): string[] {
  const errors = field(data, "errors");
  const named: string[] = [];
  for (const each of Array.isArray(errors) ? errors : []) {
    const granular = field(field(each, "context"), "requiredGranularScopes");
    if (Array.isArray(granular)) {
      named.push(...granular.filter((scope): scope is string => typeof scope === "string"));
      continue;
    }
    const listed = /\[([^\]]+)\]/.exec(str(field(each, "message")) ?? "")?.[1];
    if (listed !== undefined) named.push(...listed.split(",").map((scope) => scope.trim()));
  }
  return [...new Set(named)];
}

/** The scopes HubSpot's 403 names, else a guess from the request. */
export function missingScopes(reply: Reply, method: string, path: string): string[] {
  const named = scopesNamed(reply.data);
  if (named.length > 0) return named;
  const object = /\/(contacts|companies|deals|owners)\b/.exec(path)?.[1];
  if (object === undefined) return [];
  const read = method === "GET" || path.endsWith("/search");
  return [`crm.objects.${object}.${read || object === "owners" ? "read" : "write"}`];
}

/** The sentence for a failed call; the model reads it, the reader acts on it. */
export function explain(reply: Reply, method: string, path: string): string {
  if (reply.status === 401) {
    return "HubSpot rejected the Service key (401): it is wrong or was revoked. Paste a fresh one in Settings → Extensions → HubSpot.";
  }
  if (reply.status === 403) {
    const scopes = missingScopes(reply, method, path);
    const which =
      scopes.length > 0
        ? `the scope ${scopes.join(", ")}`
        : "a scope this call needs (see HubSpot's message below)";
    const write = scopes.some((scope) => scope.endsWith(".write"));
    return `HubSpot refused (403): the Service key lacks ${which}. ${
      write ? "Writes need crm.objects.*.write on the Service key: " : "Add it to the key: "
    }HubSpot, Settings, Integrations, Service Keys.${scopes.length > 0 ? "" : `\n\n${cut(reply.body, 600)}`}`;
  }
  if (reply.status === 429) return "HubSpot is rate limiting (429): try again in a few seconds.";
  const message = str(field(reply.data, "message")) ?? cut(reply.body, 600);
  return `HubSpot answered ${reply.status}${reply.statusText === "" ? "" : ` ${reply.statusText}`}: ${message}`;
}

/** What a tool does with the key: the sentence for a missing one, else `run`. */
export type Run = (api: ExtensionApi, hs: Hs, signal: AbortSignal) => Promise<string>;

/** Runs `run` with the key, or answers NO_KEY. Every tool goes through it first. */
export async function withKey(deps: Deps, signal: AbortSignal, run: Run): Promise<string> {
  const api = deps.api();
  if (api === null) return "The HubSpot extension is not running.";
  const key = await keyOf(api);
  if (key === null) return NO_KEY;
  return await run(api, hubspot(deps, key, signal), signal);
}

/** The refusal for a write that must not run, or null when it may: writes on, and a prifly that can ask. */
export function writeBlocked(api: ExtensionApi): string | null {
  if (!writesOn(api)) return WRITES_OFF;
  if (api.confirm === undefined) return NO_CONFIRM;
  return null;
}

/** Shows the card; null when the reader confirmed, else what the session is told. */
export async function ask(api: ExtensionApi, spec: ConfirmSpec): Promise<string | null> {
  if (api.confirm === undefined) return NO_CONFIRM;
  return (await api.confirm(spec)) === true ? null : CANCELLED;
}

/** `name: value` lines for the card, skipping nothing: what is sent is what is shown. */
export function propertyLines(properties: Record<string, unknown>): string {
  return Object.entries(properties)
    .map(([name, value]) => `${name}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    .join("\n");
}
