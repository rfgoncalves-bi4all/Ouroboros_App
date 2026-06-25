/**
 * useFabricAuth.ts
 *
 * Wraps the runtime-injected @rayfin/sdk useAuth() hook and exposes a
 * stable, typed interface for authentication state within the app.
 *
 * The @rayfin/sdk is injected by the Fabric runtime at deploy time and is
 * not bundled (see vite.config.ts external). When running locally the SDK
 * is provided by the Rayfin dev server via RayfinProvider.
 *
 * Auth lifecycle:
 *   1. RayfinProvider (main.tsx) initialises the session on mount.
 *      Inside the Fabric portal the SDK uses embedded-mode postMessage
 *      to acquire the token silently. Outside Fabric it may prompt sign-in.
 *   2. While the session is being acquired, accessToken is an empty string
 *      and isAuthenticated is false.
 *   3. Once the session is ready, accessToken is populated and the app
 *      renders normally.
 *
 * NOTE: Full initEmbeddedAuth / ensureSignedInWithFabric support (including
 * an explicit sign-in button for popup flow) requires migrating to the
 * @microsoft/rayfin-auth-provider-fabric package (SDK migration, Group 5).
 */
import { useAuth } from "@rayfin/sdk";

// The runtime SDK may expose more fields than the type stubs declare.
// We read only the subset the app needs.
type RuntimeAuthResult = {
  accessToken: string;
  userId?: string;
  isLoading?: boolean;
};

export interface FabricAuthState {
  /** True when a valid session token is present. */
  isAuthenticated: boolean;
  /**
   * True while the SDK is initialising the session.
   * Derived from the absence of a token before the first render cycle
   * where the token is expected to be populated.
   */
  isLoading: boolean;
  /** Bearer token forwarded to Fabric SQL and Rayfin GraphQL calls. */
  accessToken: string;
  /** User identifier from the Rayfin session (may be undefined during init). */
  userId: string | undefined;
}

export function useFabricAuth(): FabricAuthState {
  const auth = useAuth() as RuntimeAuthResult;

  const accessToken = auth.accessToken ?? "";
  // Treat an empty token as "loading" when the SDK hasn't resolved yet.
  const isLoading = auth.isLoading ?? accessToken === "";
  const isAuthenticated = accessToken !== "";

  return {
    isAuthenticated,
    isLoading,
    accessToken,
    userId: auth.userId,
  };
}
