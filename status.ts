/**
 * The extension's one line in Settings → Extensions: whether a Service key is
 * stored and whether writes are on. It makes no request, so it costs nothing
 * and cannot fail; whether the key works shows when a tool is used.
 */

import type { ExtensionApi } from "@prifly/extension-api";

export function statusText(api: ExtensionApi): string {
  if (api.settings?.["accessToken"] !== true) return "No Service key yet: paste one below.";
  const writes =
    api.settings["writes"] === true ? "writes on, each behind a confirm card" : "read-only";
  return `Service key stored · portal ${String(api.settings["portal"] ?? "")} · ${writes}`;
}
