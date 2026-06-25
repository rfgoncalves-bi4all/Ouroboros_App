/**
 * useFabricAuth.ts
 *
 * React hook that manages Fabric SSO authentication using the
 * @microsoft/rayfin-auth-provider-fabric package.
 *
 * Auth lifecycle:
 *   1. On mount, calls initEmbeddedAuth() which attempts a silent sign-in via
 *      the Fabric portal's postMessage bridge (embedded / iframe mode).
 *      Inside the Fabric portal this succeeds silently; outside it resolves
 *      null and the app shows a sign-in prompt.
 *   2. session state is kept in sync via client.auth.onSessionChange().
 *   3. signIn() calls ensureSignedInWithFabric() which opens the Fabric portal
 *      OAuth popup flow when needed.
 *   4. signOut() delegates to client.auth.signOut().
 */
import { useState, useEffect, useCallback } from "react";
import type { OpaqueSession } from "@microsoft/rayfin-auth";
import {
  initEmbeddedAuth,
  ensureSignedInWithFabric,
  type FabricAuthOptions,
} from "@microsoft/rayfin-auth-provider-fabric";
import { client } from "../lib/rayfin";

function buildFabricOptions(): FabricAuthOptions {
  return {
    workspaceId: import.meta.env.VITE_FABRIC_WORKSPACE_ID ?? "",
    projectId: import.meta.env.VITE_FABRIC_ITEM_ID ?? "",
    fabricPortalUrl:
      import.meta.env.VITE_FABRIC_PORTAL_URL ??
      "https://app.fabric.microsoft.com",
    returnOrigin: window.location.origin,
  };
}

export interface FabricAuthState {
  /** True when a valid session is present. */
  isAuthenticated: boolean;
  /** True while the initial auth check is in progress. */
  isLoading: boolean;
  /** Current user ID, or undefined when not signed in. */
  userId: string | undefined;
  /** Current user email, or undefined when not signed in. */
  email: string | undefined;
  /** Trigger the Fabric OAuth popup flow to sign in. */
  signIn: () => void;
  /** Sign out and clear the session. */
  signOut: () => void;
}

export function useFabricAuth(): FabricAuthState {
  const [session, setSession] = useState<OpaqueSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const options = buildFabricOptions();
    const unsubscribe = client.auth.onSessionChange(setSession);

    initEmbeddedAuth(client.auth, options)
      .then((s) => {
        if (s) setSession(s);
      })
      .catch(() => {
        // Silent init failure is expected outside the Fabric portal.
      })
      .finally(() => setIsLoading(false));

    return unsubscribe;
  }, []);

  const signIn = useCallback(() => {
    const options = buildFabricOptions();
    void ensureSignedInWithFabric(client.auth, options).then(setSession);
  }, []);

  const signOut = useCallback(() => {
    void client.auth.signOut();
  }, []);

  return {
    isAuthenticated: session?.isAuthenticated ?? false,
    isLoading,
    userId: session?.user?.id ?? undefined,
    email: session?.user?.email ?? undefined,
    signIn,
    signOut,
  };
}

