/**
 * App.tsx
 *
 * Root application component.
 * Provides:
 *   - React Query client
 *   - Tab-based navigation: Triage | Dashboard | Contracts
 *   - Quarantine triage state (selected dataset + selected row + side panel)
 */
import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuarantineDatasetList } from "./app/QuarantineDatasetList";
import { QuarantineRowTable } from "./app/QuarantineRowTable";
import { TriagePanel } from "./app/TriagePanel";
import { DQResultsDashboard } from "./app/DQResultsDashboard";
import { ContractViewer } from "./app/ContractViewer";
import { useTriageByRunId, useEditsByRunId } from "./hooks/useQuarantineState";
import { useFabricAuth } from "./hooks/useFabricAuth";
import type { QuarantineTableInfo } from "./services/quarantineService";

// ---------------------------------------------------------------------------
// QueryClient
// ---------------------------------------------------------------------------

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

type Tab = "triage" | "dashboard" | "contracts";

const TABS: { id: Tab; label: string }[] = [
  { id: "triage", label: "Quarantine Triage" },
  { id: "dashboard", label: "DQ Results" },
  { id: "contracts", label: "Contracts" },
];

// ---------------------------------------------------------------------------
// Triage view (inner component so it can use hooks that need the client)
// ---------------------------------------------------------------------------

function TriageView() {
  const [selectedTable, setSelectedTable] = useState<QuarantineTableInfo | null>(null);
  const [selectedRow, setSelectedRow] = useState<{
    row: Record<string, unknown>;
    hash: string;
  } | null>(null);

  const activeRunId = selectedRow
    ? (selectedRow.row["run_id"] as string | undefined)
    : undefined;

  const triageQuery = useTriageByRunId(activeRunId);
  const editsQuery = useEditsByRunId(activeRunId);

  function handleRowSelect(row: Record<string, unknown>, hash: string) {
    setSelectedRow({ row, hash });
  }

  function handleClosePanel() {
    setSelectedRow(null);
  }

  if (!selectedTable) {
    return <QuarantineDatasetList onSelect={setSelectedTable} />;
  }

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* Main table area */}
      <div className="flex-1 min-w-0 overflow-auto">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 mb-4 text-sm">
          <button
            type="button"
            className="text-blue-600 hover:underline"
            onClick={() => { setSelectedTable(null); setSelectedRow(null); }}
          >
            Quarantined Datasets
          </button>
          <span className="text-gray-400">/</span>
          <span className="font-medium text-gray-800">{selectedTable.tableName}</span>
        </div>
        <QuarantineRowTable
          table={selectedTable}
          onRowSelect={handleRowSelect}
        />
      </div>

      {/* Side panel */}
      {selectedRow && (
        <TriagePanel
          row={selectedRow.row}
          rowHash={selectedRow.hash}
          dataset={String(selectedRow.row["dataset"] ?? selectedTable.tableName)}
          run_id={String(selectedRow.row["run_id"] ?? "")}
          existingTriage={triageQuery.data?.get(selectedRow.hash)}
          existingEdits={editsQuery.data?.get(selectedRow.hash) ?? []}
          onClose={handleClosePanel}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

function AuthGuard({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading, signIn } = useFabricAuth();

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-3" />
          <p className="text-sm text-gray-500">Connecting to Fabric...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-100">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-8 max-w-sm w-full text-center">
          <h1 className="font-semibold text-gray-900 text-lg mb-1">Data Quality Triage</h1>
          <p className="text-sm text-gray-500 mb-6">
            Open this app from the Microsoft Fabric portal to sign in automatically,
            or start the Rayfin dev server locally.
          </p>
          <button
            type="button"
            onClick={signIn}
            className="w-full rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 transition-colors mb-4"
          >
            Sign in with Microsoft Fabric
          </button>
          <p className="text-xs text-gray-400">
            If you are already signed in and see this screen, the Fabric session
            may have expired. Reload the page to retry.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

function AppInner() {
  const [tab, setTab] = useState<Tab>("triage");

  return (
    <div className="flex flex-col h-screen bg-gray-100">
      {/* Top nav */}
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6 flex-shrink-0">
        <h1 className="font-bold text-gray-900 text-base">
          Data Quality Triage
          <span className="ml-2 text-xs font-normal text-gray-400">
            ouroboros-gx
          </span>
        </h1>
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                tab === t.id
                  ? "bg-blue-600 text-white"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Content */}
      <main className="flex-1 min-h-0 overflow-auto p-6">
        {tab === "triage" && <TriageView />}
        {tab === "dashboard" && <DQResultsDashboard />}
        {tab === "contracts" && (
          <div className="h-full">
            <ContractViewer />
          </div>
        )}
      </main>
    </div>
  );
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthGuard>
        <AppInner />
      </AuthGuard>
    </QueryClientProvider>
  );
}
