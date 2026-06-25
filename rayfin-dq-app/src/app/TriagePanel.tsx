/**
 * TriagePanel.tsx
 *
 * Priority 1 — Side panel for a selected quarantined row.
 *
 * Displays:
 *   - Full row data (dynamic columns, scrollable)
 *   - Linked check failures from dq_results for the row's run_id
 *   - Triage section: Approve / Reject / Escalate → creates/updates QuarantineTriage
 *   - Edit section:
 *       "Flag for deletion" → QuarantineEdit { action: delete }
 *       "Correct values"    → inline editable fields → QuarantineEdit { action: correct }
 *
 * A row may independently have both a triage decision and an edit record.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchRunCheckFailures } from "../services/quarantineService";
import { useUpsertTriage, useCreateEdit } from "../hooks/useQuarantineState";
import { useFabricClients } from "../hooks/useFabricClients";
import { TriageDecision } from "../models/QuarantineTriage";
import { EditAction } from "../models/QuarantineEdit";
import type { TriageRecord, EditRecord } from "../services/rayfinClient";
import type { CheckFailure } from "../services/quarantineService";
import { METADATA_COLUMNS } from "../utils/rowHash";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  row: Record<string, unknown>;
  rowHash: string;
  dataset: string;
  run_id: string;
  existingTriage: TriageRecord | undefined;
  existingEdits: EditRecord[];
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function Cell({ label, value }: { label: string; value: unknown }) {
  const display =
    value === null || value === undefined ? (
      <span className="italic text-gray-400">null</span>
    ) : (
      <span className="break-all">{String(value)}</span>
    );
  return (
    <div className="flex flex-col">
      <dt className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-gray-900">{display}</dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function TriagePanel({
  row,
  rowHash,
  dataset,
  run_id,
  existingTriage,
  existingEdits,
  onClose,
}: Props) {
  const { dqEngineSql } = useFabricClients();
  const [triageNotes, setTriageNotes] = useState(existingTriage?.notes ?? "");
  const [editNotes, setEditNotes] = useState("");
  const [corrections, setCorrections] = useState<Record<string, string>>({});
  const [editMode, setEditMode] = useState<"none" | "delete" | "correct">("none");

  // Load linked check failures.
  const { data: checkFailures = [], isLoading: failuresLoading } = useQuery<
    CheckFailure[]
  >({
    queryKey: ["check-failures", run_id],
    queryFn: () => fetchRunCheckFailures(dqEngineSql, run_id),
    staleTime: 60_000,
  });

  const upsertTriage = useUpsertTriage(run_id);
  const createEditMutation = useCreateEdit(run_id);

  // Data columns only (sorted), metadata pinned separately.
  const dataColumns = Object.keys(row)
    .filter((k) => !METADATA_COLUMNS.has(k))
    .sort();

  // --------------------------------------------------------------------------
  // Handlers
  // --------------------------------------------------------------------------

  function handleTriage(decision: TriageDecision) {
    upsertTriage.mutate({
      existing: existingTriage,
      dataset,
      row_hash: rowHash,
      decision,
      notes: triageNotes || undefined,
    });
  }

  function handleFlagDelete() {
    createEditMutation.mutate({
      dataset,
      row_hash: rowHash,
      action: EditAction.Delete,
      corrections: null,
      notes: editNotes || undefined,
    });
    setEditMode("none");
    setEditNotes("");
  }

  function handleCorrect() {
    const correctionPayload: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(corrections)) {
      if (v !== "") correctionPayload[k] = v;
    }
    if (Object.keys(correctionPayload).length === 0) return;
    createEditMutation.mutate({
      dataset,
      row_hash: rowHash,
      action: EditAction.Correct,
      corrections: correctionPayload,
      notes: editNotes || undefined,
    });
    setEditMode("none");
    setCorrections({});
    setEditNotes("");
  }

  // --------------------------------------------------------------------------
  // Render
  // --------------------------------------------------------------------------

  return (
    <div className="h-full flex flex-col bg-white border-l border-gray-200 w-[480px] min-w-[360px] shadow-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-semibold text-gray-800 text-sm truncate">
          Row detail
          <span className="ml-2 font-mono text-xs text-gray-400">
            {rowHash.slice(0, 12)}…
          </span>
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-gray-400 hover:text-gray-700 text-xl leading-none"
          aria-label="Close panel"
        >
          ×
        </button>
      </div>

      <div className="flex-1 overflow-y-auto space-y-6 p-5">
        {/* ── Row data ── */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Row Data
          </h4>
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {dataColumns.map((col) => (
              <Cell key={col} label={col} value={row[col]} />
            ))}
          </dl>
          <details className="mt-2">
            <summary className="text-xs text-gray-400 cursor-pointer">
              Metadata columns
            </summary>
            <dl className="mt-2 grid grid-cols-1 gap-2">
              {Array.from(METADATA_COLUMNS)
                .filter((m) => m in row)
                .map((m) => (
                  <Cell key={m} label={m} value={row[m]} />
                ))}
            </dl>
          </details>
        </section>

        {/* ── Check failures ── */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Check Failures (run)
          </h4>
          {failuresLoading ? (
            <p className="text-sm text-gray-400">Loading…</p>
          ) : checkFailures.length === 0 ? (
            <p className="text-sm text-gray-400 italic">
              No check failures found for this run.
            </p>
          ) : (
            <ul className="space-y-2">
              {checkFailures.map((f, i) => (
                <li
                  key={i}
                  className={`text-xs rounded-md px-3 py-2 ${
                    f.level === "fail"
                      ? "bg-red-50 text-red-700"
                      : "bg-yellow-50 text-yellow-700"
                  }`}
                >
                  <span className="font-medium">
                    {f.check_name ?? f.check_type}
                  </span>
                  {f.column_name && (
                    <span className="ml-1 text-opacity-70">
                      on <code>{f.column_name}</code>
                    </span>
                  )}
                  {f.unexpected_count != null && (
                    <span className="ml-2 opacity-70">
                      ({f.unexpected_count} rows
                      {f.unexpected_percent != null
                        ? ` · ${f.unexpected_percent.toFixed(1)}%`
                        : ""}
                      )
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ── Triage section ── */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Triage Decision
          </h4>
          {existingTriage && (
            <p className="text-xs text-gray-500 mb-2">
              Current:{" "}
              <span className="font-medium text-gray-800">
                {existingTriage.decision}
              </span>{" "}
              by {existingTriage.decided_by}
            </p>
          )}
          <div className="flex gap-2 mb-3">
            <button
              type="button"
              onClick={() => handleTriage(TriageDecision.Approved)}
              disabled={upsertTriage.isPending}
              className="flex-1 rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => handleTriage(TriageDecision.Rejected)}
              disabled={upsertTriage.isPending}
              className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
            >
              Reject
            </button>
            <button
              type="button"
              onClick={() => handleTriage(TriageDecision.Escalated)}
              disabled={upsertTriage.isPending}
              className="flex-1 rounded-md bg-yellow-500 px-3 py-2 text-sm font-medium text-white hover:bg-yellow-600 disabled:opacity-50 transition-colors"
            >
              Escalate
            </button>
          </div>
          <textarea
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
            rows={2}
            placeholder="Optional notes for this decision…"
            value={triageNotes}
            onChange={(e) => setTriageNotes(e.target.value)}
          />
          {upsertTriage.isError && (
            <p className="mt-1 text-xs text-red-600">
              Failed to save: {String(upsertTriage.error)}
            </p>
          )}
          {upsertTriage.isSuccess && (
            <p className="mt-1 text-xs text-green-600">Saved.</p>
          )}
        </section>

        {/* ── Edit section ── */}
        <section>
          <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            Data Edit
          </h4>

          {/* Existing edits summary */}
          {existingEdits.length > 0 && (
            <ul className="mb-3 space-y-1">
              {existingEdits.map((e) => (
                <li
                  key={e.id}
                  className="text-xs rounded bg-gray-50 px-3 py-1.5 flex justify-between"
                >
                  <span className="font-medium">{e.action}</span>
                  <span className="text-gray-500">{e.status}</span>
                </li>
              ))}
            </ul>
          )}

          {editMode === "none" && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditMode("delete")}
                className="flex-1 rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 transition-colors"
              >
                Flag for deletion
              </button>
              <button
                type="button"
                onClick={() => {
                  setCorrections(
                    Object.fromEntries(dataColumns.map((k) => [k, String(row[k] ?? "")])),
                  );
                  setEditMode("correct");
                }}
                className="flex-1 rounded-md border border-blue-300 px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50 transition-colors"
              >
                Correct values
              </button>
            </div>
          )}

          {editMode === "delete" && (
            <div className="space-y-3">
              <p className="text-sm text-gray-700">
                Flag this row for deletion. The apply-notebook will remove it
                from the Delta table when it processes pending edits.
              </p>
              <textarea
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-400"
                rows={2}
                placeholder="Reason (optional)…"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleFlagDelete}
                  disabled={createEditMutation.isPending}
                  className="flex-1 rounded-md bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                >
                  Confirm deletion flag
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode("none")}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {editMode === "correct" && (
            <div className="space-y-3">
              <p className="text-xs text-gray-500">
                Edit fields below. Leave a field unchanged to exclude it from
                the correction payload.
              </p>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {dataColumns.map((col) => (
                  <div key={col} className="flex flex-col gap-0.5">
                    <label className="text-xs font-medium text-gray-500">
                      {col}
                    </label>
                    <input
                      type="text"
                      value={corrections[col] ?? ""}
                      onChange={(e) =>
                        setCorrections((c) => ({ ...c, [col]: e.target.value }))
                      }
                      className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                    />
                  </div>
                ))}
              </div>
              <textarea
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-400"
                rows={2}
                placeholder="Notes (optional)…"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCorrect}
                  disabled={createEditMutation.isPending}
                  className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  Save corrections
                </button>
                <button
                  type="button"
                  onClick={() => setEditMode("none")}
                  className="rounded-md border border-gray-300 px-3 py-2 text-sm hover:bg-gray-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {createEditMutation.isError && (
            <p className="mt-1 text-xs text-red-600">
              Failed: {String(createEditMutation.error)}
            </p>
          )}
          {createEditMutation.isSuccess && (
            <p className="mt-1 text-xs text-green-600">Edit staged.</p>
          )}
        </section>
      </div>
    </div>
  );
}
