/**
 * useFabricClients.ts
 *
 * Builds the FabricSqlClient instances and the Rayfin GraphQLClient from
 * the Rayfin auth context. All clients use user-passthrough Bearer tokens.
 */
import { useMemo } from "react";
import { useAuth } from "@rayfin/sdk";
import { GraphQLClient } from "graphql-request";
import { FabricSqlClient } from "../services/fabricSqlClient";
import { createRayfinClient } from "../services/rayfinClient";

export interface FabricClients {
  /** SQL client for the project Lakehouse (dq_quarantined, dq_flagged). */
  projectSql: FabricSqlClient;
  /** SQL client for the DQ engine Lakehouse (dbo.dq_results). */
  dqEngineSql: FabricSqlClient;
  /** GraphQL client for Rayfin-managed entities. */
  rayfin: GraphQLClient;
}

export function useFabricClients(): FabricClients {
  const { accessToken } = useAuth();

  return useMemo(() => {
    const projectEndpoint = import.meta.env.VITE_FABRIC_SQL_ENDPOINT_URL ?? "";
    const dqEngineEndpoint =
      import.meta.env.VITE_DQ_ENGINE_SQL_ENDPOINT_URL ?? projectEndpoint;

    return {
      projectSql: new FabricSqlClient({
        endpointUrl: projectEndpoint,
        bearerToken: accessToken,
      }),
      dqEngineSql: new FabricSqlClient({
        endpointUrl: dqEngineEndpoint,
        bearerToken: accessToken,
      }),
      rayfin: createRayfinClient(accessToken),
    };
  }, [accessToken]);
}
