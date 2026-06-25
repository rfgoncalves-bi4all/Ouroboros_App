import { defineConfig } from "@rayfin/sdk";
import type { RayfinConfig } from "@rayfin/sdk";

const config: RayfinConfig = defineConfig({
  name: "rayfin-dq-app",
  displayName: "Data Quality Triage",
  description:
    "Quarantine triage, DQ results viewer, and contract explorer for ouroboros-gx.",
  entities: [
    "./src/models/QuarantineTriage.ts",
    "./src/models/QuarantineEdit.ts",
  ],
  entrypoint: "./src/main.tsx",
  auth: {
    // User passthrough — no service principal. Auth flows from the
    // authenticated Rayfin session automatically.
    strategy: "user-passthrough",
  },
  roles: [
    { name: "member", displayName: "Member", description: "Can triage and edit quarantined rows" },
    { name: "viewer", displayName: "Viewer", description: "Read-only access to DQ results" },
  ],
});

export default config;
