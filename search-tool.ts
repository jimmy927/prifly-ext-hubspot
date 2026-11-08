/** `hubspot_search`: contacts, companies or deals by text and filters, a page at a time. */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import {
  type Args,
  type Deps,
  explain,
  field,
  type Hs,
  isRecord,
  nextCursor,
  OBJECT_ENUM,
  type ObjectName,
  objectArg,
  str,
  text,
  withKey,
} from "./hubspot";
import { labelled, lookupsOf } from "./lookups";
import { DATA_NOTE, DEFAULT_PROPERTIES, renderRow, rowsOf } from "./records";

const OPERATORS = [
  "EQ",
  "NEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "BETWEEN",
  "IN",
  "NOT_IN",
  "HAS_PROPERTY",
  "NOT_HAS_PROPERTY",
  "CONTAINS_TOKEN",
  "NOT_CONTAINS_TOKEN",
];

/** HubSpot's filter objects from the `filters` argument, or the sentence for what is wrong with it. */
function filtersOf(raw: unknown): Record<string, unknown>[] | string {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) return "filters is a list of {property, operator, value}.";
  const out: Record<string, unknown>[] = [];
  for (const each of raw) {
    const property = str(field(each, "property"));
    const operator = str(field(each, "operator"))?.toUpperCase();
    if (property === null || operator === undefined || !OPERATORS.includes(operator)) {
      return `Each filter needs a property and an operator, one of ${OPERATORS.join(", ")}.`;
    }
    const filter: Record<string, unknown> = { propertyName: property, operator };
    for (const name of ["value", "values", "highValue"]) {
      const given = isRecord(each) ? each[name] : undefined;
      if (given !== undefined) filter[name] = given;
    }
    out.push(filter);
  }
  return out;
}

function limitOf(args: Args): number {
  const given = Number(args["limit"]);
  return Number.isFinite(given) && given >= 1 ? Math.min(Math.floor(given), 100) : 20;
}

/** The properties to ask for: the session's list, else the object's defaults. */
export function propertiesArg(args: Args, fallback: string[]): string[] {
  const given = args["properties"];
  if (!Array.isArray(given)) return fallback;
  const names = given.filter((each): each is string => typeof each === "string" && each !== "");
  return names.length > 0 ? names : fallback;
}

export function searchTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_search",
    description: `Search HubSpot contacts, companies or deals by text and/or property filters. Answers the matching records with their main properties and a link to each, a page at a time: when more remain, the answer ends with the \`after\` cursor to pass for the next page. \`query\` searches names, emails, domains and other default text properties; \`filters\` are ANDed ({property, operator, value}). Runs at once, changes nothing. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", enum: OBJECT_ENUM, description: "contacts, companies or deals." },
        query: { type: "string", description: "Text to find, e.g. a name, email or domain." },
        filters: {
          type: "array",
          description:
            "Property filters, all must match. E.g. {property:'lifecyclestage', operator:'EQ', value:'customer'}. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN (value + highValue), IN / NOT_IN (values), HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN.",
          items: {
            type: "object",
            properties: {
              property: { type: "string" },
              operator: { type: "string", enum: OPERATORS },
              value: {},
              values: { type: "array", items: {} },
              highValue: {},
            },
            required: ["property", "operator"],
          },
        },
        properties: {
          type: "array",
          items: { type: "string" },
          description: "Property names to return; default: the usual ones for the object.",
        },
        sort: { type: "string", description: "A property to sort by, e.g. createdate." },
        direction: {
          type: "string",
          enum: ["ASCENDING", "DESCENDING"],
          description: "Default DESCENDING.",
        },
        limit: { type: "number", description: "Records per page, 1 to 100 (default 20)." },
        after: { type: "string", description: "The cursor an earlier page ended with." },
      },
      required: ["object"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runSearch(args, api, hs)),
  };
}

/** The request body of a search: text, filters ANDed in one group, sort, page size and cursor. */
function searchBody(args: Args, object: ObjectName, filters: Record<string, unknown>[]) {
  const query = text(args, "query").trim();
  const sort = text(args, "sort").trim();
  const after = text(args, "after").trim();
  const direction = text(args, "direction") || "DESCENDING";
  return {
    properties: propertiesArg(args, DEFAULT_PROPERTIES[object]),
    limit: limitOf(args),
    ...(query === "" ? {} : { query }),
    ...(filters.length === 0 ? {} : { filterGroups: [{ filters }] }),
    ...(sort === "" ? {} : { sorts: [{ propertyName: sort, direction }] }),
    ...(after === "" ? {} : { after }),
  };
}

async function runSearch(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const picked = objectArg(args);
  if ("problem" in picked) return picked.problem;
  const { object } = picked;
  const filters = filtersOf(args["filters"]);
  if (typeof filters === "string") return filters;
  const path = `/crm/v3/objects/${object}/search`;
  const reply = await hs("POST", path, { body: searchBody(args, object, filters) });
  if (!reply.ok) return explain(reply, "POST", path);
  const rows = rowsOf(reply.data);
  if (rows.length === 0) return `No ${object} match.`;
  const total = field(reply.data, "total");
  const next = nextCursor(reply.data);
  const head = `${rows.length} of ${typeof total === "number" ? total : "?"} ${object}:`;
  const more = next === null ? "That is all of them." : `More: call again with after="${next}".`;
  const shown = await labelled(rows, lookupsOf(hs));
  const asked = propertiesArg(args, []);
  return [head, ...shown.map((row) => renderRow(api, object, row, asked)), more].join("\n\n");
}
