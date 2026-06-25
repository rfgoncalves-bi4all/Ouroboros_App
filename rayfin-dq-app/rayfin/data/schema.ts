import type { QuarantineTriage } from "./QuarantineTriage.js";
import type { QuarantineEdit } from "./QuarantineEdit.js";

/**
 * Maps entity names to their TypeScript types for the RayfinClient schema.
 * Used by src/lib/rayfin.ts to create a typed client instance.
 */
export type AppSchema = {
  QuarantineTriage: QuarantineTriage;
  QuarantineEdit: QuarantineEdit;
};
