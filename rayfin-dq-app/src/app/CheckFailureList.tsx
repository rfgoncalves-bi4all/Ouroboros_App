/**
 * CheckFailureList.tsx
 *
 * Priority 2 — Filterable list of failed checks from dq_results.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getFailedChecks, listDatasets } from "../services/resultsService";
import { useFabricClients } from "../hooks/useFabricClients";

const PAGE_SIZE = 100;

export function CheckFailureList() {
  const { dqEngineSql } = useFabricClients();
  const [dataset, setDataset] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data: datasets = [] } = useQuery({
    queryKey: ["datasets-list"],
    queryFn: () => listDatasets(dqEngineSql),
    staleTime: 120_000,
  });

  const { data: checks = [], isLoading } = useQuery({
    queryKey: ["failed-checks", dataset, dateFrom, dateTo],
    queryFn: () =>
      getFailedChecks(dqEngineSql, {
        dataset: dataset || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        limit: PAGE_SIZE,
      }),
    staleTime: 30_000,
  });

  return (
    <div className="space-y-3">
      <h3 className="font-medium text-gray-700 text-sm">Failed Checks</h3>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 bg-gray-50 rounded-lg p-3 text-sm">
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">Dataset</label>
          <select
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={dataset}
            onChange={(e) => setDataset(e.target.value)}
          >
            <option value="">All datasets</option>
            {datasets.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-gray-600 font-medium">From</label>
          <input
            type="date"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <label className="text-gray-600 font-medium">To</label>
          <input
            type="date"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 rounded-lg bg-gray-50 animate-pulse" />
      ) : checks.length === 0 ? (
        <p className="text-sm text-gray-400 italic">
          No failed checks found for the selected filters.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm divide-y divide-gray-200 bg-white">
            <thead className="bg-gray-50">
              <tr>
                {[
                  "Timestamp",
                  "Dataset",
                  "Check",
                  "Column",
                  "Level",
                  "Observed",
                  "Unexpected",
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {checks.map((c, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-3 py-2 text-xs font-mono text-gray-500 whitespace-nowrap">
                    {c.run_timestamp.slice(0, 16).replace("T", " ")}
                  </td>
                  <td className="px-3 py-2 text-gray-800 whitespace-nowrap">
                    {c.data_lakehouse_name ? `${c.data_lakehouse_name}/` : ""}
                    {c.dataset}
                  </td>
                  <td className="px-3 py-2 text-gray-800">
                    {c.check_name ?? (
                      <span className="font-mono text-xs text-gray-500">
                        {c.check_type}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-500">
                    {c.column_name ?? <span className="text-gray-300">—</span>}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                        c.level === "fail"
                          ? "bg-red-100 text-red-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {c.level}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-600 font-mono text-xs">
                    {c.observed_value ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-gray-600 text-xs">
                    {c.unexpected_count != null ? (
                      <>
                        {c.unexpected_count}
                        {c.unexpected_percent != null &&
                          ` (${c.unexpected_percent.toFixed(1)}%)`}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {checks.length >= PAGE_SIZE && (
            <p className="text-xs text-gray-400 text-center py-2">
              Showing first {PAGE_SIZE} results — refine filters to narrow down.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
