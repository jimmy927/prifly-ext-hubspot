/**
 * The HubSpot extension: what prifly imports. `activate` is given the api,
 * registers the HubSpot tools every session can use and keeps the one status
 * line current. There is nothing else to see: no launcher, no chips. The
 * Service key lives in this extension's own sealed secrets (a `secret`
 * setting), never in prifly's vault. Types come from `@prifly/extension-api`
 * with `import type`, so nothing of it is loaded at run time.
 */

import type { ExtensionApi } from "@prifly/extension-api";
import { apiDocsTool, apiTool } from "./api-tools";
import type { Deps } from "./hubspot";
import { ownersTool, pipelineTool, recordTool } from "./read-tools";
import { searchTool } from "./search-tool";
import { statusText } from "./status";
import { createTool, noteTool, updateTool } from "./write-tools";

let api: ExtensionApi | null = null;

/** The network is the global `fetch`, looked up at each call so a test can stand in for it. */
const deps: Deps = {
  api: () => api,
  fetch: (input, init) => globalThis.fetch(input, init),
};

export function activate(given: ExtensionApi): () => void {
  api = given;
  const refresh = () => given.status?.(statusText(given));
  refresh();
  // Absent on an older prifly: optional, like every part added after the first version.
  given.tools?.register([
    searchTool(deps),
    recordTool(deps),
    ownersTool(deps),
    pipelineTool(deps),
    createTool(deps),
    updateTool(deps),
    noteTool(deps),
    apiDocsTool(deps),
    apiTool(deps),
  ]);
  given.onSettings?.(refresh);
  given.log("activated");
  return () => {
    api = null;
  };
}
