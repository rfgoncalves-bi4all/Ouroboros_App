/**
 * rayfinClient.ts
 *
 * GraphQL client for the Rayfin-auto-generated API.
 *
 * Rayfin generates a GraphQL schema from the @entity decorated classes
 * (QuarantineTriage, QuarantineEdit). This module provides typed wrappers
 * around the mutations and queries the app needs.
 *
 * The GraphQL endpoint URL is injected by Rayfin at deploy time via
 * VITE_RAYFIN_GRAPHQL_URL. Auth is user-passthrough: the Bearer token
 * from the Rayfin session is forwarded on every request.
 */
import { GraphQLClient, gql } from "graphql-request";
import type { TriageDecision } from "../models/QuarantineTriage";
import type { EditAction, EditStatus } from "../models/QuarantineEdit";

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createRayfinClient(bearerToken: string): GraphQLClient {
  const endpoint =
    import.meta.env.VITE_RAYFIN_GRAPHQL_URL ?? "/api/graphql";
  return new GraphQLClient(endpoint, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
}

// ---------------------------------------------------------------------------
// QuarantineTriage — queries & mutations
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

const TRIAGE_FIELDS = gql`
  fragment TriageFields on QuarantineTriage {
    id
    dataset
    run_id
    row_hash
    decision
    decided_by
    decided_at
    notes
  }
`;

/**
 * Fetch all QuarantineTriage records for a given run_id.
 * Returns a map of row_hash → TriageRecord for O(1) overlay lookup.
 */
export async function listTriageByRunId(
  client: GraphQLClient,
  run_id: string,
): Promise<Map<string, TriageRecord>> {
  const query = gql`
    ${TRIAGE_FIELDS}
    query ListTriageByRunId($run_id: String!) {
      listQuarantineTriage(filter: { run_id: { eq: $run_id } }) {
        items {
          ...TriageFields
        }
      }
    }
  `;

  const data = await client.request<{
    listQuarantineTriage: { items: TriageRecord[] };
  }>(query, { run_id });

  const map = new Map<string, TriageRecord>();
  for (const item of data.listQuarantineTriage.items) {
    map.set(item.row_hash, item);
  }
  return map;
}

export async function createTriage(
  client: GraphQLClient,
  input: {
    dataset: string;
    run_id: string;
    row_hash: string;
    decision: TriageDecision;
    notes?: string;
  },
): Promise<TriageRecord> {
  const mutation = gql`
    ${TRIAGE_FIELDS}
    mutation CreateTriage($input: CreateQuarantineTriageInput!) {
      createQuarantineTriage(input: $input) {
        ...TriageFields
      }
    }
  `;
  const data = await client.request<{
    createQuarantineTriage: TriageRecord;
  }>(mutation, { input });
  return data.createQuarantineTriage;
}

export async function updateTriage(
  client: GraphQLClient,
  id: string,
  patch: Partial<Pick<TriageRecord, "decision" | "notes">>,
): Promise<TriageRecord> {
  const mutation = gql`
    ${TRIAGE_FIELDS}
    mutation UpdateTriage($id: ID!, $input: UpdateQuarantineTriageInput!) {
      updateQuarantineTriage(id: $id, input: $input) {
        ...TriageFields
      }
    }
  `;
  const data = await client.request<{
    updateQuarantineTriage: TriageRecord;
  }>(mutation, { id, input: patch });
  return data.updateQuarantineTriage;
}

// ---------------------------------------------------------------------------
// QuarantineEdit — queries & mutations
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

const EDIT_FIELDS = gql`
  fragment EditFields on QuarantineEdit {
    id
    dataset
    run_id
    row_hash
    action
    corrections
    status
    edited_by
    edited_at
    notes
  }
`;

/**
 * Fetch all QuarantineEdit records for a given run_id.
 * Returns a map of row_hash → EditRecord[].
 */
export async function listEditsByRunId(
  client: GraphQLClient,
  run_id: string,
): Promise<Map<string, EditRecord[]>> {
  const query = gql`
    ${EDIT_FIELDS}
    query ListEditsByRunId($run_id: String!) {
      listQuarantineEdit(filter: { run_id: { eq: $run_id } }) {
        items {
          ...EditFields
        }
      }
    }
  `;

  const data = await client.request<{
    listQuarantineEdit: { items: EditRecord[] };
  }>(query, { run_id });

  const map = new Map<string, EditRecord[]>();
  for (const item of data.listQuarantineEdit.items) {
    const existing = map.get(item.row_hash) ?? [];
    existing.push(item);
    map.set(item.row_hash, existing);
  }
  return map;
}

export async function createEdit(
  client: GraphQLClient,
  input: {
    dataset: string;
    run_id: string;
    row_hash: string;
    action: EditAction;
    corrections?: Record<string, unknown> | null;
    notes?: string;
  },
): Promise<EditRecord> {
  const mutation = gql`
    ${EDIT_FIELDS}
    mutation CreateEdit($input: CreateQuarantineEditInput!) {
      createQuarantineEdit(input: $input) {
        ...EditFields
      }
    }
  `;
  const data = await client.request<{ createQuarantineEdit: EditRecord }>(
    mutation,
    { input },
  );
  return data.createQuarantineEdit;
}
