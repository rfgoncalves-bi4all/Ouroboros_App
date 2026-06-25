/**
 * ContractViewer.tsx
 *
 * Priority 3 — Read-only YAML contract file viewer.
 *
 * Lists contract files from the Fabric Lakehouse Files API
 * (Files/contracts/ path in the project Lakehouse) and renders the
 * selected file with syntax highlighting.
 *
 * Authentication: user passthrough Bearer token — no additional setup.
 * The Fabric REST API endpoint for file listing is:
 *   GET https://api.fabric.microsoft.com/v1/workspaces/{workspaceId}/lakehouses/{lakehouseId}/files?path=contracts
 * File content is fetched via OneLake ABFS/HTTP using the same token.
 *
 * NOTE: If the Fabric Files REST API is not available in your environment,
 * contracts can alternatively be surfaced via the SQL endpoint by registering
 * them as external tables — see the README for details.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@rayfin/sdk";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";

// ---------------------------------------------------------------------------
// Fabric Files API helpers
// ---------------------------------------------------------------------------

interface FabricFileItem {
  name: string;
  path: string;
  type: "File" | "Folder";
}

async function listContractFiles(bearerToken: string): Promise<FabricFileItem[]> {
  const workspaceId = import.meta.env.VITE_CONTRACT_WORKSPACE_ID ?? "";
  const lakehouseId = import.meta.env.VITE_CONTRACT_LAKEHOUSE_ID ?? "";

  if (!workspaceId || !lakehouseId) {
    throw new Error(
      "VITE_CONTRACT_WORKSPACE_ID and VITE_CONTRACT_LAKEHOUSE_ID must be set to use the contract viewer.",
    );
  }

  const url = `https://api.fabric.microsoft.com/v1/workspaces/${encodeURIComponent(workspaceId)}/lakehouses/${encodeURIComponent(lakehouseId)}/files?path=contracts`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Failed to list contract files: ${resp.status} ${resp.statusText}`);
  }
  const data: { value?: FabricFileItem[] } = await resp.json();
  return (data.value ?? []).filter(
    (f) => f.type === "File" && f.name.endsWith(".yaml"),
  );
}

async function fetchContractContent(
  bearerToken: string,
  filePath: string,
): Promise<string> {
  const workspaceId = import.meta.env.VITE_CONTRACT_WORKSPACE_ID ?? "";
  const lakehouseId = import.meta.env.VITE_CONTRACT_LAKEHOUSE_ID ?? "";

  const url = `https://api.fabric.microsoft.com/v1/workspaces/${encodeURIComponent(workspaceId)}/lakehouses/${encodeURIComponent(lakehouseId)}/files/${encodeURIComponent(filePath)}`;

  const resp = await fetch(url, {
    headers: { Authorization: `Bearer ${bearerToken}` },
  });
  if (!resp.ok) {
    throw new Error(`Failed to load contract: ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContractViewer() {
  const { accessToken } = useAuth();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const {
    data: files = [],
    isLoading: filesLoading,
    error: filesError,
  } = useQuery({
    queryKey: ["contract-files"],
    queryFn: () => listContractFiles(accessToken),
    staleTime: 120_000,
  });

  const {
    data: content,
    isLoading: contentLoading,
    error: contentError,
  } = useQuery({
    queryKey: ["contract-content", selectedPath],
    queryFn: () => fetchContractContent(accessToken, selectedPath!),
    enabled: !!selectedPath,
    staleTime: 300_000,
  });

  return (
    <div className="flex h-full gap-4">
      {/* File list */}
      <aside className="w-56 flex-shrink-0">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Contract Files
        </h2>
        {filesLoading && (
          <p className="text-sm text-gray-400">Loading contracts…</p>
        )}
        {filesError && (
          <p className="text-xs text-red-600">
            {filesError instanceof Error ? filesError.message : String(filesError)}
          </p>
        )}
        {!filesLoading && files.length === 0 && !filesError && (
          <p className="text-xs text-gray-400 italic">
            No contract files found. Check environment variables
            VITE_CONTRACT_WORKSPACE_ID and VITE_CONTRACT_LAKEHOUSE_ID.
          </p>
        )}
        <ul className="space-y-1">
          {files.map((f) => (
            <li key={f.path}>
              <button
                type="button"
                onClick={() => setSelectedPath(f.path)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  selectedPath === f.path
                    ? "bg-blue-100 text-blue-800 font-medium"
                    : "text-gray-700 hover:bg-gray-100"
                }`}
              >
                {f.name}
              </button>
            </li>
          ))}
        </ul>
      </aside>

      {/* Content pane */}
      <div className="flex-1 min-w-0 overflow-hidden rounded-lg border border-gray-200 bg-white">
        {!selectedPath ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Select a contract file to view it.
          </div>
        ) : contentLoading ? (
          <div className="flex items-center justify-center h-full text-gray-400 text-sm">
            Loading…
          </div>
        ) : contentError ? (
          <div className="p-4 text-sm text-red-600">
            Failed to load:{" "}
            {contentError instanceof Error
              ? contentError.message
              : String(contentError)}
          </div>
        ) : (
          <div className="h-full overflow-auto">
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50">
              <span className="text-xs font-mono text-gray-500">
                {selectedPath}
              </span>
              <span className="text-xs text-gray-400 italic">read-only</span>
            </div>
            <SyntaxHighlighter
              language="yaml"
              style={oneLight}
              customStyle={{
                margin: 0,
                borderRadius: 0,
                fontSize: "0.8rem",
                background: "transparent",
              }}
              showLineNumbers
            >
              {content ?? ""}
            </SyntaxHighlighter>
          </div>
        )}
      </div>
    </div>
  );
}
