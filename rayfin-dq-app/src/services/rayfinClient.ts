/**
 * rayfinClient.ts
 *
 * Typed service functions for Rayfin-managed entities (QuarantineTriage,
 * QuarantineEdit). Uses the singleton RayfinClient from src/lib/rayfin.ts
 * and its fluent data API.
 *
 * Responsibilities handled here (not by the entity layer):
 *   - Populating `decided_by` / `edited_by` from getSessionUserId()
 *   - Populating `decided_at` / `edited_at` as new Date()
 *   - JSON-encoding `corrections` before persisting; decoding when reading
 *   - Mapping entity types (Date fields) to service interfaces (string dates)
 *   - Auto-paginating through all pages and returning flat maps
 */
import { client, getSessionUserId } from "../lib/rayfin";
import type { TriageDecision } from "../models/QuarantineTriage";
import { EditStatus } from "../models/QuarantineEdit";
import type { EditAction } from "../models/QuarantineEdit";

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

const PAGE_SIZE = 250;

// ---------------------------------------------------------------------------
// QuarantineTriage
// ---------------------------------------------------------------------------

export interface TriageRecord {
  id: string;
  dataset: string;
  run_id: string;
  row_hash: string;
  decision: TriageDecision;
  decided_by: string;
  decided_at: string;
  notes?: string | null;
}

function mapToTriageRecord(item: {
  id: string;
  dataset: string;
  run_id: string;
  row_hash: string;
  decision: "approved" | "rejected" | "escalated";
  decided_by: string;
  decided_at: Date;
  notes?: string;
}): TriageRecord {
  return {
    id: item.id,
    dataset: item.dataset,
    run_id: item.run_id,
    row_hash: item.row_hash,
    decision: item.decision as TriageDecision,
    decided_by: item.decided_by,
    decided_at:
      item.decided_at instanceof Date
        ? item.decided_at.toISOString()
        : String(item.decided_at),
    notes: item.notes ?? null,
  };
}

/**
 * Fetch all QuarantineTriage records for a given run_id, auto-paginating
 * through all pages. Returns a map of row_hash → TriageRecord for O(1) lookup.
 */
export async function listTriageByRunId(
  run_id: string,
  pageSize = PAGE_SIZE,
): Promise<Map<string, TriageRecord>> {
  const map = new Map<string, TriageRecord>();
  let cursor: string | undefined;

  do {
    const builder = client.data.QuarantineTriage.where({
      run_id: { eq: run_id },
    }).first(pageSize);

    if (cursor !== undefined) builder.after(cursor);

    const page = await builder.executePaginated();

    for (const item of page.items) {
      map.set(item.row_hash, mapToTriageRecord(item));
    }

    cursor =
      page.hasNextPage && page.endCursor !== undefined
        ? page.endCursor
        : undefined;
  } while (cursor !== undefined);

  return map;
}

export async function createTriage(input: {
  dataset: string;
  run_id: string;
  row_hash: string;
  decision: TriageDecision;
  notes?: string;
}): Promise<TriageRecord> {
  const result = await client.data.QuarantineTriage.create({
    dataset: input.dataset,
    run_id: input.run_id,
    row_hash: input.row_hash,
    decision: input.decision as "approved" | "rejected" | "escalated",
    decided_by: getSessionUserId(),
    decided_at: new Date(),
    notes: input.notes,
  });
  return mapToTriageRecord(result);
}

export async function updateTriage(
  id: string,
  patch: Partial<Pick<TriageRecord, "decision" | "notes">>,
): Promise<TriageRecord> {
  const result = await client.data.QuarantineTriage.update(
    { id },
    {
      decision: patch.decision as "approved" | "rejected" | "escalated" | undefined,
      notes: patch.notes ?? undefined,
    },
  );
  if (!result) throw new Error(`QuarantineTriage ${id} not found`);
  return mapToTriageRecord(result);
}

// ---------------------------------------------------------------------------
// QuarantineEdit
// ---------------------------------------------------------------------------

export interface EditRecord {
  id: string;
  dataset: string;
  run_id: string;
  row_hash: string;
  action: EditAction;
  corrections: Record<string, unknown> | null;
  status: EditStatus;
  edited_by: string;
  edited_at: string;
  notes?: string | null;
}

function mapToEditRecord(item: {
  id: string;
  dataset: string;
  run_id: string;
  row_hash: string;
  action: "delete" | "correct";
  corrections?: string;
  status: "pending" | "applied" | "rejected";
  edited_by: string;
  edited_at: Date;
  notes?: string;
}): EditRecord {
  return {
    id: item.id,
    dataset: item.dataset,
    run_id: item.run_id,
    row_hash: item.row_hash,
    action: item.action as EditAction,
    corrections: item.corrections
      ? (JSON.parse(item.corrections) as Record<string, unknown>)
      : null,
    status: item.status as EditStatus,
    edited_by: item.edited_by,
    edited_at:
      item.edited_at instanceof Date
        ? item.edited_at.toISOString()
        : String(item.edited_at),
    notes: item.notes ?? null,
  };
}

/**
 * Fetch all QuarantineEdit records for a given run_id, auto-paginating
 * through all pages. Returns a map of row_hash → EditRecord[].
 */
export async function listEditsByRunId(
  run_id: string,
  pageSize = PAGE_SIZE,
): Promise<Map<string, EditRecord[]>> {
  const map = new Map<string, EditRecord[]>();
  let cursor: string | undefined;

  do {
    const builder = client.data.QuarantineEdit.where({
      run_id: { eq: run_id },
    }).first(pageSize);

    if (cursor !== undefined) builder.after(cursor);

    const page = await builder.executePaginated();

    for (const item of page.items) {
      const existing = map.get(item.row_hash) ?? [];
      existing.push(mapToEditRecord(item));
      map.set(item.row_hash, existing);
    }

    cursor =
      page.hasNextPage && page.endCursor !== undefined
        ? page.endCursor
        : undefined;
  } while (cursor !== undefined);

  return map;
}

export async function createEdit(input: {
  dataset: string;
  run_id: string;
  row_hash: string;
  action: EditAction;
  corrections?: Record<string, unknown> | null;
  notes?: string;
}): Promise<EditRecord> {
  const result = await client.data.QuarantineEdit.create({
    dataset: input.dataset,
    run_id: input.run_id,
    row_hash: input.row_hash,
    action: input.action as "delete" | "correct",
    corrections:
      input.corrections != null
        ? JSON.stringify(input.corrections)
        : undefined,
    status: EditStatus.Pending as "pending" | "applied" | "rejected",
    edited_by: getSessionUserId(),
    edited_at: new Date(),
    notes: input.notes,
  });
  return mapToEditRecord(result);
}

