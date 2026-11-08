/**
 * The curated writes: create or update a contact, company or deal, and log a
 * note on a record. Each is refused while the `writes` setting is off, and
 * shows the reader a confirm card with exactly what changes before it sends.
 */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import {
  type Args,
  ask,
  type Deps,
  explain,
  field,
  type Hs,
  idArg,
  isRecord,
  OBJECT_ENUM,
  OBJECTS,
  type ObjectName,
  objectArg,
  propertyLines,
  recordLink,
  str,
  text,
  withKey,
  writeBlocked,
} from "./hubspot";
import { DATA_NOTE, labelOf, rowsOf } from "./records";

/** HubSpot's own association type id from a note to each object. */
const NOTE_TO: Record<ObjectName, number> = { contacts: 202, companies: 190, deals: 214 };

const PROPERTIES_ARG = {
  type: "object",
  description:
    "Property name to value, as HubSpot's internal names: {firstname:'Ada', email:'ada@example.com'}. Values are sent as text.",
  additionalProperties: true,
};

/** The properties argument as a flat object of text, or the sentence for what is wrong with it. */
function propertiesOf(args: Record<string, unknown>): Record<string, string> | string {
  const given = args["properties"];
  if (!isRecord(given) || Object.keys(given).length === 0) {
    return "properties is an object of property names to values, e.g. {firstname: 'Ada'}.";
  }
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(given)) {
    if (!["string", "number", "boolean"].includes(typeof value)) {
      return `The value of ${name} must be text, a number or true/false.`;
    }
    out[name] = String(value);
  }
  return out;
}

/** The record as it is now, for the card; null when it cannot be read. */
async function currentOf(
  hs: Hs,
  object: ObjectName,
  id: string,
  names: string[],
): Promise<Record<string, string> | { failed: string }> {
  const path = `/crm/v3/objects/${object}/${id}`;
  const reply = await hs("GET", path, { query: { properties: names.join(",") } });
  if (reply.status === 404) return { failed: `No ${OBJECTS[object].singular} with id ${id}.` };
  if (!reply.ok) return { failed: explain(reply, "GET", path) };
  return rowsOf({ results: [reply.data] })[0]?.properties ?? {};
}

export function createTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_create",
    description: `Create a HubSpot contact, company or deal. Refused unless the reader turned on "Writes" in the extension's settings; the reader sees every property on a confirm card first, and when they cancel nothing is created. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", enum: OBJECT_ENUM, description: "contacts, companies or deals." },
        properties: PROPERTIES_ARG,
      },
      required: ["object", "properties"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runCreate(args, api, hs)),
  };
}

/**
 * What a curated write acts on, or the sentence for why it must not run: writes off, a prifly that
 * cannot ask, an unknown object, a bad id. The refusals come before anything is read or sent.
 */
function writeTarget(
  api: ExtensionApi,
  args: Args,
  withId: boolean,
): { object: ObjectName; id: string } | string {
  const blocked = writeBlocked(api);
  if (blocked !== null) return blocked;
  const picked = objectArg(args);
  if ("problem" in picked) return picked.problem;
  return { object: picked.object, id: withId ? idArg(args) : "" };
}

async function runCreate(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const target = writeTarget(api, args, false);
  if (typeof target === "string") return target;
  const { object } = target;
  const properties = propertiesOf(args);
  if (typeof properties === "string") return properties;
  const singular = OBJECTS[object].singular;
  const refused = await ask(api, {
    title: `Create a HubSpot ${singular}`,
    summary: `Create the ${singular} ${JSON.stringify(labelOf(object, properties))} in HubSpot`,
    content: propertyLines(properties),
    details: `POST /crm/v3/objects/${object}\n\n${JSON.stringify({ properties }, null, 2)}`,
  });
  if (refused !== null) return refused;
  const path = `/crm/v3/objects/${object}`;
  const reply = await hs("POST", path, { body: { properties } });
  if (!reply.ok) return explain(reply, "POST", path);
  const id = str(field(reply.data, "id")) ?? "?";
  return `Created the ${singular} #${id}: ${recordLink(api, object, id)}`;
}

/** `name: old → new` for each property that changes, and the names that stay as they are. */
function diffLines(before: Record<string, string>, after: Record<string, string>): string[] {
  return Object.entries(after)
    .filter(([name, value]) => (before[name] ?? "") !== value)
    .map(
      ([name, value]) =>
        `${name}: ${before[name] === undefined ? "(empty)" : before[name]} → ${value}`,
    );
}

export function updateTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_update",
    description: `Update properties of one HubSpot contact, company or deal. Refused unless the reader turned on "Writes" in the extension's settings; the reader sees each property's old and new value on a confirm card first, and when they cancel nothing changes. Set a property to "" to clear it. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", enum: OBJECT_ENUM, description: "contacts, companies or deals." },
        id: { type: "string", description: "The record's numeric HubSpot id." },
        properties: PROPERTIES_ARG,
      },
      required: ["object", "id", "properties"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runUpdate(args, api, hs)),
  };
}

async function runUpdate(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const target = writeTarget(api, args, true);
  if (typeof target === "string") return target;
  const { object, id } = target;
  const properties = propertiesOf(args);
  if (typeof properties === "string") return properties;
  const names = [...Object.keys(properties), ...labelNames(object)];
  const before = await currentOf(hs, object, id, names);
  if ("failed" in before) return before.failed;
  const changes = diffLines(before, properties);
  if (changes.length === 0) return "Nothing to change: the record already has these values.";
  const singular = OBJECTS[object].singular;
  const refused = await ask(api, {
    title: `Update a HubSpot ${singular}`,
    summary: `Update the ${singular} ${JSON.stringify(labelOf(object, before))} (#${id})`,
    content: changes.join("\n"),
    details: `PATCH /crm/v3/objects/${object}/${id}\n${recordLink(api, object, id)}\n\n${JSON.stringify({ properties }, null, 2)}`,
  });
  if (refused !== null) return refused;
  const path = `/crm/v3/objects/${object}/${id}`;
  const reply = await hs("PATCH", path, { body: { properties } });
  if (!reply.ok) return explain(reply, "PATCH", path);
  return `Updated the ${singular} #${id}: ${recordLink(api, object, id)}`;
}

/** The properties that name a record, so the card can call it by name. */
function labelNames(object: ObjectName): string[] {
  if (object === "contacts") return ["firstname", "lastname", "email"];
  return [object === "companies" ? "name" : "dealname"];
}

const escapeHtml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A note's body the way HubSpot stores it: HTML, with the line breaks kept. */
export const noteHtml = (value: string): string => escapeHtml(value).replace(/\r?\n/g, "<br>");

async function noteCard(api: ExtensionApi, hs: Hs, object: ObjectName, id: string, body: string) {
  const known = await currentOf(hs, object, id, labelNames(object));
  if ("failed" in known) return known;
  const singular = OBJECTS[object].singular;
  const noteBody = {
    properties: { hs_timestamp: new Date().toISOString(), hs_note_body: noteHtml(body) },
    associations: [
      {
        to: { id },
        types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO[object] }],
      },
    ],
  };
  const refused = await ask(api, {
    title: "Log a HubSpot note",
    summary: `Log a note on the ${singular} ${JSON.stringify(labelOf(object, known))} (#${id})`,
    content: body,
    details: `POST /crm/v3/objects/notes\n${recordLink(api, object, id)}\n\n${JSON.stringify(noteBody, null, 2)}`,
  });
  return { refused, noteBody };
}

export function noteTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_log_note",
    description: `Log a note on a HubSpot contact, company or deal (a note associated with the record). Refused unless the reader turned on "Writes" in the extension's settings; the reader sees the note on a confirm card first, and when they cancel nothing is logged. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", enum: OBJECT_ENUM, description: "contacts, companies or deals." },
        id: { type: "string", description: "The record's numeric HubSpot id." },
        body: { type: "string", description: "The note, as plain text." },
      },
      required: ["object", "id", "body"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runNote(args, api, hs)),
  };
}

async function runNote(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const target = writeTarget(api, args, true);
  if (typeof target === "string") return target;
  const { object, id } = target;
  const body = text(args, "body").trim();
  if (body === "") throw new Error("body is required");
  const card = await noteCard(api, hs, object, id, body);
  if ("failed" in card) return card.failed;
  if (card.refused !== null) return card.refused;
  const path = "/crm/v3/objects/notes";
  const reply = await hs("POST", path, { body: card.noteBody });
  if (!reply.ok) return explain(reply, "POST", path);
  const noteId = str(field(reply.data, "id")) ?? "?";
  return `Logged note #${noteId} on the ${OBJECTS[object].singular} #${id}: ${recordLink(api, object, id)}`;
}
