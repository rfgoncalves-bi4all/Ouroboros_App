/**
 * useQuarantineState.ts
 *
 * React Query hooks that fetch and cache QuarantineTriage and QuarantineEdit
 * records from the Rayfin GraphQL API for a given run_id.
 *
 * Returns maps keyed by row_hash for O(1) overlay lookup in QuarantineRowTable.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  listTriageByRunId,
  listEditsByRunId,
  createTriage,
  updateTriage,
  createEdit,
  type TriageRecord,
} from "../services/rayfinClient";
import type { TriageDecision } from "../models/QuarantineTriage";
import type { EditAction } from "../models/QuarantineEdit";

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

const triageKey = (run_id: string) => ["triage", run_id] as const;
const editsKey = (run_id: string) => ["edits", run_id] as const;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useTriageByRunId(
  run_id: string | undefined,
) {
  return useQuery({
    queryKey: triageKey(run_id ?? ""),
    queryFn: () => listTriageByRunId(run_id!),  
    enabled: !!run_id,
    staleTime: 30_000,
  });
}

export function useEditsByRunId(
  run_id: string | undefined,
) {
  return useQuery({
    queryKey: editsKey(run_id ?? ""),
    queryFn: () => listEditsByRunId(run_id!),  
    enabled: !!run_id,
    staleTime: 30_000,
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function useUpsertTriage(run_id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: {
      existing: TriageRecord | undefined;
      dataset: string;
      row_hash: string;
      decision: TriageDecision;
      notes?: string;
    }) => {
      if (args.existing) {
        return updateTriage(args.existing.id, {
          decision: args.decision,
          notes: args.notes,
        });
      }
      return createTriage({
        dataset: args.dataset,
        run_id,
        row_hash: args.row_hash,
        decision: args.decision,
        notes: args.notes,
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: triageKey(run_id) });
    },
  });
}

export function useCreateEdit(run_id: string) {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: (args: {
      dataset: string;
      row_hash: string;
      action: EditAction;
      corrections?: Record<string, unknown> | null;
      notes?: string;
    }) =>
      createEdit({
        ...args,
        run_id,
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: editsKey(run_id) });
    },
  });
}
