/**
 * useFabricClients.ts
 *
 * Builds FabricSqlClient instances for the Fabric SQL Analytics Endpoints.
 * Bearer tokens are sourced from the Rayfin auth session via getSessionAccessToken().
 * Clients are re-created whenever the authentication state changes.
 */
import { useMemo } from "react";
import { useFabricAuth } from "./useFabricAuth";
import { FabricSqlClient } from "../services/fabricSqlClient";
import { getSessionAccessToken } from "../lib/rayfin";

export interface FabricClients {
  /** SQL client for the project Lakehouse (dq_quarantined, dq_flagged). */
  projectSql: FabricSqlClient;
  /** SQL client for the DQ engine Lakehouse (dbo.dq_results). */
  dqEngineSql: FabricSqlClient;
}

export function useFabricClients(): FabricClients {
  const { isAuthenticated } = useFabricAuth();

  return useMemo(() => {
    const token = getSessionAccessToken();
    const projectEndpoint = import.meta.env.VITE_FABRIC_SQL_ENDPOINT_URL ?? "";
    const dqEngineEndpoint =
      import.meta.env.VITE_DQ_ENGINE_SQL_ENDPOINT_URL ?? projectEndpoint;

    return {
      projectSql: new FabricSqlClient({
        endpointUrl: projectEndpoint,
        bearerToken: token,
      }),
      dqEngineSql: new FabricSqlClient({
        endpointUrl: dqEngineEndpoint,
        bearerToken: token,
      }),
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);
}
