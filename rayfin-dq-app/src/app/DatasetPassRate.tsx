/**
 * DatasetPassRate.tsx
 *
 * Priority 2 — Pass rate per dataset, sortable, with trend indicator.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPassRateByDataset } from "../services/resultsService";
import { useFabricClients } from "../hooks/useFabricClients";
import type { DatasetPassRate as DatasetPassRateRow } from "../services/resultsService";

type SortKey = "dataset" | "pass_rate" | "total_checks" | "latest_run";
type SortDir = "asc" | "desc";

function PassRateBar({ pct }: { pct: number }) {
  const color =
    pct >= 95 ? "bg-green-500" : pct >= 80 ? "bg-yellow-400" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className={`text-sm font-medium ${
          pct >= 95
            ? "text-green-700"
            : pct >= 80
            ? "text-yellow-700"
            : "text-red-700"
        }`}
      >
        {pct.toFixed(1)}%
      </span>
    </div>
  );
}

export function DatasetPassRate() {
  const { dqEngineSql } = useFabricClients();
  const [sortKey, setSortKey] = useState<SortKey>("pass_rate");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [dateFrom, setDateFrom] = useState("");

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["pass-rate", dateFrom],
    queryFn: () => getPassRateByDataset(dqEngineSql, dateFrom || undefined),
    staleTime: 60_000,
  });

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  const sorted = [...rows].sort((a, b) => {
    const va = a[sortKey] ?? "";
    const vb = b[sortKey] ?? "";
    const cmp = va < vb ? -1 : va > vb ? 1 : 0;
    return sortDir === "asc" ? cmp : -cmp;
  });

  function SortHeader({
    col,
    label,
  }: {
    col: SortKey;
    label: string;
  }) {
    return (
      <th
        className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer select-none hover:text-gray-800"
        onClick={() => handleSort(col)}
      >
        {label}
        {sortKey === col && (
          <span className="ml-1">{sortDir === "asc" ? "↑" : "↓"}</span>
        )}
      </th>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-gray-700 text-sm">Pass Rate by Dataset</h3>
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500">Since</label>
          <input
            type="date"
            className="border border-gray-300 rounded px-2 py-1 text-sm"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="h-32 rounded-lg bg-gray-50 animate-pulse" />
      ) : rows.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No data found.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm divide-y divide-gray-200 bg-white">
            <thead className="bg-gray-50">
              <tr>
                <SortHeader col="dataset" label="Dataset" />
                <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Lakehouse
                </th>
                <SortHeader col="pass_rate" label="Pass Rate" />
                <SortHeader col="total_checks" label="Total Checks" />
                <SortHeader col="latest_run" label="Latest Run" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {(sorted as DatasetPassRateRow[]).map((r) => (
                <tr key={`${r.data_lakehouse_name}.${r.dataset}`} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {r.dataset}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                    {r.data_lakehouse_name ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <PassRateBar pct={r.pass_rate} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {r.passed_checks}/{r.total_checks}
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs font-mono">
                    {r.latest_run ? r.latest_run.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
