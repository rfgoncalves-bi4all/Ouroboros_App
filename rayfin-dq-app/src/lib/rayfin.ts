/**
 * rayfin.ts
 *
 * Singleton RayfinClient for the app. Import `client` to access the typed
 * data API and the auth service. Import the helper functions to read auth
 * state without subscribing to re-renders.
 */
import { RayfinClient } from "@microsoft/rayfin-client";

/**
 * Schema mapping entity names to their field types.
 * Defined inline to avoid cross-tsconfig-boundary imports from
 * rayfin/data/ (which uses Stage 3 decorators incompatible with
 * the app's experimentalDecorators: true setting).
 */
type AppSchema = {
  QuarantineTriage: {
    id: string;
    dataset: string;
    run_id: string;
    row_hash: string;
    decision: "approved" | "rejected" | "escalated";
    decided_by: string;
    decided_at: Date;
    notes?: string;
  };
  QuarantineEdit: {
    id: string;
    dataset: string;
    run_id: string;
    row_hash: string;
    action: "delete" | "correct";
    corrections?: string;
    status: "pending" | "applied" | "rejected";
    edited_by: string;
    edited_at: Date;
    notes?: string;
  };
};

export const client = new RayfinClient<AppSchema>({
  baseUrl: import.meta.env.VITE_RAYFIN_API_URL ?? "",
  publishableKey: import.meta.env.VITE_RAYFIN_PUBLISHABLE_KEY ?? "",
});

/**
 * Returns the current session's bearer token for use with external APIs
 * (e.g., FabricSqlClient).
 *
 * WORKAROUND: OpaqueSession does not expose the access token via the public
 * SDK API. This accesses the internal `accessToken` field on the Auth instance.
 * TODO: Replace with a public accessor when the SDK exposes one.
 */
export function getSessionAccessToken(): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((client.auth as any).accessToken as string | undefined) ?? "";
}

/**
 * Returns the current user's ID from the active session, or an empty string
 * if no session is present. Used to populate `decided_by` / `edited_by` fields.
 */
export function getSessionUserId(): string {
  return client.auth.getSession()?.user?.id ?? "";
}
