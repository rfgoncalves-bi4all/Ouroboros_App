/**
 * DQResultsDashboard.tsx
 *
 * Priority 2 — Top-level DQ health dashboard.
 * Composes the summary cards, pass-rate table, and failed-checks list.
 */
import { useQuery } from "@tanstack/react-query";
import { getDQSummary } from "../services/resultsService";
import { useFabricClients } from "../hooks/useFabricClients";
import { DatasetPassRate } from "./DatasetPassRate";
import { CheckFailureList } from "./CheckFailureList";

function SummaryCard({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-5 py-4 shadow-sm">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className={`mt-1 text-3xl font-bold ${accent ?? "text-gray-900"}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-gray-400">{sub}</p>}
    </div>
  );
}

export function DQResultsDashboard() {
  const { dqEngineSql } = useFabricClients();

  const { data: summary, isLoading } = useQuery({
    queryKey: ["dq-summary"],
    queryFn: () => getDQSummary(dqEngineSql),
    staleTime: 120_000,
  });

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-800">DQ Results Overview</h2>

      {/* Summary cards */}
      {isLoading ? (
        <div className="grid grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard
            label="Total Runs"
            value={summary?.total_runs ?? 0}
          />
          <SummaryCard
            label="Overall Pass Rate"
            value={`${summary?.overall_pass_rate ?? 0}%`}
            accent={
              (summary?.overall_pass_rate ?? 0) >= 95
                ? "text-green-600"
                : (summary?.overall_pass_rate ?? 0) >= 80
                ? "text-yellow-600"
                : "text-red-600"
            }
          />
          <SummaryCard
            label="Datasets with Failures"
            value={summary?.datasets_with_failures ?? 0}
            accent={
              (summary?.datasets_with_failures ?? 0) === 0
                ? "text-green-600"
                : "text-red-600"
            }
          />
        </div>
      )}

      {/* Pass rate per dataset */}
      <DatasetPassRate />

      {/* Failed checks list */}
      <CheckFailureList />
    </div>
  );
}
