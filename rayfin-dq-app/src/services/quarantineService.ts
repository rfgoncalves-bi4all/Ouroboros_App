/**
 * quarantineService.ts
 *
 * Read-only queries against the project Lakehouse SQL Analytics Endpoint.
 *
 * Tables accessed (all read-only via SQL endpoint):
 *   dq_quarantined.<dataset_table>  — quarantined rows per dataset
 *   dbo.dq_results                  — per-check results for run context
 *
 * Schema facts (confirmed from ouroboros-gx result_persister.py):
 *
 *   dq_quarantined.<table> columns:
 *     - All original dataset columns (dynamic — unknown ahead of time)
 *     - run_id        (string)  — UUID matching dq_results.run_id
 *     - run_timestamp (string)  — ISO 8601 UTC
 *     - dataset       (string)  — full FQN (e.g. "silver/dim_customer")
 *
 *   dq_results columns (used here for run context / linking):
 *     run_id, check_name, check_type, column_name,
 *     success, level, observed_value, unexpected_count, unexpected_percent
 */
import {
  FabricSqlClient,
  escapeIdentifier,
  escapeString,
} from "./fabricSqlClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface QuarantineTableInfo {
  /** Table name as it appears in the schema (e.g. "silver_dim_customer"). */
  tableName: string;
  /** Full SQL-qualified name (e.g. "dq_quarantined.silver_dim_customer"). */
  qualifiedName: string;
}

export interface FetchQuarantineRowsOptions {
  run_id?: string;
  /** ISO 8601 lower bound for run_timestamp (inclusive). */
  from?: string;
  /** ISO 8601 upper bound for run_timestamp (inclusive). */
  to?: string;
  limit?: number;
  offset?: number;
}

export interface CheckFailure {
  check_name: string | null;
  check_type: string;
  column_name: string | null;
  success: boolean;
  level: string;
  observed_value: string | null;
  unexpected_count: number | null;
  unexpected_percent: number | null;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Returns a list of all tables in the dq_quarantined schema.
 * Each entry represents one quarantined dataset.
 */
export async function listQuarantinedTables(
  client: FabricSqlClient,
  schema = import.meta.env.VITE_DQ_QUARANTINED_SCHEMA ?? "dq_quarantined",
): Promise<QuarantineTableInfo[]> {
  const rows = await client.query(`
    SELECT TABLE_SCHEMA, TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = '${escapeString(schema)}'
      AND TABLE_TYPE = 'BASE TABLE'
    ORDER BY TABLE_NAME
  `);

  return rows.map((r) => {
    const tableName = String(r["TABLE_NAME"] ?? "");
    const tableSchema = String(r["TABLE_SCHEMA"] ?? schema);
    return {
      tableName,
      qualifiedName: `${tableSchema}.${tableName}`,
    };
  });
}

/**
 * Fetches rows from a dq_quarantined.<tableName> table.
 * Returns fully dynamic rows — all columns including the original dataset
 * columns (which vary per dataset) plus the metadata columns.
 */
export async function fetchQuarantinedRows(
  client: FabricSqlClient,
  tableName: string,
  options: FetchQuarantineRowsOptions = {},
  schema = import.meta.env.VITE_DQ_QUARANTINED_SCHEMA ?? "dq_quarantined",
): Promise<Record<string, unknown>[]> {
  const conditions: string[] = [];

  if (options.run_id) {
    conditions.push(`run_id = '${escapeString(options.run_id)}'`);
  }
  if (options.from) {
    conditions.push(`run_timestamp >= '${escapeString(options.from)}'`);
  }
  if (options.to) {
    conditions.push(`run_timestamp <= '${escapeString(options.to)}'`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const schemaId = escapeIdentifier(schema);
  const tableId = escapeIdentifier(tableName);

  let sql = `SELECT * FROM ${schemaId}.${tableId} ${where}`;

  // Pagination via OFFSET / FETCH (T-SQL / Fabric SQL dialect).
  if (options.limit !== undefined) {
    const offset = options.offset ?? 0;
    sql += ` ORDER BY run_timestamp DESC
             OFFSET ${offset} ROWS
             FETCH NEXT ${options.limit} ROWS ONLY`;
  } else {
    sql += " ORDER BY run_timestamp DESC";
  }

  return client.query(sql);
}

/**
 * Returns the count of rows in a quarantine table, with optional filters.
 * Used for pagination controls.
 */
export async function countQuarantinedRows(
  client: FabricSqlClient,
  tableName: string,
  options: Pick<FetchQuarantineRowsOptions, "run_id" | "from" | "to"> = {},
  schema = import.meta.env.VITE_DQ_QUARANTINED_SCHEMA ?? "dq_quarantined",
): Promise<number> {
  const conditions: string[] = [];
  if (options.run_id) conditions.push(`run_id = '${escapeString(options.run_id)}'`);
  if (options.from) conditions.push(`run_timestamp >= '${escapeString(options.from)}'`);
  if (options.to) conditions.push(`run_timestamp <= '${escapeString(options.to)}'`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const schemaId = escapeIdentifier(schema);
  const tableId = escapeIdentifier(tableName);

  const rows = await client.query(
    `SELECT COUNT(*) AS cnt FROM ${schemaId}.${tableId} ${where}`,
  );
  return Number(rows[0]?.["cnt"] ?? 0);
}

/**
 * Fetches all check failures from dq_results for a given run_id.
 * Used in the TriagePanel to show which checks triggered the quarantine.
 *
 * Note: queries the DQ engine SQL endpoint (dbo.dq_results), not the
 * project endpoint. Pass a client configured with VITE_DQ_ENGINE_SQL_ENDPOINT_URL.
 */
export async function fetchRunCheckFailures(
  dqEngineClient: FabricSqlClient,
  run_id: string,
): Promise<CheckFailure[]> {
  const rows = await dqEngineClient.query(`
    SELECT
      check_name,
      check_type,
      column_name,
      success,
      level,
      observed_value,
      unexpected_count,
      unexpected_percent
    FROM dbo.dq_results
    WHERE run_id = '${escapeString(run_id)}'
    ORDER BY
      CASE WHEN level = 'fail' THEN 0 ELSE 1 END,
      check_name
  `);

  return rows.map((r) => ({
    check_name: (r["check_name"] as string | null) ?? null,
    check_type: String(r["check_type"] ?? ""),
    column_name: (r["column_name"] as string | null) ?? null,
    success: Boolean(r["success"]),
    level: String(r["level"] ?? "fail"),
    observed_value: (r["observed_value"] as string | null) ?? null,
    unexpected_count:
      r["unexpected_count"] != null ? Number(r["unexpected_count"]) : null,
    unexpected_percent:
      r["unexpected_percent"] != null ? Number(r["unexpected_percent"]) : null,
  }));
}

/**
 * Returns distinct run_ids available in a quarantine table, most recent first.
 * Used to populate the run_id filter dropdown.
 */
export async function listRunIds(
  client: FabricSqlClient,
  tableName: string,
  schema = import.meta.env.VITE_DQ_QUARANTINED_SCHEMA ?? "dq_quarantined",
): Promise<string[]> {
  const schemaId = escapeIdentifier(schema);
  const tableId = escapeIdentifier(tableName);

  const rows = await client.query(`
    SELECT DISTINCT run_id, MAX(run_timestamp) AS latest_ts
    FROM ${schemaId}.${tableId}
    GROUP BY run_id
    ORDER BY latest_ts DESC
  `);

  return rows.map((r) => String(r["run_id"] ?? ""));
}
