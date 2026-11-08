/** Ids HubSpot hands out for owners, deal stages and lead statuses, and the labels they stand for. */

import { explain, field, type Hs, isRecord, nextCursor, str } from "./hubspot";
import type { Row } from "./records";

export type Stage = { id: string; label: string; order: number };
export type Pipeline = { id: string; label: string; stages: Stage[] };

export function pipelinesOf(data: unknown): Pipeline[] {
  const results = field(data, "results");
  if (!Array.isArray(results)) return [];
  return results.map((each) => {
    const stages = field(each, "stages");
    return {
      id: str(field(each, "id")) ?? "?",
      label: str(field(each, "label")) ?? "?",
      stages: (Array.isArray(stages) ? stages : [])
        .map((stage) => ({
          id: str(field(stage, "id")) ?? "?",
          label: str(field(stage, "label")) ?? "?",
          order: Number(field(stage, "displayOrder")) || 0,
        }))
        .sort((a, b) => a.order - b.order),
    };
  });
}

/** Every owner, paging through HubSpot's cursor. */
export async function allOwners(hs: Hs): Promise<{ rows: Record<string, unknown>[] } | string> {
  const rows: Record<string, unknown>[] = [];
  let after: string | undefined;
  for (let page = 0; page < 10; page++) {
    const reply = await hs("GET", "/crm/v3/owners", {
      query: { limit: "100", ...(after === undefined ? {} : { after }) },
    });
    if (!reply.ok) return explain(reply, "GET", "/crm/v3/owners");
    const results = field(reply.data, "results");
    if (Array.isArray(results)) rows.push(...results.filter(isRecord));
    after = nextCursor(reply.data) ?? undefined;
    if (after === undefined) break;
  }
  return { rows };
}

/** Id to label for each kind of id; a map stays empty when HubSpot would not say. */
export type Lookups = {
  owners: () => Promise<Map<string, string>>;
  stages: () => Promise<Map<string, string>>;
  pipelines: () => Promise<Map<string, string>>;
  leadStatuses: () => Promise<Map<string, string>>;
};

/** Runs `load` on first use only: a tool run asks HubSpot once per lookup, not once per record. */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= load();
    return pending;
  };
}

/** The lookups of one tool run; each calls HubSpot at most once, and only if a record needs it. */
export function lookupsOf(hs: Hs): Lookups {
  const deals = once(async () => {
    const reply = await hs("GET", "/crm/v3/pipelines/deals");
    return reply.ok ? pipelinesOf(reply.data) : [];
  });
  return {
    owners: once(async () => {
      const owners = await allOwners(hs);
      const names = new Map<string, string>();
      if (typeof owners === "string") return names;
      for (const each of owners.rows) {
        const id = str(each["id"]);
        const name = [str(each["firstName"]), str(each["lastName"])].filter(Boolean).join(" ");
        if (id !== null && name !== "") names.set(id, name);
      }
      return names;
    }),
    stages: once(async () => {
      const labels = new Map<string, string>();
      for (const pipeline of await deals()) {
        for (const stage of pipeline.stages) labels.set(stage.id, stage.label);
      }
      return labels;
    }),
    pipelines: once(async () => new Map((await deals()).map((each) => [each.id, each.label]))),
    leadStatuses: once(async () => {
      const labels = new Map<string, string>();
      const reply = await hs("GET", "/crm/v3/properties/contacts/hs_lead_status");
      const options = field(reply.data, "options");
      if (!reply.ok || !Array.isArray(options)) return labels;
      for (const option of options) {
        const value = str(field(option, "value"));
        const label = str(field(option, "label"));
        if (value !== null && label !== null) labels.set(value, label);
      }
      return labels;
    }),
  };
}

/** Which lookup a property's value goes through, and whether the id stays beside the label. */
const SHOWN_AS: Record<string, { lookup: keyof Lookups; withId: boolean }> = {
  hubspot_owner_id: { lookup: "owners", withId: true },
  dealstage: { lookup: "stages", withId: true },
  pipeline: { lookup: "pipelines", withId: true },
  hs_lead_status: { lookup: "leadStatuses", withId: false },
};

/** The rows with owner, stage, pipeline and lead-status ids written as labels; unknown ids stay as they are. */
export async function labelled(rows: Row[], lookups: Lookups): Promise<Row[]> {
  const out: Row[] = [];
  for (const row of rows) {
    const properties = { ...row.properties };
    for (const [name, value] of Object.entries(properties)) {
      const how = SHOWN_AS[name];
      if (how === undefined) continue;
      const label = (await lookups[how.lookup]()).get(value);
      if (label !== undefined) properties[name] = how.withId ? `${label} (${value})` : label;
    }
    out.push({ id: row.id, properties });
  }
  return out;
}
