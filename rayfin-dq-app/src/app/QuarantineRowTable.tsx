/**
 * QuarantineRowTable.tsx
 *
 * Priority 1 — Renders quarantined rows for a selected dataset.
 *
 * Columns are rendered dynamically from the row schema — no hardcoded column
 * names. Metadata columns (run_id, run_timestamp, dataset) are pinned to the
 * right; original dataset columns come first in alphabetical order.
 *
 * Triage and edit status are overlaid from QuarantineTriage / QuarantineEdit
 * Rayfin entities, matched by row_hash.
 */
import { useState, useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchQuarantinedRows,
  listRunIds,
  countQuarantinedRows,
} from "../services/quarantineService";
import { computeRowHashes } from "../utils/rowHash";
import { useTriageByRunId, useEditsByRunId } from "../hooks/useQuarantineState";
import { useFabricClients } from "../hooks/useFabricClients";
import { TriageDecision } from "../models/QuarantineTriage";
import { EditStatus } from "../models/QuarantineEdit";
import type { QuarantineTableInfo } from "../services/quarantineService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;
const METADATA_COLUMNS = ["run_id", "run_timestamp", "dataset"];
const TRIAGE_BADGE: Record<TriageDecision, string> = {
  [TriageDecision.Approved]: "bg-green-100 text-green-800",
  [TriageDecision.Rejected]: "bg-red-100 text-red-800",
  [TriageDecision.Escalated]: "bg-yellow-100 text-yellow-800",
};
const EDIT_STATUS_BADGE: Record<EditStatus, string> = {
  [EditStatus.Pending]: "bg-orange-100 text-orange-800",
  [EditStatus.Applied]: "bg-blue-100 text-blue-800",
  [EditStatus.Rejected]: "bg-red-100 text-red-800",
};

// ---------------------------------------------------------------------------
// Filter state
// ---------------------------------------------------------------------------

interface Filters {
  run_id: string;
  from: string;
  to: string;
  triageStatus: TriageDecision | "all" | "none";
  editStatus: EditStatus | "all" | "none";
}

const DEFAULT_FILTERS: Filters = {
  run_id: "",
  from: "",
  to: "",
  triageStatus: "all",
  editStatus: "all",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
  table: QuarantineTableInfo;
  onRowSelect: (row: Record<string, unknown>, rowHash: string) => void;
}

export function QuarantineRowTable({ table, onRowSelect }: Props) {
  const { projectSql } = useFabricClients();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [page, setPage] = useState(0);

  // Reset page when table changes.
  useEffect(() => { setPage(0); setFilters(DEFAULT_FILTERS); }, [table.tableName]);

  // Available run_ids for the dropdown.
  const { data: runIds = [] } = useQuery({
    queryKey: ["run-ids", table.tableName],
    queryFn: () => listRunIds(projectSql, table.tableName),
    staleTime: 60_000,
  });

  // Effective run_id for triage/edit state queries.
  const activeRunId = filters.run_id || runIds[0] || undefined;

  // Quarantine rows.
  const { data: rows = [], isLoading: rowsLoading } = useQuery({
    queryKey: ["quarantine-rows", table.tableName, filters, page],
    queryFn: () =>
      fetchQuarantinedRows(
        projectSql,
        table.tableName,
        {
          run_id: filters.run_id || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        },
      ),
    staleTime: 30_000,
  });

  // Total count for pagination.
  const { data: totalCount = 0 } = useQuery({
    queryKey: ["quarantine-count", table.tableName, filters],
    queryFn: () =>
      countQuarantinedRows(projectSql, table.tableName, {
        run_id: filters.run_id || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    staleTime: 30_000,
  });

  // Triage and edit overlays.
  const triageQuery = useTriageByRunId(activeRunId);
  const editsQuery = useEditsByRunId(activeRunId);
  const triageMap = triageQuery.data ?? new Map();
  const editsMap = editsQuery.data ?? new Map();

  // Row hashes (computed async, stored in state).
  const [rowHashes, setRowHashes] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    computeRowHashes(rows).then((hashes) => {
      if (!cancelled) setRowHashes(hashes);
    });
    return () => { cancelled = true; };
  }, [rows]);

  // Derive column order: data columns alphabetically, then metadata pinned right.
  const columns = useMemo(() => {
    if (rows.length === 0) return [];
    const allKeys = Object.keys(rows[0]);
    const dataKeys = allKeys
      .filter((k) => !METADATA_COLUMNS.includes(k))
      .sort();
    return [...dataKeys, ...METADATA_COLUMNS.filter((m) => allKeys.includes(m))];
  }, [rows]);

  // Client-side triage/edit status filtering.
  const filteredRows = useMemo(() => {
    return rows.filter((_, i) => {
      const hash = rowHashes[i];
      if (!hash) return true;
      const triage = triageMap.get(hash);
      const edits = editsMap.get(hash) ?? [];
      const latestEdit = edits.at(-1);

      if (filters.triageStatus === "none" && triage) return false;
      if (
        filters.triageStatus !== "all" &&
        filters.triageStatus !== "none" &&
        triage?.decision !== filters.triageStatus
      )
        return false;
      if (filters.editStatus === "none" && edits.length > 0) return false;
      if (
        filters.editStatus !== "all" &&
        filters.editStatus !== "none" &&
        latestEdit?.status !== filters.editStatus
      )
        return false;
      return true;
    });
  }, [rows, rowHashes, triageMap, editsMap, filters]);

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">
          {table.tableName}
          <span className="ml-2 text-sm font-normal text-gray-500">
            {totalCount} row{totalCount !== 1 ? "s" : ""}
          </span>
        </h2>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-gray-50 rounded-lg p-3 text-sm">
        {/* Run ID */}
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">Run</label>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={filters.run_id}
            onChange={(e) => {
              setFilters((f) => ({ ...f, run_id: e.target.value }));
              setPage(0);
            }}
          >
            <option value="">All runs</option>
            {runIds.map((id) => (
              <option key={id} value={id}>
                {id.slice(0, 8)}…
              </option>
            ))}
          </select>
        </div>

        {/* Date range */}
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">From</label>
          <input
            type="datetime-local"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={filters.from}
            onChange={(e) => { setFilters((f) => ({ ...f, from: e.target.value })); setPage(0); }}
          />
          <label className="text-gray-600 font-medium">To</label>
          <input
            type="datetime-local"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={filters.to}
            onChange={(e) => { setFilters((f) => ({ ...f, to: e.target.value })); setPage(0); }}
          />
        </div>

        {/* Triage status */}
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">Triage</label>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={filters.triageStatus}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                triageStatus: e.target.value as Filters["triageStatus"],
              }))
            }
          >
            <option value="all">All</option>
            <option value="none">Not triaged</option>
            <option value={TriageDecision.Approved}>Approved</option>
            <option value={TriageDecision.Rejected}>Rejected</option>
            <option value={TriageDecision.Escalated}>Escalated</option>
          </select>
        </div>

        {/* Edit status */}
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">Edit</label>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={filters.editStatus}
            onChange={(e) =>
              setFilters((f) => ({
                ...f,
                editStatus: e.target.value as Filters["editStatus"],
              }))
            }
          >
            <option value="all">All</option>
            <option value="none">No edit</option>
            <option value={EditStatus.Pending}>Pending</option>
            <option value={EditStatus.Applied}>Applied</option>
            <option value={EditStatus.Rejected}>Rejected</option>
          </select>
        </div>
      </div>

      {/* Table */}
      {rowsLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
          Loading rows…
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="text-center text-gray-500 text-sm py-10">
          No rows match the current filters.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {/* Status overlay columns */}
                <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                  Triage
                </th>
                <th className="px-3 py-2 text-left font-medium text-gray-600 whitespace-nowrap">
                  Edit
                </th>
                {/* Dynamic data columns */}
                {columns.map((col) => (
                  <th
                    key={col}
                    className={`px-3 py-2 text-left font-medium whitespace-nowrap ${
                      METADATA_COLUMNS.includes(col)
                        ? "text-gray-400"
                        : "text-gray-700"
                    }`}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {filteredRows.map((row, i) => {
                const hash = rowHashes[rows.indexOf(row)] ?? "";
                const triage = triageMap.get(hash);
                const edits = editsMap.get(hash) ?? [];
                const latestEdit = edits.at(-1);

                return (
                  <tr
                    key={hash || i}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => onRowSelect(row, hash)}
                  >
                    {/* Triage badge */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {triage ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${TRIAGE_BADGE[triage.decision]}`}
                        >
                          {triage.decision}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    {/* Edit badge */}
                    <td className="px-3 py-2 whitespace-nowrap">
                      {latestEdit ? (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${EDIT_STATUS_BADGE[latestEdit.status]}`}
                        >
                          {latestEdit.action} · {latestEdit.status}
                        </span>
                      ) : (
                        <span className="text-gray-300 text-xs">—</span>
                      )}
                    </td>
                    {/* Dynamic data cells */}
                    {columns.map((col) => (
                      <td
                        key={col}
                        className={`px-3 py-2 max-w-xs truncate ${
                          METADATA_COLUMNS.includes(col)
                            ? "text-gray-400 font-mono text-xs"
                            : "text-gray-800"
                        }`}
                        title={String(row[col] ?? "")}
                      >
                        {row[col] === null || row[col] === undefined ? (
                          <span className="text-gray-300 italic">null</span>
                        ) : (
                          String(row[col])
                        )}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-600">
          <span>
            Page {page + 1} of {totalPages} ({totalCount} total rows)
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-gray-100"
              disabled={page >= totalPages - 1}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
