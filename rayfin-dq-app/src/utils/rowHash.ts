/**
 * rowHash.ts
 *
 * Deterministic SHA-256 row hash for quarantined rows.
 *
 * Convention (must match the apply-notebook that reads QuarantineEdit rows):
 *   1. Exclude metadata columns: run_id, run_timestamp, dataset,
 *      _dq_failed, _dq_failed_checks
 *   2. Sort remaining column names alphabetically (case-sensitive, locale-independent)
 *   3. Concatenate column values (coerced to string, null/undefined → "") with "|"
 *   4. SHA-256 the UTF-8 encoded string → hex digest
 *
 * This must be kept in sync with the PySpark equivalent in the apply notebook:
 *
 *   import hashlib, json
 *   EXCLUDE = {"run_id", "run_timestamp", "dataset", "_dq_failed", "_dq_failed_checks"}
 *   def row_hash(row_dict):
 *       keys = sorted(k for k in row_dict if k not in EXCLUDE)
 *       payload = "|".join(str(row_dict[k]) if row_dict[k] is not None else "" for k in keys)
 *       return hashlib.sha256(payload.encode("utf-8")).hexdigest()
 */

/** Metadata columns added by ouroboros-gx that are NOT part of the original row. */
export const METADATA_COLUMNS = new Set([
  "run_id",
  "run_timestamp",
  "dataset",
  "_dq_failed",
  "_dq_failed_checks",
]);

/**
 * Compute a deterministic SHA-256 hex hash for a quarantine row.
 *
 * @param row - Full row object from the dq_quarantined table, including
 *              metadata columns (they will be excluded automatically).
 * @returns Lowercase hex-encoded SHA-256 digest.
 */
export async function computeRowHash(
  row: Record<string, unknown>,
): Promise<string> {
  // Sort keys alphabetically, excluding metadata columns.
  const keys = Object.keys(row)
    .filter((k) => !METADATA_COLUMNS.has(k))
    .sort((a, b) => a.localeCompare(b));  // locale-independent alphabetical

  const payload = keys
    .map((k) => {
      const v = row[k];
      return v === null || v === undefined ? "" : String(v);
    })
    .join("|");

  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Compute hashes for an array of rows in parallel.
 * Returns an array of hex strings in the same order as the input.
 */
export async function computeRowHashes(
  rows: Record<string, unknown>[],
): Promise<string[]> {
  return Promise.all(rows.map(computeRowHash));
}
