# rayfin-dq-app

Quarantine triage and DQ results viewer for the **ouroboros-gx** data quality framework.

Built with **Rayfin (Microsoft Fabric Apps SDK)**, React, Vite, and Tailwind CSS.

---

## What this app does

| Priority | Feature | Description |
|---|---|---|
| 1 | **Quarantine Triage** | Browse `dq_quarantined/*` tables, review each row's linked check failures, and record Approve / Reject / Escalate decisions or stage Delete / Correct edits |
| 2 | **DQ Results Dashboard** | Pass rate per dataset, trend overview, and filterable failed-check list from `dbo.dq_results` |
| 3 | **Contract Viewer** | Read-only YAML syntax-highlighted view of contract files from `Files/contracts/` |

---

## Prerequisites

- Node.js ≥ 20
- Rayfin CLI: `npm install -g @rayfin/cli`
- Access to the Fabric Lakehouse SQL Analytics Endpoints (see below)

---

## Configuration

Copy `.env.example` to `.env` and fill in the values.

```env
# SQL Analytics Endpoint for the PROJECT Lakehouse (dq_quarantined, dq_flagged)
VITE_FABRIC_SQL_ENDPOINT_URL=https://<workspace-id>.datawarehouse.fabric.microsoft.com

# SQL Analytics Endpoint for the DQ ENGINE Lakehouse (dbo.dq_results)
VITE_DQ_ENGINE_SQL_ENDPOINT_URL=https://<dq-engine-workspace-id>.datawarehouse.fabric.microsoft.com

# Schema names — match ouroboros-gx defaults, only change if you customised them
VITE_DQ_QUARANTINED_SCHEMA=dq_quarantined
VITE_DQ_FLAGGED_SCHEMA=dq_flagged
```

### Finding the SQL Analytics Endpoint URL

In the Fabric workspace:
1. Open the **Lakehouse** item
2. Click **SQL analytics endpoint** in the ribbon
3. Copy the connection string — it looks like:
   `<guid>.datawarehouse.fabric.microsoft.com`

### Contract Viewer (Priority 3 — optional)

The contract viewer uses the Fabric Files REST API. Two additional env vars are needed:

```env
VITE_CONTRACT_WORKSPACE_ID=<fabric-workspace-guid>
VITE_CONTRACT_LAKEHOUSE_ID=<lakehouse-guid>
```

If these are not set the Contract tab shows a configuration message.

---

## Authentication

**User passthrough — no setup required.**

When deployed with `rayfin up`, the app runs inside the authenticated Fabric
session. The `RayfinProvider` injects a Bearer token from the user's session
into `useAuth().accessToken`. This token is forwarded to:

- The Fabric SQL Analytics Endpoints (read-only queries)
- The Fabric Files REST API (contract YAML reads)
- The Rayfin GraphQL API (QuarantineTriage / QuarantineEdit writes)

No service principal, no client secret, no extra token configuration.

---

## Row hash convention

`QuarantineTriage` and `QuarantineEdit` records are linked to quarantine rows
via a **deterministic SHA-256 row hash**.

### Algorithm

1. Take all columns from the quarantine row **excluding** metadata columns:
   `run_id`, `run_timestamp`, `dataset`, `_dq_failed`, `_dq_failed_checks`
2. Sort remaining column names **alphabetically** (case-sensitive, locale-independent)
3. Concatenate values (coerced to string; null/undefined → `""`) with `|` as separator
4. SHA-256 hash the UTF-8 encoded string → lowercase hex digest

### PySpark equivalent (apply notebook)

```python
import hashlib

EXCLUDE = {"run_id", "run_timestamp", "dataset", "_dq_failed", "_dq_failed_checks"}

def row_hash(row_dict: dict) -> str:
    keys = sorted(k for k in row_dict if k not in EXCLUDE)
    payload = "|".join(
        str(row_dict[k]) if row_dict[k] is not None else ""
        for k in keys
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
```

> **Important:** keep the frontend (`src/utils/rowHash.ts`) and the PySpark
> apply notebook in sync. Any change to the exclusion list or sort order will
> break the row matching.

---

## Data flow

```
ouroboros-gx (PySpark)
  └─ persist_results() → dq_quarantined.<dataset>  (Delta, read-only)
                       → dbo.dq_results             (Delta, read-only)

rayfin-dq-app (this app)
  └─ reads  → SQL Analytics Endpoint (user passthrough)
  └─ writes → QuarantineTriage  (Rayfin GraphQL, approve/reject/escalate)
            → QuarantineEdit    (Rayfin GraphQL, delete/correct — status=pending)

Apply notebook (separate, out of scope)
  └─ reads  → QuarantineEdit where status=pending
  └─ applies → deletes / corrections to dq_quarantined Delta table
  └─ updates → QuarantineEdit.status = applied
```

---

## Development

```bash
npm install
npm run dev        # starts Vite dev server on http://localhost:3000
npm run typecheck  # TypeScript type check without emitting
npm run build      # production build → dist/
```

---

## Deploy

```bash
rayfin up
```

Rayfin deploys the app to Microsoft Fabric, injects the GraphQL endpoint URL,
and wires up the session auth. No additional configuration is required.

---

## Project structure

```
rayfin-dq-app/
  src/
    models/
      QuarantineTriage.ts    ← @entity — triage decision (approve/reject/escalate)
      QuarantineEdit.ts      ← @entity — staged delete or field correction
    services/
      fabricSqlClient.ts     ← fetch-based SQL client (user passthrough auth)
      quarantineService.ts   ← queries dq_quarantined.* and dq_results
      resultsService.ts      ← queries dbo.dq_results for dashboard
      rayfinClient.ts        ← GraphQL wrappers for Rayfin entities
    hooks/
      useFabricClients.ts    ← builds SQL + GraphQL clients from auth context
      useQuarantineState.ts  ← React Query hooks for triage/edit state
    utils/
      rowHash.ts             ← deterministic SHA-256 row hash
    app/
      QuarantineDatasetList.tsx  ← P1: dataset picker
      QuarantineRowTable.tsx     ← P1: dynamic row table with overlays
      TriagePanel.tsx            ← P1: per-row triage + edit side panel
      DQResultsDashboard.tsx     ← P2: summary cards + sub-components
      DatasetPassRate.tsx        ← P2: pass rate table with sort
      CheckFailureList.tsx       ← P2: failed checks with filters
      ContractViewer.tsx         ← P3: YAML contract file viewer
    App.tsx                  ← tab navigation + QueryClient
    main.tsx                 ← RayfinProvider + React root
```

---

## Constraints

- **Read-only Delta access** — `dq_results`, `dq_flagged`, `dq_quarantined` are read via the SQL Analytics Endpoint only. The app never writes to these tables.
- **No service principal** — user passthrough auth only.
- **No hand-written REST endpoints** — Rayfin's auto-generated GraphQL handles all entity writes.
- **No hardcoded workspace/lakehouse IDs** — all connection details come from env vars.
- **Dynamic schema** — the row table renders columns generically; no dataset schema is hardcoded.
