# ouroboros-gx

Data quality framework for Microsoft Fabric, powered by **Great Expectations Core (1.x)**.

Declare quality rules in human-readable **YAML data contracts**; the framework translates them into GX expectations, runs them against Lakehouse Delta tables or any Spark DataFrame, **flags and repairs bad rows**, and **persists results** to a central DQ engine workspace.

---

## Table of Contents

1. [Architecture](#architecture)
2. [Deployment topology](#deployment-topology)
3. [Build & distribute](#build--distribute)
4. [Environment configuration](#environment-configuration)
5. [Dataset FQN](#dataset-fqn)
6. [Contract file schema](#contract-file-schema)
7. [Threshold syntax](#threshold-syntax)
8. [Column-level checks](#column-level-checks)
   - [missing](#missing)
   - [invalid](#invalid)
   - [duplicate](#duplicate-column)
   - [aggregate](#aggregate)
   - [freshness](#freshness)
   - [contains](#contains)
   - [case_style](#case_style)
   - [failed_rows](#failed_rows)
   - [metric](#metric)
9. [Table-level checks](#table-level-checks)
   - [row_count](#row_count)
   - [schema](#schema)
   - [duplicate (multi-column)](#duplicate-multi-column)
   - [freshness (table-level)](#freshness-table-level)
   - [failed_rows (table-level)](#failed_rows-table-level)
   - [metric (table-level)](#metric-table-level)
10. [Reconciliation](#reconciliation)
11. [Row flagging](#row-flagging)
12. [Remediation actions](#remediation-actions)
13. [Test suites](#test-suites)
14. [Usage](#usage)
    - [Discover and run all contracts](#discover-and-run-all-contracts)
15. [Persistent logs](#persistent-logs)
16. [Cross-table validation](#cross-table-validation)
17. [Legacy check names](#legacy-check-names)

---

## Architecture

```bash
contracts/
  dim_customer.yaml          ← one contract per dataset
  fact_sales.yaml
  suites/
    daily_critical.yaml      ← named test suites
    smoke.yaml
    full.yaml

src/ouroboros_gx/
  fqn.py                     ← DatasetFQN — parse lakehouse/schema/table strings
  models.py                  ← Pydantic schema (DataContract, Check, RemediationAction…)
  contract_loader.py         ← YAML parsing, variable substitution, ABFS file reading
  contract_discovery.py      ← discover contracts from a Lakehouse folder
  suite_loader.py            ← load / discover named test suites
  expectation_mapper.py      ← check type → GX Expectation mapping
  lakehouse_connector.py     ← Spark / Delta data loading
  dq_runner.py               ← main orchestrator (DQRunner)
  reconciliation_runner.py   ← cross-dataset reconciliation checks
  inline_runner.py           ← notebook-level checks without a contract file
  row_flagger.py             ← adds _dq_failed / _dq_failed_checks columns
  remediation.py             ← on_fail repair actions (deduplicate, fill, drop, quarantine)
  result_reporter.py         ← ScanResult, display_results, summarize
  result_persister.py        ← persist results / flagged / quarantined rows to Delta

notebooks/
  data_quality_runner.ipynb  ← single-contract example notebook
  suite_runner.ipynb         ← project-level suite runner
```

---

## Deployment topology

```
┌──────────────────────────────────────────────────────────────┐
│  DQ Engine Workspace  (1 per environment: dev / test / prd)  │
│  – Fabric Custom Library: ouroboros-gx.whl                   │
│  – Data Quality Lakehouse                                    │
│      Tables/dbo/dq_results           ← one row per check/run │
└──────────────────────────────────────────────────────────────┘
                              ↑ persist_results() via abfss

┌─────────────────────────────────────────────────────────────────────────────┐
│  Project Workspace A  (replicated ×3: dev / test / prd)                     │
│  – Bronze Lakehouse                                                         │
│      Files/dataquality/contracts/*.yaml     ← project's own contracts       │
│      Files/dataquality/suites/*.yaml        ← test suites for this project  │
│      Tables/dq_flagged/<dataset>     ← rows where _dq_failed=T              │
│      Tables/dq_quarantined/<dataset> ← rows routed to quarantine            │
│  – Notebooks                                                                │
│      suite_runner.ipynb         ← runs the DQ suite                         │
│      <pipeline notebooks>       ← inline checks via run_inline()            │
└─────────────────────────────────────────────────────────────────────────────┘
```

Each environment (dev / test / prd) has its own DQ engine workspace.  
Environment differentiation is handled via **Fabric Environment variables** — no code changes required per environment.

---

## Build & distribute

### 1 — Build the wheel

```bash
pip install build
python -m build
# Produces: dist/ouroboros_gx-0.1.14-py3-none-any.whl
```

### 2 — Upload to the DQ engine workspace

1. In the **DQ engine workspace**, open **My workspace** → **Environments**.
2. Create or open your shared Fabric Environment (e.g. `dq-engine-env`).
3. Go to **Custom libraries** → **Upload** → select `ouroboros_gx-*.whl`.
4. Click **Publish**.

### 3 — Attach the environment to notebooks

In each project notebook:

- Open the notebook → **Environment** (top-right) → select `dq-engine-env`.

All notebooks sharing this environment get the package automatically — no `%pip install` needed at runtime.

### 4 — Upload contracts and suites to the project Lakehouse

Upload your contract YAML files to the **Bronze Lakehouse** of each project workspace:

```
Files/
  contracts/
    dim_customer.yaml
    fact_sales.yaml
  suites/
    daily_critical.yaml
    smoke.yaml
```

---

## Environment configuration

| Variable | Used by | Purpose |
|---|---|---|
| `CONTRACT_WORKSPACE_NAME` | `DQRunner` | Display name of the project workspace that owns the contracts |
| `CONTRACT_LAKEHOUSE_NAME` | `DQRunner` | Name of the Lakehouse inside the project workspace that holds contracts (default: `bronze`) |
| `DATA_WORKSPACE_NAME` | `DQRunner` | Display name of the workspace for **data** table access (auto-detected when not set) |
| `DQ_RESULTS_WORKSPACE_NAME` | `suite_runner.ipynb` | Display name of the DQ engine workspace where results are written |
| `DQ_RESULTS_LAKEHOUSE_NAME` | `suite_runner.ipynb` | Name of the Lakehouse inside the DQ engine workspace (e.g. `gold`) |

---

## Dataset FQN

Every contract's `dataset` field uses a **fully qualified name (FQN)**:

```
<lakehouse>/<schema>/<table>   →  silver/sales/dim_customer
<lakehouse>/<table>            →  silver/dim_customer
<table>                        →  dim_customer
```

| Components | Spark catalog name | OneLake Tables path |
|---|---|---|
| `table` only | `table` | *(workspace_id required)* |
| `lakehouse/table` | `lakehouse.table` | `…/lakehouse.Lakehouse/Tables/table` |
| `lakehouse/schema/table` | `lakehouse.schema.table` | `…/lakehouse.Lakehouse/Tables/schema/table` |

**Resolution strategy:** when `data_workspace_name` is configured and the FQN contains a `lakehouse` segment, data is read from the OneLake ABFS path (cross-workspace capable). Otherwise `spark.table(fqn.spark_table_name)` is used.

```python
from ouroboros_gx import resolve_workspace_id, resolve_lakehouse_id

ws_id  = resolve_workspace_id("BI4ALL - CoE - DataQuality-PRD")
lh_id  = resolve_lakehouse_id(ws_id, "gold")
```

---

## Contract file schema

```yaml
dataset: silver/dim_customer      # required — FQN of the target dataset

# ── Source ────────────────────────────────────────────────────────────────────
source: tables                    # "tables" (default) | "files"
format: parquet                   # only when source: files — parquet (default) | delta | csv | json
format_options:                   # forwarded to spark.read.options()
  header: "true"
  delimiter: ","
files_since: "2024-01-01 00:00:00"  # ISO datetime; omit = latest partition only

# ── Metadata ──────────────────────────────────────────────────────────────────
owner: user@company.com

# ── Dataset filter ────────────────────────────────────────────────────────────
filter: "created_at > '${FILTER_START_TIME}'"   # SQL WHERE applied before every check

# ── Variables ─────────────────────────────────────────────────────────────────
variables:
  FILTER_START_TIME:
    default: "2024-01-01 00:00:00"

# ── Columns ───────────────────────────────────────────────────────────────────
columns:
  - name: customer_id
    data_type: integer              # optional — adds a type expectation (see type list below)
    column_expression: "TRIM(email)"  # optional — SQL expression evaluated before checks
    checks:
      - type: <check_type>
        name: "Human-readable description"   # optional — shown in the Check column of the report
        filter: "status = 'A'"              # optional — per-check SQL WHERE filter
        <check_params>
        threshold:                          # optional — controls pass/fail bounds
          <threshold_params>
        on_fail:                            # optional — remediation action
          action: quarantine

# ── Table-level checks ────────────────────────────────────────────────────────
checks:
  - type: <check_type>
    name: "Human-readable description"
    <check_params>

# ── Reconciliation ────────────────────────────────────────────────────────────
reconciliation:
  sources:
    - name: <source_alias>
      dataset: <fqn>
      <source_params>
  checks:
    - type: <reconciliation_check_type>
      source: <source_alias>
      <check_params>
```

### `data_type` — accepted SQL types

| YAML value | Spark type |
|---|---|
| `string` / `varchar` / `text` / `char` / `character varying` | `StringType` |
| `integer` / `int` | `IntegerType` |
| `bigint` | `LongType` |
| `smallint` | `ShortType` |
| `tinyint` | `ByteType` |
| `float` / `double` / `real` | `DoubleType` / `FloatType` |
| `decimal` / `numeric` | `DecimalType` |
| `boolean` / `bool` | `BooleanType` |
| `date` | `DateType` |
| `timestamp` | `TimestampType` |
| `binary` | `BinaryType` |

---

## Threshold syntax

Every check accepts an optional `threshold:` block that controls when the check passes or fails.

```yaml
threshold:
  metric: percent           # "count" (default) | "percent"
  must_be_less_than: 5
  level: warn               # "fail" (default) | "warn"
```

| Field | Type | Default | Description |
|---|---|---|---|
| `metric` | `count` \| `percent` | `count` | Whether the bound applies to a raw count or a percentage of total rows |
| `must_be` | float | — | Exact value — the observed metric must equal this |
| `must_be_less_than` | float | — | Observed metric must be strictly less than this |
| `must_be_less_than_or_equal` | float | — | Observed metric must be ≤ this |
| `must_be_greater_than` | float | — | Observed metric must be strictly greater than this |
| `must_be_greater_than_or_equal` | float | — | Observed metric must be ≥ this |
| `must_be_between` | object | — | Closed/open range (see below) |
| `must_be_not_between` | object | — | Inverted range |
| `level` | `fail` \| `warn` | `fail` | `warn` counts as a warning in the report but does not fail the overall scan |

### `must_be_between` / `must_be_not_between`

```yaml
threshold:
  must_be_between:
    greater_than: 0              # exclusive lower bound (>)
    less_than_or_equal: 100      # inclusive upper bound (<=)
```

| Field | Bound |
|---|---|
| `greater_than` | exclusive lower ( > ) |
| `greater_than_or_equal` | inclusive lower ( ≥ ) |
| `less_than` | exclusive upper ( < ) |
| `less_than_or_equal` | inclusive upper ( ≤ ) |

### Examples

```yaml
# Fail if more than 0 missing values
threshold:
  must_be: 0

# Warn if more than 5 % of rows are invalid
threshold:
  metric: percent
  must_be_less_than: 5
  level: warn

# Fail if row count is not between 1 000 and 1 000 000
threshold:
  must_be_between:
    greater_than_or_equal: 1000
    less_than_or_equal: 1000000
```

---

## Column-level checks

### `missing`

Verifies that a column contains no null values. Optionally treats specific values or patterns as "missing".

```yaml
- type: missing
  name: "email must not be null"
  missing_values: ["N/A", "na", ""]   # treat these as missing, in addition to NULL
  missing_format:                      # treat values matching this regex as missing
    name: "blank or whitespace"
    regex: '^\s*$'
  threshold:
    metric: percent
    must_be_less_than: 1
    level: warn
```

| Parameter | Type | Description |
|---|---|---|
| `missing_values` | `list` | Extra values to treat as missing (in addition to `NULL`) |
| `missing_format.name` | `string` | Optional human-readable label for the pattern |
| `missing_format.regex` | `string` | Java regex — values matching this are treated as missing |
| `threshold` | object | Default: must be 0. Use `metric: percent` for a percentage tolerance |

---

### `invalid`

Verifies that column values conform to one or more validity constraints.  
Multiple constraints can be combined on the same check.

```yaml
- type: invalid
  name: "status must be A, I or P"
  valid_values: ["A", "I", "P"]
  threshold:
    must_be: 0
```

#### Positive validity constraints (rows must match)

| Parameter | Type | GX Expectation | Description |
|---|---|---|---|
| `valid_values` | `list` | `ExpectColumnValuesToBeInSet` | Column value must be one of these |
| `valid_format` | object | `ExpectColumnValuesToMatchRegex` | Column value must match a named regex |
| `valid_format.name` | `string` | — | Human-readable label (documentation only) |
| `valid_format.regex` | `string` | — | Java-compatible regular expression |
| `valid_regex` | `string` | `ExpectColumnValuesToMatchRegex` | Shorthand regex (no name); `valid_format` takes priority when both are set |
| `valid_min` | `float` | `ExpectColumnValuesToBeBetween` | Column value must be ≥ this (inclusive) |
| `valid_max` | `float` | `ExpectColumnValuesToBeBetween` | Column value must be ≤ this (inclusive) |
| `valid_min_length` | `int` | `ExpectColumnValueLengthsToBeBetween` | String length must be ≥ this |
| `valid_max_length` | `int` | `ExpectColumnValueLengthsToBeBetween` | String length must be ≤ this |
| `valid_length` | `int` | `ExpectColumnValueLengthsToBeBetween` | String length must be exactly this |
| `valid_values_column` | object | `ExpectColumnValuesToBeInSet` (runtime) | Values must exist in a reference column of another dataset |
| `valid_values_column.dataset` | `string` | — | FQN of the reference dataset |
| `valid_values_column.column` | `string` | — | Column name in the reference dataset |

#### Negative validity constraints (rows must NOT match)

| Parameter | Type | GX Expectation | Description |
|---|---|---|---|
| `invalid_values` | `list` | `ExpectColumnValuesToNotBeInSet` | Column value must NOT be one of these |
| `invalid_format` | object | `ExpectColumnValuesToNotMatchRegex` | Column value must NOT match a named regex |
| `invalid_format.name` | `string` | — | Human-readable label (documentation only) |
| `invalid_format.regex` | `string` | — | Java-compatible regular expression |
| `invalid_regex` | `string` | `ExpectColumnValuesToNotMatchRegex` | Shorthand negative regex; `invalid_format` takes priority |
| `invalid_values_column` | object | `ExpectColumnValuesToNotBeInSet` (runtime) | Values must NOT exist in a reference column of another dataset |
| `invalid_values_column.dataset` | `string` | — | FQN of the reference dataset |
| `invalid_values_column.column` | `string` | — | Column name in the reference dataset |

#### Examples

```yaml
# Valid format — email addresses only
- type: invalid
  name: "email must be a valid address"
  valid_format:
    name: Email
    regex: '^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$'

# Shorthand regex
- type: invalid
  name: "date must be ISO 8601"
  valid_regex: '^\d{4}-\d{2}-\d{2}$'

# Numeric range
- type: invalid
  name: "price must be positive and < 100 000"
  valid_min: 0
  valid_max: 100000

# Exact string length
- type: invalid
  name: "country_code must be 2 characters"
  valid_length: 2

# Cross-table reference (positive — value must exist)
- type: invalid
  name: "country_id must exist in COUNTRIES"
  valid_values_column:
    dataset: bronze/COUNTRIES
    column: id

# Cross-table reference (negative — value must NOT appear in blocklist)
- type: invalid
  name: "customer must not be on sanctions list"
  invalid_values_column:
    dataset: bronze/SANCTIONS
    column: customer_id

# Allow up to 2 % malformed values (warn only)
- type: invalid
  name: "phone format — allow up to 2 % malformed"
  valid_format:
    name: International phone
    regex: '^\+?[1-9]\d{7,14}$'
  threshold:
    metric: percent
    must_be_less_than: 2
    level: warn
```

---

### `duplicate` (column)

Verifies that a column contains no duplicate values.

```yaml
- type: duplicate
  name: "customer_id must be unique"
  threshold:
    must_be: 0
```

| Parameter | Type | Description |
|---|---|---|
| `threshold` | object | Default: 0 duplicates. Use `metric: percent` for a percentage of duplicate rows |

---

### `aggregate`

Verifies that an aggregate function result falls within a threshold.

```yaml
- type: aggregate
  name: "average order value must be between 50 and 500"
  function: avg           # avg | sum | min | max | count
  threshold:
    must_be_between:
      greater_than_or_equal: 50
      less_than_or_equal: 500
```

| Parameter | Type | Default | GX Expectation | Description |
|---|---|---|---|---|
| `function` | `avg` \| `sum` \| `min` \| `max` \| `count` | `avg` | `ExpectColumnMean/Sum/Min/MaxToBeBetween` | Aggregate function to apply to the column |
| `threshold` | object | required | — | Bounds for the aggregate result |

> **`count`**: counts non-null values in the column (Spark-side). All other functions use GX expectations.

---

### `freshness`

Verifies that the maximum value of a datetime column is recent enough.

```yaml
- type: freshness
  name: "data must be no older than 24 hours"
  unit: hour              # hour | day | minute | second
  threshold:
    must_be_less_than: 24
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `unit` | `hour` \| `day` \| `minute` \| `second` | `hour` | Time unit for the threshold |
| `threshold.must_be_less_than` | float | required | Maximum allowed age in the given unit |
| `column` | `string` | (column name) | At table-level, specifies which column to inspect |

---

### `contains`

Verifies that the column's set of distinct values contains **at least** all the specified values.

```yaml
- type: contains
  name: "status must have at least these values present"
  values: ["A", "I"]
```

| Parameter | Type | Description |
|---|---|---|
| `values` | `list` | Required distinct values that must be present in the column |

---

### `case_style`

Verifies that every value in a string column conforms to a naming convention.

```yaml
- type: case_style
  name: "country_code must be uppercase"
  style: upper
  threshold:
    must_be: 0
```

| `style` value | Match pattern | Examples |
|---|---|---|
| `lower` | `^[a-z0-9 _\-]+$` | `hello world`, `foo_bar` |
| `upper` | `^[A-Z0-9 _\-]+$` | `HELLO WORLD`, `FOO_BAR` |
| `title` | `^([A-Z][a-z0-9]* ?)+$` | `Hello World`, `Foo Bar` |
| `snake_case` | `^[a-z][a-z0-9_]*$` | `hello_world`, `foo_bar2` |
| `camel` | `^[a-z][a-zA-Z0-9]*$` | `helloWorld`, `fooBar` |
| `pascal` | `^[A-Z][a-zA-Z0-9]*$` | `HelloWorld`, `FooBar` |

| Parameter | Type | Description |
|---|---|---|
| `style` | string | One of the values in the table above |
| `threshold` | object | Default: 0 non-conforming rows. Use `metric: percent` for tolerance |

---

### `failed_rows`

Counts rows matching a SQL expression. Useful for complex business rules that don't fit standard check types.

```yaml
- type: failed_rows
  name: "end_date must be after start_date"
  expression: "end_date < start_date"   # SQL WHERE clause — rows matching this are failures
  threshold:
    must_be: 0
```

```yaml
# Full SQL query (returns the failing rows)
- type: failed_rows
  name: "no orphan order lines"
  query: "SELECT * FROM fact_order_lines WHERE order_id NOT IN (SELECT id FROM dim_orders)"
  threshold:
    must_be: 0
```

| Parameter | Type | Description |
|---|---|---|
| `expression` | `string` | SQL WHERE clause — rows evaluating to `true` are counted as failures |
| `query` | `string` | Full SQL query — the row count of the result is the failure count |
| `threshold` | object | Default: 0 failed rows |

> `expression` and `query` are mutually exclusive. `expression` is evaluated against the primary DataFrame; `query` runs against the full Spark catalog.

---

### `metric`

Evaluates an arbitrary SQL aggregate expression and checks the result against a threshold.

```yaml
- type: metric
  name: "no more than 5 % null rates across all text columns combined"
  expression: "SUM(CASE WHEN col1 IS NULL OR col2 IS NULL THEN 1 ELSE 0 END) * 100.0 / COUNT(*)"
  threshold:
    must_be_less_than: 5
```

```yaml
# Full SQL query — result of first column in first row is the metric
- type: metric
  name: "distinct country count must be > 100"
  query: "SELECT COUNT(DISTINCT country_code) FROM silver/dim_customer"
  threshold:
    must_be_greater_than: 100
```

| Parameter | Type | Description |
|---|---|---|
| `expression` | `string` | SQL aggregate expression evaluated via `df.selectExpr(expr)` |
| `query` | `string` | Full SQL query — first column of first row is the metric |
| `threshold` | object | Required bounds for the result |

---

## Table-level checks

Declared under the top-level `checks:` key (not inside a `columns:` entry).

### `row_count`

```yaml
checks:
  - type: row_count
    name: "table must have at least 1 000 rows"
    threshold:
      must_be_greater_than_or_equal: 1000
```

| Parameter | Type | Description |
|---|---|---|
| `threshold` | object | Required — bounds for the row count |

---

### `schema`

Verifies column existence, set, order, and/or naming conventions.

```yaml
checks:
  - type: schema
    name: "required columns must exist"
    allow_extra_columns: true       # true (default) — extra columns are allowed
    allow_other_column_order: true  # true (default) — column order is not enforced
    column_name_regex: '^[a-z][a-z0-9_]*$'   # every column name must match this pattern
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `allow_extra_columns` | `bool` | `true` | When `false`, the table must have exactly the columns declared in `columns:` — no more |
| `allow_other_column_order` | `bool` | `true` | When `false` (and `allow_extra_columns: false`), column order must also match exactly |
| `column_name_regex` | `string` | — | Java regex — every actual column name in the DataFrame must fully match this pattern |

> The `schema` check uses the columns declared in the `columns:` block as the expected column set.  
> `column_name_regex` is evaluated Spark-side (not via GX).

---

### `duplicate` (multi-column)

Verifies that the combination of the listed columns is unique.

```yaml
checks:
  - type: duplicate
    name: "no duplicate (order_id, line_id) combinations"
    columns: [order_id, line_id]
    threshold:
      must_be: 0
```

| Parameter | Type | Description |
|---|---|---|
| `columns` | `list[string]` | Required — the combination of these columns must be unique |

---

### `freshness` (table-level)

Same as column-level freshness but declared at table level. Requires `column` to identify the datetime column.

```yaml
checks:
  - type: freshness
    name: "table must be refreshed every 24 hours"
    column: updated_at
    unit: hour
    threshold:
      must_be_less_than: 24
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `column` | `string` | required | Datetime column to measure |
| `unit` | `hour` \| `day` \| `minute` \| `second` | `hour` | Time unit |
| `threshold.must_be_less_than` | float | required | Maximum allowed age |

---

### `failed_rows` (table-level)

Identical behaviour to column-level `failed_rows` — `expression` runs against the full table DataFrame or `query` runs against the Spark catalog.

```yaml
checks:
  - type: failed_rows
    name: "no order lines without a parent order"
    query: "SELECT * FROM fact_lines WHERE order_id NOT IN (SELECT id FROM dim_orders)"
    threshold:
      must_be: 0
```

---

### `metric` (table-level)

Identical to column-level `metric`.

```yaml
checks:
  - type: metric
    name: "at least 50 distinct countries"
    expression: "COUNT(DISTINCT country_code)"
    threshold:
      must_be_greater_than_or_equal: 50
```

---

## Reconciliation

The `reconciliation:` block compares the primary dataset against one or more secondary datasets (from any workspace). Results appear as additional `CheckResult` entries in `ScanResult`.

### Full example

```yaml
reconciliation:
  sources:
    - name: silver            # alias used in checks below
      dataset: silver_lh/dim_customer
      workspace_name: "BI4ALL - CoE - SalesProject-PRD"   # optional — defaults to data workspace
      filter: "status = 'A'"  # optional — WHERE filter applied to this source when loading
      source: tables          # "tables" (default) | "files"
      format: parquet         # only relevant when source: files
      format_options: {}      # forwarded to spark.read.options()
      files_since: null       # ISO datetime — null = latest partition only

  checks:
    - type: row_count_diff
      source: silver
      name: "Row count must match silver"
      filter: "region = 'EU'"   # optional — applied to BOTH sides before comparing
      threshold:
        must_be_less_than_or_equal: 0
      level: fail

    - type: aggregate_diff
      source: silver
      name: "Average age must not differ by more than 1"
      column: age
      function: avg             # avg | sum | min | max | count
      threshold:
        must_be_less_than_or_equal: 1

    - type: metric_diff
      source: silver
      name: "Distinct country count must match"
      expression: "COUNT(DISTINCT country_code)"
      threshold:
        must_be_less_than_or_equal: 0

    - type: rows_diff
      source: silver
      name: "No value differences for key customer fields"
      key_columns: [customer_id]     # join key — must uniquely identify rows
      columns: [name, email, status] # value columns to compare; omit = all shared non-key columns
      threshold:
        must_be_less_than_or_equal: 0
      level: warn
```

### `sources` parameters

| Parameter | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Alias used to reference this source in `checks` |
| `dataset` | `string` | required | FQN of the secondary dataset |
| `workspace_name` | `string` | data workspace | Display name of the workspace — enables cross-workspace comparison |
| `filter` | `string` | — | SQL WHERE applied when loading this source |
| `source` | `tables` \| `files` | `tables` | Whether to read from Lakehouse Tables or Files |
| `format` | `string` | `parquet` | Spark reader format when `source: files` |
| `format_options` | object | `{}` | Key-value pairs forwarded to `spark.read.options()` |
| `files_since` | `string` | — | ISO datetime — load all partitions at or after this timestamp |

### `checks` parameters (common)

| Parameter | Type | Default | Description |
|---|---|---|---|
| `type` | `string` | required | `row_count_diff` \| `aggregate_diff` \| `metric_diff` \| `rows_diff` |
| `source` | `string` | required | Name of an entry in `sources` |
| `name` | `string` | auto | Human-readable label shown in the report |
| `filter` | `string` | — | SQL WHERE applied to **both** primary and source before comparing |
| `threshold` | object | 0 | Bounds for the computed difference |
| `level` | `fail` \| `warn` | `fail` | Severity when the threshold is breached |

### Reconciliation check types

#### `row_count_diff`

Computes `abs(primary_count - source_count)` and applies the threshold.

```yaml
- type: row_count_diff
  source: silver
  threshold:
    must_be_less_than_or_equal: 0   # exact match
```

Use `metric: percent` to compare relative to the primary row count:

```yaml
- type: row_count_diff
  source: silver
  threshold:
    metric: percent
    must_be_less_than: 1   # less than 1 % difference
```

#### `aggregate_diff`

Computes `abs(agg_primary - agg_source)` for the given aggregate function on the given column.

```yaml
- type: aggregate_diff
  source: silver
  column: revenue
  function: sum             # avg | sum | min | max | count
  threshold:
    must_be_less_than_or_equal: 0.01
```

#### `metric_diff`

Evaluates a free-form SQL expression on both sides and computes the absolute difference.

```yaml
- type: metric_diff
  source: silver
  expression: "COUNT(DISTINCT customer_id)"
  threshold:
    must_be_less_than_or_equal: 0
```

#### `rows_diff`

Performs a full outer join on `key_columns` and counts:
- Rows present on one side but missing on the other
- Rows where any of the `columns` values differ

```yaml
- type: rows_diff
  source: silver
  key_columns: [customer_id]
  columns: [name, email, country_code]   # omit to compare all shared non-key columns
  threshold:
    must_be_less_than_or_equal: 0
```

---

## Row flagging

When `flag_rows=True`, two columns are added to the DataFrame:

| Column | Type | Meaning |
|---|---|---|
| `_dq_failed` | `boolean` | `true` if at least one check failed for this row |
| `_dq_failed_checks` | `string` | Comma-joined names of failing checks for this row |

**Which checks produce row flags:**

| Check type | Row expression |
|---|---|
| `missing` | `col IS NULL` (plus `missing_values` / `missing_format`) |
| `invalid` (valid_values) | `col NOT IN (...)` |
| `invalid` (valid_format/regex) | `col NOT RLIKE 'pattern'` |
| `invalid` (valid_min/max) | `col < min OR col > max` |
| `duplicate` | `COUNT(*) OVER (PARTITION BY col) > 1` |
| `failed_rows` | SQL expression from contract |
| `aggregate`, `freshness`, `row_count`, `schema`, `metric`, `reconciliation` | not row-applicable — skipped |

Source Delta tables are never modified — flags live in the in-memory `ScanResult.flagged_df`.

```python
result = runner.run(flag_rows=True)
# result.flagged_df  — all rows + _dq_failed, _dq_failed_checks
```

---

## Remediation actions

Each check can declare an `on_fail:` block specifying what to do with failing rows.

```yaml
columns:
  - name: customer_id
    checks:
      - type: duplicate
        name: "no duplicate customer_id"
        on_fail:
          action: deduplicate
          order_by: updated_at   # sort column — keep first/last in this order
          keep: last             # "first" | "last"

  - name: email
    checks:
      - type: missing
        name: "email must not be null"
        on_fail:
          action: fill
          value: "unknown@placeholder.com"

  - name: status
    checks:
      - type: invalid
        name: "status must be valid"
        valid_values: [A, I, P]
        on_fail:
          action: quarantine     # failing rows → result.quarantined_df

  - name: price
    checks:
      - type: invalid
        name: "price must be positive"
        valid_min: 0
        on_fail:
          action: drop           # removed entirely — not in repaired_df or quarantined_df
```

| Action | `on_fail.action` | Effect |
|---|---|---|
| Flag only | `flag_only` | Default when `on_fail` is omitted — rows flagged but not changed |
| Deduplicate | `deduplicate` | Keep first/last row per group ordered by `order_by`; survivors go to `repaired_df` |
| Fill | `fill` | Replace null/invalid value with `value`; fixed rows go to `repaired_df` |
| Drop | `drop` | Remove failing rows — not present in either `repaired_df` or `quarantined_df` |
| Quarantine | `quarantine` | Route failing rows to `quarantined_df`; excluded from `repaired_df` |

```python
result = runner.run(flag_rows=True, apply_actions=True)
# result.repaired_df    — clean + auto-fixed rows
# result.quarantined_df — rows needing manual review
```

---

## Test suites

A **test suite** is a YAML file listing which contracts to run together.  
Suite files live in `Files/suites/` in the project Bronze Lakehouse.

```yaml
# Files/suites/daily_critical.yaml
name: daily_critical
description: "Critical tables validated before morning reports"
on_missing_contract: fail   # "fail" | "warn"
contracts:
  - dim_customer.yaml
  - fact_sales.yaml
```

| Field | Values | Description |
|---|---|---|
| `name` | string | Suite identifier |
| `description` | string | Optional human-readable description |
| `on_missing_contract` | `fail` \| `warn` | `fail` raises immediately; `warn` skips the missing contract and continues |

### Using suites in the notebook

```python
SUITE_NAME = "daily_critical"   # run only the contracts in this suite
SUITE_NAME = None               # run all contracts discovered in Files/contracts/
```

### Programmatic use

```python
from ouroboros_gx import load_suite, discover_suites, DQRunner

suites = discover_suites(contract_workspace_name="BI4ALL - CoE - SalesProject-PRD", lakehouse_name="bronze")
# → ["daily_critical", "full", "smoke"]

urls = load_suite(
    contract_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    lakehouse_name="bronze",
    suite_name="daily_critical",
)

for url in urls:
    result = DQRunner(url).run(flag_rows=True)
```

---

## Usage

### Discover and run all contracts

Use `discover_contracts()` to list every YAML contract in a Lakehouse folder,
then iterate and run each one with `DQRunner`:

```python
from ouroboros_gx import DQRunner, discover_contracts
from ouroboros_gx.result_reporter import display_results

# Returns one abfss:// URL per .yaml file found under Files/dataquality/contracts/
urls = discover_contracts(
    contract_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    lakehouse_name="bronze",
    folder="dataquality/contracts",   # default
)

results = []
for url in urls:
    result = DQRunner(
        url,
        data_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    ).run(flag_rows=True)
    display_results(result)
    results.append(result)
```

Pass `contract_workspace_name=None` (or omit it) to auto-detect the current workspace
via `mssparkutils`:

```python
urls = discover_contracts(contract_workspace_name=None, lakehouse_name="bronze")
for url in urls:
    result = DQRunner(url).run(flag_rows=True)
    display_results(result)
```

---

### Run a contract from the project Lakehouse (ABFS)

```python
from ouroboros_gx import DQRunner
from ouroboros_gx.result_reporter import display_results

runner = DQRunner(
    "dim_customer.yaml",
    data_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    contract_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    contract_lakehouse_name="bronze",
    variables={"FILTER_START_TIME": "2024-01-01 00:00:00"},
)
result = runner.run(flag_rows=True)
display_results(result)
```

Or set `CONTRACT_WORKSPACE_NAME` / `DATA_WORKSPACE_NAME` as Fabric Environment variables:

```python
runner = DQRunner("dim_customer.yaml", variables={"FILTER_START_TIME": "2024-01-01"})
result = runner.run(flag_rows=True)
display_results(result)
```

### Run from the local filesystem (embedded / dev)

```python
runner = DQRunner("contracts/dim_customer.yaml")
result = runner.run()
```

### Inline notebook check (no contract file)

```python
from ouroboros_gx import run_inline
from ouroboros_gx.result_reporter import display_results

result = run_inline(
    df,
    {
        "dataset": "prices",
        "columns": [
            {
                "name": "price",
                "checks": [
                    {"type": "missing", "name": "price must not be null"},
                    {"type": "invalid", "name": "price must be positive", "valid_min": 0},
                ],
            }
        ],
    },
    flag_rows=True,
)
display_results(result)
```

### Persist results to the DQ engine workspace

See the [Persistent logs](#persistent-logs) section for the full API reference and table schemas.

```python
from ouroboros_gx import persist_results

run_id = persist_results(
    result,
    dq_workspace_name="BI4ALL - CoE - DataQuality-PRD",
    dq_lakehouse_name="gold",
    data_workspace_name="BI4ALL - CoE - SalesProject-PRD",
    data_lakehouse_name="bronze",
    persist_flagged_rows=True,
    persist_quarantined=True,
    dataset_source=runner.contract.source,
)
print(f"run_id: {run_id}")
```

### Project suite runner

Open `notebooks/suite_runner.ipynb` and configure the first cell — then run all cells.  
The notebook discovers contracts (or loads a named suite), runs each one, displays results, and writes to the central DQ engine workspace.

---

## Persistent logs

`persist_results()` writes up to three categories of Delta tables to the DQ engine Lakehouse.

### Storage layout

```
DQ Engine — Gold Lakehouse
└── Tables/
    └── dbo/
        └── dq_results                        ← shared across all contracts

Data Workspace — Contract Lakehouse (e.g. bronze)
└── Tables/
    ├── dq_flagged/
    │   ├── silver_dim_customer               ← one table per dataset
    │   ├── bronze_lu_cash_flow_security_trade
    │   └── …
    └── dq_quarantined/
        ├── silver_dim_customer
        └── …
```

Fabric exposes these as:
- `dbo.dq_results` (DQ engine Gold Lakehouse)
- `dq_flagged.silver_dim_customer` (data workspace contract Lakehouse)
- `dq_quarantined.silver_dim_customer` (data workspace contract Lakehouse)

Dataset table names are derived by replacing every non-alphanumeric character in the FQN with `_` and lowercasing:

| Dataset FQN | Delta table name |
|---|---|
| `silver/dim_customer` | `silver_dim_customer` |
| `bronze/lu/cash_flow_security_trade` | `bronze_lu_cash_flow_security_trade` |
| `silver.dbo.fact_sales` | `silver_dbo_fact_sales` |

---

### `dq_results` schema

One row per check per run. Written on every `persist_results()` call.

| Column | Type | Nullable | Description |
|---|---|---|---|
| `run_id` | `string` | No | UUID grouping all checks from a single execution |
| `run_timestamp` | `string` | No | ISO 8601 UTC timestamp of when `persist_results` was called |
| `data_workspace_id` | `string` | Yes | GUID of the data workspace that produced the data |
| `data_lakehouse_name` | `string` | Yes | Name of the data Lakehouse where flagged/quarantined rows are stored |
| `dataset` | `string` | No | Full dataset FQN from the contract (e.g. `silver/dim_customer`) |
| `layer` | `string` | Yes | Lakehouse portion of the FQN (e.g. `silver`) |
| `schema_name` | `string` | Yes | Schema portion of the FQN (e.g. `dbo`), or `null` for two-part FQNs |
| `check_name` | `string` | Yes | Human-readable check name (`name:` from the contract, or auto-generated) |
| `check_type` | `string` | No | GX expectation type string or custom type (e.g. `expect_column_values_to_not_be_null`) |
| `column_name` | `string` | Yes | Column the check applies to, or `null` for table-level checks |
| `success` | `boolean` | No | `true` if the check passed |
| `level` | `string` | No | `fail` or `warn` |
| `observed_value` | `string` | Yes | Observed metric value (cast to string) |
| `unexpected_count` | `long` | Yes | Number of rows that violated the expectation (GX checks only) |
| `unexpected_percent` | `double` | Yes | Percentage of rows that violated the expectation (GX checks only) |
| `engine_version` | `string` | Yes | `ouroboros-gx` package version used for this run |

---

### `dq_flagged/<dataset>` schema

Contains rows from the primary DataFrame where `_dq_failed = true`, enriched with run metadata. The column set is the **original dataset columns** plus the three metadata columns below. Schema differs per dataset — each has its own table.

| Extra column | Type | Description |
|---|---|---|
| `_dq_failed` | `boolean` | Always `true` in this table (filter already applied) |
| `_dq_failed_checks` | `string` | Comma-joined names of failing checks for this row |
| `run_id` | `string` | UUID matching `dq_results.run_id` |
| `run_timestamp` | `string` | ISO 8601 UTC timestamp |
| `dataset` | `string` | Dataset FQN |

Requires `runner.run(flag_rows=True)` and `persist_results(persist_flagged_rows=True)`.

---

### `dq_quarantined/<dataset>` schema

Contains rows routed by a `quarantine` remediation action, enriched with run metadata. Same per-dataset layout as `dq_flagged`.

| Extra column | Type | Description |
|---|---|---|
| `run_id` | `string` | UUID matching `dq_results.run_id` |
| `run_timestamp` | `string` | ISO 8601 UTC timestamp |
| `dataset` | `string` | Dataset FQN |

Requires `runner.run(apply_actions=True)` and `persist_results(persist_quarantined=True)`.

---

### `persist_results()` API

```python
from ouroboros_gx import persist_results

run_id = persist_results(
    result,                                              # ScanResult from runner.run()
    dq_workspace_name="BI4ALL - CoE - DataQuality-PRD", # DQ engine workspace → dq_results
    dq_lakehouse_name="gold",                            # Lakehouse inside that workspace
    table_name="dq_results",                             # dq_results table name (default)
    data_workspace_name="BI4ALL - CoE - SalesProject-PRD",  # data workspace → flagged/quarantined
    data_lakehouse_name="bronze",                        # Lakehouse for flagged/quarantined rows
    run_id=None,                 # auto-generate UUID (or supply your own for correlation)
    persist_flagged_rows=True,   # write dq_flagged/<dataset>
    flagged_schema="dq_flagged", # schema name for flagged tables (default)
    persist_quarantined=True,    # write dq_quarantined/<dataset>
    quarantined_schema="dq_quarantined",  # schema name for quarantined tables (default)
    dataset_source=runner.contract.source,  # "tables" or "files" — affects FQN parsing
)
```

| Parameter | Type | Default | Description |
|---|---|---|---|
| `dq_workspace_name` | `string` | auto | Display name of the DQ engine workspace. Falls back to the current workspace. |
| `dq_lakehouse_name` | `string` | required | Lakehouse inside the DQ engine workspace where `dq_results` is written (e.g. `gold`) |
| `table_name` | `string` | `dq_results` | Delta table name for per-check results |
| `data_workspace_name` | `string` | auto | Display name of the data / project workspace — flagged and quarantined rows are written here |
| `data_lakehouse_name` | `string` | contract FQN lakehouse | Lakehouse in the data workspace for flagged/quarantined rows |
| `run_id` | `string` | auto UUID | Supply your own UUID to correlate checks across multiple calls |
| `persist_flagged_rows` | `bool` | `False` | Write flagged rows to `dq_flagged/<dataset>` |
| `flagged_schema` | `string` | `dq_flagged` | Schema name for flagged-rows tables |
| `persist_quarantined` | `bool` | `False` | Write quarantined rows to `dq_quarantined/<dataset>` |
| `quarantined_schema` | `string` | `dq_quarantined` | Schema name for quarantined-rows tables |
| `dataset_source` | `string` | `tables` | Pass `"files"` for file-based contracts so compound FQNs parse correctly |

---

### Example queries

```sql
-- All failed checks in the last 7 days
SELECT run_timestamp, dataset, check_name, check_type, column_name,
       observed_value, unexpected_count, unexpected_percent
FROM   dbo.dq_results
WHERE  success = false
  AND  level   = 'fail'
  AND  run_timestamp >= DATEADD(day, -7, GETUTCDATE())
ORDER  BY run_timestamp DESC;

-- Pass rate per dataset over time
SELECT dataset,
       DATE_TRUNC('day', CAST(run_timestamp AS TIMESTAMP)) AS run_date,
       ROUND(SUM(CASE WHEN success THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 1) AS pass_pct
FROM   dbo.dq_results
GROUP  BY 1, 2
ORDER  BY 2 DESC, 1;

-- Flagged rows for a specific dataset + run
SELECT *
FROM   dq_flagged.silver_dim_customer
WHERE  run_id = '<your-run-id>';

-- Quarantined rows awaiting manual review
SELECT *
FROM   dq_quarantined.silver_dim_customer
ORDER  BY run_timestamp DESC
LIMIT  100;
```

---

## Cross-table validation

When using `valid_values_column` (positive) or `invalid_values_column` (negative), the runner loads the reference table at validation time and collects distinct non-null values.

```yaml
# Positive — value must exist in the reference column
- type: invalid
  name: "country_id must exist in COUNTRIES"
  valid_values_column:
    dataset: bronze/COUNTRIES
    column: id
  threshold:
    metric: percent
    must_be_less_than: 5

# Negative — value must NOT be in the blocklist
- type: invalid
  name: "customer must not be on the sanctions list"
  invalid_values_column:
    dataset: bronze/SANCTIONS
    column: customer_id
  threshold:
    must_be: 0
```

> **Warning:** This collects all distinct values from the reference column to the driver.  
> Avoid on very high-cardinality columns — consider a smaller reference view instead.

---

## Legacy check names

These names are still accepted for backward compatibility. They are normalised transparently before execution.

| Legacy name | Normalises to |
|---|---|
| `no_missing_values` | `missing` |
| `no_duplicate_values` | `duplicate` |
| `no_invalid_values` | `invalid` |
| `rows_exist` | `row_count` (min ≥ 1) |
| `freshness_in_hours` | `freshness` (unit=hour) |
| `missing_percent` | `missing` (metric=percent) |
| `invalid_percent` | `invalid` (metric=percent) |
| `avg` | `aggregate` (function=avg) |
| `min` | `aggregate` (function=min) |
| `max` | `aggregate` (function=max) |
