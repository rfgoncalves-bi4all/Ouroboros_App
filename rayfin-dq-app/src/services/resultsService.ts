/**
 * resultsService.ts
 *
 * Read-only queries against the DQ Engine SQL Analytics Endpoint (dbo.dq_results).
 *
 * dq_results schema (from ouroboros-gx result_persister.py):
 *   run_id            string   — UUID
 *   run_timestamp     string   — ISO 8601 UTC
 *   data_workspace_id string   — GUID of data workspace (nullable)
 *   data_lakehouse_name string — Lakehouse name portion of FQN (nullable)
 *   schema_name       string   — Schema portion of FQN (nullable)
 *   dataset           string   — Table name portion of FQN
 *   check_name        string   — Human-readable name (nullable)
 *   check_type        string   — GX expectation type or custom type
 *   column_name       string   — Column (null for table-level checks)
 *   success           boolean
 *   level             string   — "fail" | "warn"
 *   observed_value    string   — Observed metric (nullable)
 *   unexpected_count  long     — (nullable)
 *   unexpected_percent double  — (nullable)
 *   engine_version    string   — (nullable)
 */
import { FabricSqlClient, escapeString } from "./fabricSqlClient";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DatasetPassRate {
  /** Table-name portion of the dataset FQN (from dq_results.dataset). */
  dataset: string;
  /** Lakehouse name (from dq_results.data_lakehouse_name). */
  data_lakehouse_name: string | null;
  total_checks: number;
  passed_checks: number;
  /** Pass rate as a percentage (0–100). */
  pass_rate: number;
  /** Most recent run timestamp in this dataset. */
  latest_run: string | null;
}

export interface DQSummary {
  total_runs: number;
  datasets_with_failures: number;
  overall_pass_rate: number;
}

export interface FailedCheck {
  run_id: string;
  run_timestamp: string;
  dataset: string;
  data_lakehouse_name: string | null;
  check_name: string | null;
  check_type: string;
  column_name: string | null;
  level: string;
  observed_value: string | null;
  unexpected_count: number | null;
  unexpected_percent: number | null;
}

export interface GetFailedChecksOptions {
  /** Filter by table-name portion of the dataset (matches dq_results.dataset). */
  dataset?: string;
  /** ISO 8601 lower bound for run_timestamp (inclusive). */
  dateFrom?: string;
  /** ISO 8601 upper bound for run_timestamp (inclusive). */
  dateTo?: string;
  limit?: number;
}

// ---------------------------------------------------------------------------
// Functions
// ---------------------------------------------------------------------------

/**
 * Returns pass rate aggregated per dataset for the DQ Results Dashboard.
 * Optionally restricts to runs on or after dateFrom.
 */
export async function getPassRateByDataset(
  client: FabricSqlClient,
  dateFrom?: string,
): Promise<DatasetPassRate[]> {
  const dateFilter = dateFrom
    ? `AND run_timestamp >= '${escapeString(dateFrom)}'`
    : "";

  const rows = await client.query(`
    SELECT
      dataset,
      data_lakehouse_name,
      COUNT(*)                                                       AS total_checks,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END)                  AS passed_checks,
      ROUND(
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100,
        1
      )                                                              AS pass_rate,
      MAX(run_timestamp)                                             AS latest_run
    FROM dbo.dq_results
    WHERE 1 = 1
    ${dateFilter}
    GROUP BY dataset, data_lakehouse_name
    ORDER BY pass_rate ASC, dataset ASC
  `);

  return rows.map((r) => ({
    dataset: String(r["dataset"] ?? ""),
    data_lakehouse_name: (r["data_lakehouse_name"] as string | null) ?? null,
    total_checks: Number(r["total_checks"] ?? 0),
    passed_checks: Number(r["passed_checks"] ?? 0),
    pass_rate: Number(r["pass_rate"] ?? 0),
    latest_run: (r["latest_run"] as string | null) ?? null,
  }));
}

/**
 * Returns aggregate DQ health summary for the dashboard cards.
 */
export async function getDQSummary(client: FabricSqlClient): Promise<DQSummary> {
  const rows = await client.query(`
    SELECT
      COUNT(DISTINCT run_id)                                             AS total_runs,
      COUNT(DISTINCT CASE WHEN success = 0 AND level = 'fail'
                          THEN dataset END)                             AS datasets_with_failures,
      ROUND(
        CAST(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS FLOAT)
        / NULLIF(COUNT(*), 0) * 100,
        1
      )                                                                  AS overall_pass_rate
    FROM dbo.dq_results
  `);

  const r = rows[0] ?? {};
  return {
    total_runs: Number(r["total_runs"] ?? 0),
    datasets_with_failures: Number(r["datasets_with_failures"] ?? 0),
    overall_pass_rate: Number(r["overall_pass_rate"] ?? 0),
  };
}

/**
 * Returns the list of failed checks, with optional dataset and date filters.
 */
export async function getFailedChecks(
  client: FabricSqlClient,
  options: GetFailedChecksOptions = {},
): Promise<FailedCheck[]> {
  const conditions: string[] = ["success = 0"];

  if (options.dataset) {
    conditions.push(`dataset = '${escapeString(options.dataset)}'`);
  }
  if (options.dateFrom) {
    conditions.push(`run_timestamp >= '${escapeString(options.dateFrom)}'`);
  }
  if (options.dateTo) {
    conditions.push(`run_timestamp <= '${escapeString(options.dateTo)}'`);
  }

  const limitClause = options.limit
    ? `ORDER BY run_timestamp DESC
       OFFSET 0 ROWS FETCH NEXT ${options.limit} ROWS ONLY`
    : "ORDER BY run_timestamp DESC";

  const rows = await client.query(`
    SELECT
      run_id,
      run_timestamp,
      dataset,
      data_lakehouse_name,
      check_name,
      check_type,
      column_name,
      level,
      observed_value,
      unexpected_count,
      unexpected_percent
    FROM dbo.dq_results
    WHERE ${conditions.join(" AND ")}
    ${limitClause}
  `);

  return rows.map((r) => ({
    run_id: String(r["run_id"] ?? ""),
    run_timestamp: String(r["run_timestamp"] ?? ""),
    dataset: String(r["dataset"] ?? ""),
    data_lakehouse_name: (r["data_lakehouse_name"] as string | null) ?? null,
    check_name: (r["check_name"] as string | null) ?? null,
    check_type: String(r["check_type"] ?? ""),
    column_name: (r["column_name"] as string | null) ?? null,
    level: String(r["level"] ?? "fail"),
    observed_value: (r["observed_value"] as string | null) ?? null,
    unexpected_count: r["unexpected_count"] != null ? Number(r["unexpected_count"]) : null,
    unexpected_percent: r["unexpected_percent"] != null ? Number(r["unexpected_percent"]) : null,
  }));
}

/**
 * Returns distinct dataset values for use in filter dropdowns.
 */
export async function listDatasets(client: FabricSqlClient): Promise<string[]> {
  const rows = await client.query(`
    SELECT DISTINCT dataset
    FROM dbo.dq_results
    ORDER BY dataset
  `);
  return rows.map((r) => String(r["dataset"] ?? ""));
}
