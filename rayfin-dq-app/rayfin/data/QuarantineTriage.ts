/**
 * QuarantineTriage — Rayfin entity definition.
 *
 * Records a human triage decision (approve / reject / escalate) for a single
 * quarantined row. Identified by SHA-256 row_hash (see src/utils/rowHash.ts).
 *
 * Access control:
 *   - All authenticated users may read and create triage records.
 *   - Update and delete are restricted to the record's creator via ownership policy.
 *
 * Fields `decided_by` and `decided_at` are set explicitly in the service layer
 * (see src/services/rayfinClient.ts) because @microsoft/rayfin-core does not
 * provide fromAuth or auto field options.
 */
import { entity, uuid, text, date, set, authenticated } from "@microsoft/rayfin-core";

// ---------------------------------------------------------------------------
// Decision enum — re-exported by src/models/QuarantineTriage.ts
// ---------------------------------------------------------------------------

export enum TriageDecision {
  Approved = "approved",
  Rejected = "rejected",
  Escalated = "escalated",
}

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

@entity()
@authenticated(["read", "create"])
@authenticated(["update", "delete"], {
  policy: (claims, item) => claims.sub.eq(item.decided_by),
})
export class QuarantineTriage {
  @uuid()
  id!: string;

  @text()
  dataset!: string;

  @text()
  run_id!: string;

  @text()
  row_hash!: string;

  @set("approved", "rejected", "escalated")
  decision!: "approved" | "rejected" | "escalated";

  /** Populated from the authenticated user's ID on create (set by service layer). */
  @text()
  decided_by!: string;

  /** Set to new Date() on create (set by service layer). */
  @date()
  decided_at!: Date;

  @text({ optional: true })
  notes?: string;
}
