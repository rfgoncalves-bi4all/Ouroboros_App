/**
 * QuarantineEdit — Rayfin entity definition.
 *
 * Stages a data-edit intent (delete or field-value correction) for a quarantined row.
 * The apply-notebook consumes rows where status = "pending".
 *
 * Access control:
 *   - All authenticated users may read and create edit records.
 *   - Update and delete are restricted to the record's creator via ownership policy.
 *
 * The `corrections` field is stored as a JSON-encoded string because
 * @microsoft/rayfin-core does not provide a @json() decorator. Serialization and
 * deserialization are handled in the service layer (src/services/rayfinClient.ts).
 *
 * Fields `edited_by` and `edited_at` are set explicitly in the service layer.
 */
import { entity, uuid, text, date, set, authenticated } from "@microsoft/rayfin-core";

// ---------------------------------------------------------------------------
// Enums — re-exported by src/models/QuarantineEdit.ts
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

@entity()
@authenticated(["read", "create"])
@authenticated(["update", "delete"], {
  policy: (claims, item) => claims.sub.eq(item.edited_by),
})
export class QuarantineEdit {
  @uuid()
  id!: string;

  @text()
  dataset!: string;

  @text()
  run_id!: string;

  @text()
  row_hash!: string;

  @set("delete", "correct")
  action!: "delete" | "correct";

  /**
   * JSON-encoded map of { fieldName: newValue } for "correct" actions.
   * Serialized to string by the service layer before persisting; deserialized
   * back to Record<string, unknown> when reading.
   */
  @text({ optional: true })
  corrections?: string;

  @set("pending", "applied", "rejected")
  status!: "pending" | "applied" | "rejected";

  /** Populated from the authenticated user's ID on create (set by service layer). */
  @text()
  edited_by!: string;

  /** Set to new Date() on create (set by service layer). */
  @date()
  edited_at!: Date;

  @text({ optional: true })
  notes?: string;
}
