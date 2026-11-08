/**
 * A bundled index of the common HubSpot CRM API endpoints, for
 * `hubspot_api_docs`. It is kept by hand from HubSpot's developer reference
 * (https://developers.hubspot.com/docs/api/overview) rather than read from a
 * HubSpot spec at run time, so the lookup needs no request and no tests reach
 * the network; an endpoint missing here still works through `hubspot_api`.
 */

export type DocsEntry = {
  method: string;
  path: string;
  what: string;
  /** The scope on the Service key, `crm.objects.{object}.read|write` meaning the object in the path. */
  scope: string;
  params?: string[];
  notes?: string;
};

const OBJ =
  "{object}: contacts, companies, deals, tickets, products, line_items, quotes, notes, calls, emails, meetings, tasks";

export const DOCS_INDEX: DocsEntry[] = [
  {
    method: "GET",
    path: "/crm/v3/objects/{object}",
    what: "List records of an object, a page at a time.",
    scope: "crm.objects.{object}.read",
    params: [
      OBJ,
      "limit (query, max 100)",
      "after (query, the paging cursor)",
      "properties (query, comma separated)",
      "associations (query, comma separated object types)",
      "archived (query, boolean)",
    ],
  },
  {
    method: "GET",
    path: "/crm/v3/objects/{object}/{id}",
    what: "Read one record by id.",
    scope: "crm.objects.{object}.read",
    params: [
      OBJ,
      "properties (query, comma separated)",
      "associations (query)",
      "idProperty (query, e.g. email to read a contact by email)",
    ],
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}",
    what: "Create a record.",
    scope: "crm.objects.{object}.write",
    params: [OBJ],
    notes:
      'Body: {"properties":{…},"associations":[{"to":{"id":"…"},"types":[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":N}]}]}.',
  },
  {
    method: "PATCH",
    path: "/crm/v3/objects/{object}/{id}",
    what: "Update a record's properties.",
    scope: "crm.objects.{object}.write",
    notes: 'Body: {"properties":{…}}. Set a property to "" to clear it.',
  },
  {
    method: "DELETE",
    path: "/crm/v3/objects/{object}/{id}",
    what: "Archive (soft delete) a record.",
    scope: "crm.objects.{object}.write",
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}/search",
    what: "Search records by text and filters.",
    scope: "crm.objects.{object}.read",
    params: [
      "query (body, text)",
      "filterGroups (body, OR of groups, each an AND of filters)",
      "properties (body)",
      "sorts (body)",
      "limit (body, max 200)",
      "after (body)",
    ],
    notes:
      'Filter: {"propertyName":"email","operator":"EQ","value":"a@b.c"}. Operators: EQ, NEQ, LT, LTE, GT, GTE, BETWEEN, IN, NOT_IN, HAS_PROPERTY, NOT_HAS_PROPERTY, CONTAINS_TOKEN, NOT_CONTAINS_TOKEN. At most 5 filter groups, 6 filters each, 10,000 results in all. Runs at once through hubspot_api.',
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}/batch/read",
    what: "Read up to 100 records by id (or by another unique property with idProperty).",
    scope: "crm.objects.{object}.read",
    notes:
      'Body: {"properties":["…"],"inputs":[{"id":"1"}]}. A POST that is not a /search: needs the reader\'s confirm.',
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}/batch/create",
    what: "Create up to 100 records.",
    scope: "crm.objects.{object}.write",
    notes: 'Body: {"inputs":[{"properties":{…}}]}.',
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}/batch/update",
    what: "Update up to 100 records.",
    scope: "crm.objects.{object}.write",
    notes: 'Body: {"inputs":[{"id":"1","properties":{…}}]}.',
  },
  {
    method: "POST",
    path: "/crm/v3/objects/{object}/batch/upsert",
    what: "Create or update records, matched on a unique property.",
    scope: "crm.objects.{object}.write",
    notes: 'Body: {"inputs":[{"idProperty":"email","id":"a@b.c","properties":{…}}]}.',
  },
  {
    method: "POST",
    path: "/crm/v3/objects/notes",
    what: "Create a note, associated to a record at creation.",
    scope: "crm.objects.contacts.write (or the object the note is on)",
    notes:
      'Body: {"properties":{"hs_timestamp":"ISO time","hs_note_body":"<html>"},"associations":[{"to":{"id":"…"},"types":[{"associationCategory":"HUBSPOT_DEFINED","associationTypeId":202}]}]}. Note to contact 202, to company 190, to deal 214.',
  },
  {
    method: "GET",
    path: "/crm/v4/objects/{fromObject}/{id}/associations/{toObject}",
    what: "List the records of another type a record is associated with, with their association labels.",
    scope: "crm.objects.{fromObject}.read",
  },
  {
    method: "PUT",
    path: "/crm/v4/objects/{fromObject}/{id}/associations/default/{toObject}/{toId}",
    what: "Associate two records with the default association type.",
    scope: "crm.objects.{fromObject}.write",
  },
  {
    method: "DELETE",
    path: "/crm/v4/objects/{fromObject}/{id}/associations/{toObject}/{toId}",
    what: "Remove every association between two records.",
    scope: "crm.objects.{fromObject}.write",
  },
  {
    method: "GET",
    path: "/crm/v4/associations/{fromObject}/{toObject}/labels",
    what: "List the association labels (and their type ids) between two object types.",
    scope: "crm.objects.{fromObject}.read",
  },
  {
    method: "GET",
    path: "/crm/v3/properties/{object}",
    what: "List an object's properties: internal name, label, type, field type, options.",
    scope: "crm.schemas.{object}.read",
    notes: "Use it to find the internal names that search filters and writes need.",
  },
  {
    method: "GET",
    path: "/crm/v3/properties/{object}/{propertyName}",
    what: "Read one property definition, including the options of an enumeration.",
    scope: "crm.schemas.{object}.read",
  },
  {
    method: "POST",
    path: "/crm/v3/properties/{object}",
    what: "Create a custom property.",
    scope: "crm.schemas.{object}.write",
  },
  {
    method: "GET",
    path: "/crm/v3/pipelines/{object}",
    what: "List the pipelines of deals or tickets with their stages (id, label, order, probability, closed).",
    scope: "crm.objects.{object}.read",
    notes: "A deal's dealstage property holds a stage id; the label is here.",
  },
  {
    method: "GET",
    path: "/crm/v3/owners",
    what: "List owners: id, email, first and last name, user id.",
    scope: "crm.objects.owners.read",
    params: [
      "email (query, one owner)",
      "limit (query, max 500)",
      "after (query)",
      "archived (query)",
    ],
  },
  {
    method: "GET",
    path: "/crm/v3/owners/{ownerId}",
    what: "Read one owner.",
    scope: "crm.objects.owners.read",
  },
  {
    method: "GET",
    path: "/crm/v3/lists/{listId}",
    what: "Read a list's definition.",
    scope: "crm.lists.read",
  },
  {
    method: "GET",
    path: "/crm/v3/lists/{listId}/memberships",
    what: "List the record ids in a list.",
    scope: "crm.lists.read",
  },
  {
    method: "POST",
    path: "/crm/v3/lists/search",
    what: "Search lists by name.",
    scope: "crm.lists.read",
    notes: "Runs at once through hubspot_api.",
  },
  {
    method: "GET",
    path: "/crm/v3/schemas",
    what: "List the custom object schemas.",
    scope: "crm.schemas.custom.read",
  },
  {
    method: "GET",
    path: "/account-info/v3/details",
    what: "The account's portal id, data hosting location, time zone and currency.",
    scope: "account-info.security.read",
  },
  {
    method: "GET",
    path: "/settings/v3/users",
    what: "List the account's users.",
    scope: "settings.users.read",
  },
];

/** One entry as text for the session. */
export function renderEntry(entry: DocsEntry): string {
  const lines = [`${entry.method} ${entry.path}`, `  ${entry.what}`, `  scope: ${entry.scope}`];
  for (const each of entry.params ?? []) lines.push(`  - ${each}`);
  if (entry.notes !== undefined) lines.push(`  ${entry.notes}`);
  return lines.join("\n");
}
