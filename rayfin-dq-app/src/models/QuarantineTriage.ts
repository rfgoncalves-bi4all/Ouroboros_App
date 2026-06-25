/**
 * QuarantineTriage — Rayfin-managed entity.
 *
 * Records a human triage decision (approve / reject / escalate) for a single
 * quarantined row. A row is identified by its SHA-256 row_hash (see
 * src/utils/rowHash.ts for the hashing convention).
 *
 * This entity is the ONLY write surface for triage decisions. The app never
 * writes directly to dq_quarantined or any other ouroboros-gx Delta table.
 */
import { entity, field, role } from "@rayfin/sdk/decorators";

// ---------------------------------------------------------------------------
// Decision enum
// ---------------------------------------------------------------------------

export enum TriageDecision {
  Approved = "approved",
  Rejected = "rejected",
  Escalated = "escalated",
}

// ---------------------------------------------------------------------------
// Entity
// ---------------------------------------------------------------------------

@entity({ name: "QuarantineTriage", description: "Triage decision for a quarantined row" })
@role("member", { read: true, write: true })
@role("viewer", { read: true, write: false })
export class QuarantineTriage {
  /** Auto-generated primary key. */
  @field({ type: "uuid", primaryKey: true, auto: true })
  id!: string;

  /**
   * Full dataset FQN as stored in dq_quarantined.<table>.dataset
   * (e.g. "silver/dim_customer").
   */
  @field({ type: "string", required: true, indexed: true })
  dataset!: string;

  /**
   * UUID run identifier linking this decision back to dq_results.run_id
   * and the originating quarantine row.
   */
  @field({ type: "string", required: true, indexed: true })
  run_id!: string;

  /**
   * SHA-256 hex hash of the quarantined row's original column values
   * (metadata columns excluded). Computed by the frontend using rowHash.ts.
   * Used by the apply-notebook to locate the target row in Delta.
   */
  @field({ type: "string", required: true, indexed: true })
  row_hash!: string;

  /** Triage decision. */
  @field({
    type: "enum",
    enum: Object.values(TriageDecision),
    required: true,
  })
  decision!: TriageDecision;

  /**
   * Identity of the user who made the decision, populated automatically
   * from the authenticated Rayfin session.
   */
  @field({ type: "string", fromAuth: "userId", required: true })
  decided_by!: string;

  /** Timestamp of the decision — set automatically on creation. */
  @field({ type: "datetime", auto: "createdAt", required: true })
  decided_at!: string;

  /** Optional free-text note attached to the decision. */
  @field({ type: "string", required: false })
  notes?: string;
}
