# ouroboros-gx — Rayfin App Context

## Purpose
This document provides context for GitHub Copilot to scaffold a Rayfin (Microsoft Fabric Apps SDK) application that sits alongside the **ouroboros-gx** Data Quality framework. Read this before scaffolding anything.

---

## Existing DQ Framework — ouroboros-gx

- Built on **Great Expectations Core 1.x**, runs on **Microsoft Fabric notebooks** (PySpark)
- DQ rules are declared in **YAML contract files** stored in the project Lakehouse under `Files/contracts/` — the app does NOT manage these files
- The framework flags bad rows, applies remediation actions (including `quarantine`), and persists results to Delta tables

### Output tables (written by the framework, READ by the app)

All tables are in the **project workspace Bronze Lakehouse** unless noted.

| Table | Location | Description |
|---|---|---|
| `dq_results` | DQ Engine Workspace → Gold Lakehouse (`dbo.dq_results`) | One row per check per run |
| `dq_flagged/<dataset>` | Project Lakehouse, schema `dq_flagged` | Rows where `_dq_failed = true` |
| `dq_quarantined/<dataset>` | Project Lakehouse, schema `dq_quarantined` | Rows routed by `quarantine` remediation action |

### Dataset table naming convention
FQN non-alphanumeric chars replaced with `_`, lowercased:
- `silver/dim_customer` → `silver_dim_customer`
- `bronze/lu/cash_flow` → `bronze_lu_cash_flow`

---

## `dq_quarantined/<dataset>` Schema (PRIMARY FOCUS)

Per-dataset table. Schema = **original dataset columns** + these metadata columns:

| Column | Type | Description |
|---|---|---|
| `run_id` | string | UUID matching `dq_results.run_id` |
| `run_timestamp` | string | ISO 8601 UTC |
| `dataset` | string | Dataset FQN (e.g. `silver/dim_customer`) |

> Schema varies per dataset — the app must handle dynamic/unknown column sets.

---

## `dq_results` Schema (for run context / linking)

| Column | Type | Description |
|---|---|---|
| `run_id` | string | UUID |
| `run_timestamp` | string | ISO 8601 UTC |
| `data_workspace_id` | string | GUID of data workspace |
| `data_lakehouse_name` | string | Lakehouse name |
| `dataset` | string | FQN |
| `layer` | string | Lakehouse portion of FQN |
| `schema_name` | string | Schema portion (nullable) |
| `check_name` | string | Human-readable check name |
| `check_type` | string | GX expectation type |
| `column_name` | string | Column (null for table-level checks) |
| `success` | boolean | Pass/fail |
| `level` | string | `fail` or `warn` |
| `observed_value` | string | Observed metric |
| `unexpected_count` | long | Failing row count |
| `unexpected_percent` | double | Failing row % |
| `engine_version` | string | ouroboros-gx version |

---

## What the Rayfin App Must Do

### Priority 1 — Quarantine Triage UI
This is the main purpose of the app.

- List all available `dq_quarantined/*` tables (one per dataset) from the project Lakehouse
- For a selected dataset, display its quarantined rows with full column set (dynamic schema)
- Show linked run context from `dq_results` (which checks failed, when, unexpected counts)
- Allow users to triage each quarantined row:
  - **Approve** — row is valid, should be reintegrated into the source table
  - **Reject** — row is genuinely bad, should be discarded
  - **Escalate** — needs further review / human decision
- Triage decisions are stored in a Rayfin-managed `QuarantineTriage` entity (see below)
- Filter/search by dataset, run_id, run_timestamp, triage status

### Priority 2 — DQ Results Dashboard
- Summary view of `dq_results`: pass rates per dataset, trends over time, top failing checks
- Drill-down to row-level issues

### Priority 3 — Contract Viewer (read-only)
- Display YAML contract files from `Files/contracts/` in the project Lakehouse
- No editing — contracts are managed in source control / deployed as files

---

## Rayfin Data Model

### QuarantineTriage (Rayfin-managed — app's own entity)

| Field | Type | Notes |
|---|---|---|
| id | uuid | auto |
| dataset | string | FQN of the quarantined dataset |
| run_id | string | Links to `dq_results.run_id` |
| row_hash | string | Hash of the quarantined row for identification |
| decision | enum | approved, rejected, escalated |
| decided_by | string | From auth context |
| decided_at | datetime | auto |
| notes | string | Optional |

> The app does NOT write back to the source Delta tables — that is a separate notebook responsibility.

---

## Deployment Topology (from README)

```
DQ Engine Workspace (dev/test/prd)
  Gold Lakehouse → dbo.dq_results

Project Workspace (dev/test/prd)
  Bronze Lakehouse
    Files/contracts/*.yaml          ← read-only from app
    Tables/dq_flagged/<dataset>     ← read-only from app
    Tables/dq_quarantined/<dataset> ← PRIMARY: read + triage
  Notebooks
    suite_runner.ipynb
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend / API | Rayfin (TypeScript, `@entity` decorators) |
| Frontend | React + Vite + Tailwind CSS |
| Deployment | `rayfin up` to Microsoft Fabric |
| DQ execution | ouroboros-gx PySpark (existing, unchanged) |

---

## Hard Constraints
- Do NOT modify any existing ouroboros-gx Python code
- Do NOT manage or edit YAML contract files from the app — read-only at most
- `dq_results`, `dq_flagged`, `dq_quarantined` tables are written by the framework — app reads only
- The app's only write surface is the `QuarantineTriage` Rayfin entity
- Frontend uses React + Vite + Tailwind only
- No hand-written REST endpoints — use Rayfin's auto-generated GraphQL only

---

## Quarantine Edit Staging (write-back pattern)

The app cannot write directly to Delta tables (SQL Analytics Endpoint is read-only). Instead, edits are staged in a Rayfin-managed entity and applied to Delta by a separate notebook.

### QuarantineEdit (Rayfin-managed)

| Field | Type | Notes |
|---|---|---|
| id | uuid | auto |
| dataset | string | FQN of the quarantined dataset |
| run_id | string | Links to `dq_results.run_id` |
| row_hash | string | SHA-256 of original row values — identifies the target row |
| action | enum | `delete`, `correct` |
| corrections | json | `{field: new_value}` pairs — null when action=delete |
| status | enum | `pending`, `applied`, `rejected` |
| edited_by | string | From Rayfin auth context |
| edited_at | datetime | auto |
| notes | string | Optional |

### Notebook responsibility (out of scope for the app)
A PySpark notebook reads `QuarantineEdit` rows where `status = pending` and:
- `delete` → removes the matching row from `dq_quarantined.<dataset>` using `row_hash`
- `correct` → updates field values on the matching row
- Sets `status = applied` on completion

### Row hashing convention
Row hash = SHA-256 of all original dataset column values (excluding metadata columns `run_id`, `run_timestamp`, `dataset`), concatenated in column-name alphabetical order. The frontend must compute this consistently so the notebook can match rows.

### Relationship to QuarantineTriage
These are separate concerns:
- `QuarantineTriage` — review decision (approve / reject / escalate)
- `QuarantineEdit` — data edit intent (delete / correct field values)
A row can have both a triage decision and one or more edits.
