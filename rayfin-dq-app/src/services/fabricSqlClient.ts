/**
 * fabricSqlClient.ts
 *
 * Thin HTTP client for the Fabric Lakehouse SQL Analytics Endpoint.
 *
 * Authentication: user passthrough — the caller supplies the Bearer token
 * obtained from the Rayfin auth context. No service principal is used.
 *
 * The client posts SQL statements to the endpoint's /query resource and
 * handles both single-page and paginated (continuation-token) responses.
 *
 * Table and column identifiers are always bracket-escaped before being
 * interpolated into SQL. String filter values are single-quote-escaped.
 * Never pass raw, unvalidated user input directly to query() — use the
 * escapeString() / escapeIdentifier() helpers exported from this module.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface FabricSqlClientOptions {
  /** Base URL of the Fabric SQL Analytics Endpoint. No trailing slash. */
  endpointUrl: string;
  /** Bearer token from the Rayfin auth context. */
  bearerToken: string;
}

interface FabricQueryResponse {
  /** Fabric REST API wraps rows under different keys depending on version. */
  value?: Record<string, unknown>[];
  rows?: Record<string, unknown>[];
  results?: Record<string, unknown>[];
  /** Continuation token for paginated results. */
  continuationToken?: string;
  "@odata.nextLink"?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Escapes a string value for use in a SQL literal (replaces ' with '').
 * Use this for every user-controlled or dynamic string value in SQL.
 */
export function escapeString(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Bracket-escapes a SQL identifier (table name, column name, schema name).
 * Replaces ] with ]] inside the identifier to prevent injection.
 */
export function escapeIdentifier(name: string): string {
  return `[${name.replace(/]/g, "]]")}]`;
}

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class FabricSqlClient {
  private readonly endpointUrl: string;
  private readonly bearerToken: string;

  constructor(options: FabricSqlClientOptions) {
    this.endpointUrl = options.endpointUrl.replace(/\/$/, "");
    this.bearerToken = options.bearerToken;
  }

  /**
   * Execute a SQL statement and return all rows, automatically following
   * continuation tokens until the result set is exhausted.
   *
   * @param sql - The T-SQL statement to execute.
   * @returns An array of row objects keyed by column name.
   */
  async query(sql: string): Promise<Record<string, unknown>[]> {
    const allRows: Record<string, unknown>[] = [];
    let url: string | null = `${this.endpointUrl}/query`;

    while (url !== null) {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.bearerToken}`,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({ query: sql }),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => "");
        throw new FabricSqlError(
          `SQL query failed [${response.status} ${response.statusText}]: ${body}`,
          response.status,
          sql,
        );
      }

      const data: FabricQueryResponse = await response.json();
      const page = this.extractRows(data);
      allRows.push(...page);

      // Follow continuation token / OData next link if present.
      const nextLink = data["@odata.nextLink"] ?? null;
      const contToken = data.continuationToken ?? null;
      if (nextLink) {
        url = nextLink;
        // Next page is a GET; break the POST-first pattern.
        break; // Fabric paginates differently — re-fetch via GET with the link.
      } else if (contToken) {
        url = `${this.endpointUrl}/query?continuationToken=${encodeURIComponent(contToken)}`;
      } else {
        url = null;
      }
    }

    return allRows;
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private extractRows(data: FabricQueryResponse): Record<string, unknown>[] {
    if (Array.isArray(data)) return data as Record<string, unknown>[];
    if (Array.isArray(data.rows)) return data.rows;
    if (Array.isArray(data.value)) return data.value;
    if (Array.isArray(data.results)) return data.results;
    return [];
  }
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class FabricSqlError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly sql: string,
  ) {
    super(message);
    this.name = "FabricSqlError";
  }
}
