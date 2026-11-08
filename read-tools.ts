/** The reads that are not a search: one record with its activity, the owners, the deal pipelines. */

import type { ExtensionApi, ExtensionTool } from "@prifly/extension-api";
import {
  type Args,
  type Deps,
  explain,
  field,
  type Hs,
  idArg,
  nextCursor,
  OBJECT_ENUM,
  objectArg,
  str,
  text,
  withKey,
} from "./hubspot";
import { allOwners, labelled, lookupsOf, type Pipeline, pipelinesOf } from "./lookups";
import { DATA_NOTE, DEFAULT_PROPERTIES, plain, renderRow, rowsOf } from "./records";
import { propertiesArg } from "./search-tool";

/** The activity kinds a record carries, and the properties that say what each was. */
const ACTIVITIES: Record<string, { title: string; body: string[] }> = {
  notes: { title: "Note", body: ["hs_note_body"] },
  calls: { title: "Call", body: ["hs_call_title", "hs_call_body"] },
  emails: { title: "Email", body: ["hs_email_subject", "hs_email_text"] },
  meetings: { title: "Meeting", body: ["hs_meeting_title", "hs_meeting_body"] },
  tasks: { title: "Task", body: ["hs_task_subject", "hs_task_body", "hs_task_status"] },
};
const PER_KIND = 10;

/** The ids of one kind of activity from a record's `associations`. */
function idsOf(associations: unknown, kind: string): string[] {
  const results = field(field(associations, kind), "results");
  if (!Array.isArray(results)) return [];
  return results.flatMap((each) => str(field(each, "id")) ?? []);
}

/** One kind of activity, as text lines; the sentence for why not when it cannot be read. */
async function activityOf(hs: Hs, kind: string, ids: string[]): Promise<string[]> {
  const spec = ACTIVITIES[kind];
  if (spec === undefined || ids.length === 0) return [];
  const path = `/crm/v3/objects/${kind}/batch/read`;
  const reply = await hs("POST", path, {
    body: {
      properties: [...spec.body, "hs_timestamp"],
      inputs: ids.slice(0, PER_KIND).map((id) => ({ id })),
    },
  });
  if (!reply.ok)
    return [`${spec.title}s: ${ids.length}, but not readable. ${explain(reply, "POST", path)}`];
  const rows = rowsOf(reply.data).sort((a, b) =>
    (b.properties["hs_timestamp"] ?? "").localeCompare(a.properties["hs_timestamp"] ?? ""),
  );
  const shown = rows.map((row) => {
    const said = spec.body.map((name) => row.properties[name]).filter((v) => v !== undefined);
    const when = (row.properties["hs_timestamp"] ?? "").slice(0, 10);
    return `  - ${when} #${row.id}: ${plain(said.join(" — ") || "(empty)")}`;
  });
  const more = ids.length > PER_KIND ? [`  (${ids.length - PER_KIND} more not shown)`] : [];
  return [`${spec.title}s (${ids.length}):`, ...shown, ...more];
}

/** The ids of what a record is associated with, as `contacts: 1, 2`. */
function associatedLine(associations: unknown, kind: string): string | null {
  const ids = idsOf(associations, kind);
  return ids.length === 0 ? null : `${kind}: ${ids.join(", ")}`;
}

export function recordTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_record",
    description: `Read one HubSpot contact, company or deal by its id: its properties, a link to it, the ids it is associated with, and its latest notes, calls, emails, meetings and tasks. Runs at once, changes nothing. Find the id with hubspot_search. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        object: { type: "string", enum: OBJECT_ENUM, description: "contacts, companies or deals." },
        id: { type: "string", description: "The record's numeric HubSpot id." },
        properties: {
          type: "array",
          items: { type: "string" },
          description: "Property names to return; default: the usual ones for the object.",
        },
      },
      required: ["object", "id"],
    },
    call: (args, ctx) => withKey(deps, ctx.signal, (api, hs) => runRecord(args, api, hs)),
  };
}

async function runRecord(args: Args, api: ExtensionApi, hs: Hs): Promise<string> {
  const picked = objectArg(args);
  if ("problem" in picked) return picked.problem;
  const { object } = picked;
  const id = idArg(args);
  const others = OBJECT_ENUM.filter((each) => each !== object);
  const path = `/crm/v3/objects/${object}/${id}`;
  const properties = propertiesArg(args, DEFAULT_PROPERTIES[object]);
  const reply = await hs("GET", path, {
    query: {
      properties: properties.join(","),
      associations: [...Object.keys(ACTIVITIES), ...others].join(","),
    },
  });
  if (reply.status === 404) return `No ${object} record with id ${id}.`;
  if (!reply.ok) return explain(reply, "GET", path);
  const [found] = rowsOf({ results: [reply.data] });
  if (found === undefined) return `HubSpot answered without a record for ${object} ${id}.`;
  const [row = found] = await labelled([found], lookupsOf(hs));
  const associations = field(reply.data, "associations");
  const related = others.flatMap((kind) => associatedLine(associations, kind) ?? []);
  const activity: string[] = [];
  for (const kind of Object.keys(ACTIVITIES)) {
    activity.push(...(await activityOf(hs, kind, idsOf(associations, kind))));
  }
  return [
    renderRow(api, object, row, propertiesArg(args, [])),
    ...(related.length === 0 ? [] : ["Associated:", ...related.map((line) => `  ${line}`)]),
    ...(activity.length === 0 ? ["No notes, calls, emails, meetings or tasks."] : activity),
  ].join("\n");
}

export function ownersTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_owners",
    description: `List the HubSpot owners (the users records can be assigned to): id, name and email. A record's hubspot_owner_id is one of these ids. Runs at once, changes nothing. ${DATA_NOTE}`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    call: (_args, ctx) =>
      withKey(deps, ctx.signal, async (_api, hs) => {
        const owners = await allOwners(hs);
        if (typeof owners === "string") return owners;
        if (owners.rows.length === 0) return "HubSpot lists no owners.";
        const lines = owners.rows.map((each) => {
          const name = [str(each["firstName"]), str(each["lastName"])].filter(Boolean).join(" ");
          return `#${String(each["id"])} ${name || "(no name)"} <${str(each["email"]) ?? "no email"}>`;
        });
        return [`${lines.length} owners:`, ...lines].join("\n");
      }),
  };
}

const MAX_DEAL_PAGES = 10;

/** The deals' stage, pipeline and amount, a hundred a page; `capped` when there were more. */
async function allDeals(
  hs: Hs,
): Promise<{ rows: ReturnType<typeof rowsOf>; capped: boolean } | string> {
  const rows: ReturnType<typeof rowsOf> = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_DEAL_PAGES; page++) {
    const reply = await hs("GET", "/crm/v3/objects/deals", {
      query: {
        limit: "100",
        properties: "dealstage,pipeline,amount",
        ...(after === undefined ? {} : { after }),
      },
    });
    if (!reply.ok) return explain(reply, "GET", "/crm/v3/objects/deals");
    rows.push(...rowsOf(reply.data));
    after = nextCursor(reply.data) ?? undefined;
    if (after === undefined) return { rows, capped: false };
  }
  return { rows, capped: true };
}

export function pipelineTool(deps: Deps): ExtensionTool {
  return {
    name: "hubspot_pipeline",
    description: `The deal pipelines: each stage by its label, with how many deals sit in it and their summed amount. Runs at once, changes nothing. ${DATA_NOTE}`,
    inputSchema: {
      type: "object",
      properties: {
        pipeline: {
          type: "string",
          description: "A pipeline's id or label; default: all pipelines.",
        },
      },
    },
    call: (args, ctx) =>
      withKey(deps, ctx.signal, async (_api, hs) => {
        const path = "/crm/v3/pipelines/deals";
        const pipelines = await hs("GET", path);
        if (!pipelines.ok) return explain(pipelines, "GET", path);
        const deals = await allDeals(hs);
        if (typeof deals === "string") return deals;
        const wanted = text(args, "pipeline").trim().toLowerCase();
        const chosen = pipelinesOf(pipelines.data).filter(
          (each) =>
            wanted === "" ||
            each.id.toLowerCase() === wanted ||
            each.label.toLowerCase() === wanted,
        );
        if (chosen.length === 0) return `No deal pipeline "${wanted}".`;
        const blocks = chosen.map((pipeline) => describePipeline(pipeline, deals.rows));
        const cap = deals.capped ? [`Counted the first ${deals.rows.length} deals only.`] : [];
        return [...blocks, ...cap].join("\n\n");
      }),
  };
}

function describePipeline(pipeline: Pipeline, deals: ReturnType<typeof rowsOf>): string {
  const mine = deals.filter((deal) => deal.properties["pipeline"] === pipeline.id);
  const lines = pipeline.stages.map((stage) => {
    const here = mine.filter((deal) => deal.properties["dealstage"] === stage.id);
    const sum = here.reduce((total, deal) => total + (Number(deal.properties["amount"]) || 0), 0);
    return `  ${stage.label} (${stage.id}): ${here.length} ${here.length === 1 ? "deal" : "deals"}, amount ${sum}`;
  });
  const known = new Set(pipeline.stages.map((stage) => stage.id));
  const stray = mine.filter((deal) => !known.has(deal.properties["dealstage"] ?? ""));
  const extra = stray.length > 0 ? [`  (other stage): ${stray.length} deals`] : [];
  return [`${pipeline.label} (${pipeline.id}): ${mine.length} deals`, ...lines, ...extra].join(
    "\n",
  );
}
