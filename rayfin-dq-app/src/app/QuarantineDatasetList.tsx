/**
 * QuarantineDatasetList.tsx
 *
 * Priority 1 — Lists all available dq_quarantined/* tables.
 * The user selects a dataset to open the QuarantineRowTable for it.
 */
import { useQuery } from "@tanstack/react-query";
import { listQuarantinedTables } from "../services/quarantineService";
import { useFabricClients } from "../hooks/useFabricClients";
import type { QuarantineTableInfo } from "../services/quarantineService";

interface Props {
  onSelect: (table: QuarantineTableInfo) => void;
}

export function QuarantineDatasetList({ onSelect }: Props) {
  const { projectSql } = useFabricClients();

  const { data: tables, isLoading, error } = useQuery({
    queryKey: ["quarantine-tables"],
    queryFn: () => listQuarantinedTables(projectSql),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48 text-gray-500">
        Loading quarantined datasets…
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-md bg-red-50 p-4 text-red-700 text-sm">
        Failed to load quarantined tables:{" "}
        {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }

  if (!tables || tables.length === 0) {
    return (
      <div className="rounded-md bg-gray-50 p-8 text-center text-gray-500 text-sm">
        No quarantined datasets found. Run the ouroboros-gx suite with
        quarantine remediation to populate this list.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h2 className="text-lg font-semibold text-gray-800 mb-4">
        Quarantined Datasets
      </h2>
      <ul className="divide-y divide-gray-200 rounded-lg border border-gray-200 bg-white overflow-hidden">
        {tables.map((table) => (
          <li key={table.qualifiedName}>
            <button
              type="button"
              onClick={() => onSelect(table)}
              className="w-full text-left px-5 py-4 hover:bg-blue-50 transition-colors group"
            >
              <span className="font-medium text-gray-900 group-hover:text-blue-700">
                {table.tableName}
              </span>
              <span className="ml-3 text-xs text-gray-400 font-mono">
                {table.qualifiedName}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
