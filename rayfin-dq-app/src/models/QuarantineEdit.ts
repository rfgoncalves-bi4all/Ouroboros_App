/**
 * QuarantineEdit — Rayfin-managed entity.
 *
 * Stages a data-edit intent (delete or field-value correction) for a
 * quarantined row. Rows are identified by row_hash (same convention as
 * QuarantineTriage — see src/utils/rowHash.ts).
 *
 * A separate PySpark notebook is responsible for consuming QuarantineEdit
 * rows where status = "pending" and applying the changes to the source
 * Delta table. This app only writes the intent; it never touches Delta directly.
 *
 * A row may have both a QuarantineTriage decision and one or more
 * QuarantineEdit records — they are independent concerns.
 */
import { entity, field, role } from "@rayfin/sdk/decorators";

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum EditAction {
  Delete = "delete",
  Correct = "correct",
}

export enum EditStatus {
  Pending = "pending",
  Applied = "applied",
  Rejected = "rejected",
}

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

@entity({ name: "QuarantineEdit", description: "Staged data-edit intent for a quarantined row" })
@role("member", { read: true, write: true })
@role("viewer", { read: true, write: false })
export class QuarantineEdit {
  /** Auto-generated primary key. */
  @field({ type: "uuid", primaryKey: true, auto: true })
  id!: string;

  /**
   * Full dataset FQN (e.g. "silver/dim_customer") matching
   * dq_quarantined.<table>.dataset.
   */
  @field({ type: "string", required: true, indexed: true })
  dataset!: string;

  /** UUID run identifier — links to dq_results.run_id. */
  @field({ type: "string", required: true, indexed: true })
  run_id!: string;

  /**
   * SHA-256 hex hash of the row's original column values (metadata
   * columns excluded). The apply-notebook uses this to locate the row
   * in the Delta table.
   */
  @field({ type: "string", required: true, indexed: true })
  row_hash!: string;

  /** Edit action: delete the row or correct field values. */
  @field({
    type: "enum",
    enum: Object.values(EditAction),
    required: true,
  })
  action!: EditAction;

  /**
   * Field-to-new-value correction pairs.
   * Null when action = "delete".
   * Example: { "status": "A", "email": "corrected@example.com" }
   */
  @field({ type: "json", required: false, nullable: true })
  corrections: Record<string, unknown> | null = null;

  /**
   * Lifecycle status set by the apply-notebook once it processes this edit.
   * New edits are created with status = "pending".
   */
  @field({
    type: "enum",
    enum: Object.values(EditStatus),
    default: EditStatus.Pending,
    required: true,
    indexed: true,
  })
  status!: EditStatus;

  /**
   * Identity of the user who staged the edit, from the Rayfin auth session.
   */
  @field({ type: "string", fromAuth: "userId", required: true })
  edited_by!: string;

  /** Timestamp of the edit intent — set automatically on creation. */
  @field({ type: "datetime", auto: "createdAt", required: true })
  edited_at!: string;

  /** Optional free-text note. */
  @field({ type: "string", required: false })
  notes?: string;
}
