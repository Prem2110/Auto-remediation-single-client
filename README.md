# SAP CPI Self-Healing Agent

[![Python Version](https://img.shields.io/badge/python-3.13%2B-blue.svg)](https://www.python.org/downloads/)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.128.5-009688.svg)](https://fastapi.tiangolo.com/)
[![LangChain](https://img.shields.io/badge/LangChain-1.2.9-brightgreen.svg)](https://langchain.com/)
[![HANA Cloud](https://img.shields.io/badge/SAP%20HANA-Cloud-blue.svg)](https://www.sap.com/products/technology-platform/hana.html)

An intelligent, autonomous SAP Cloud Platform Integration (CPI) monitoring and self-healing system powered by AI. The system automatically detects failed integration messages, performs AI-driven Root Cause Analysis, and applies fixes to iFlows — with no manual intervention required.

---

## Features

### Core Capabilities

- **Autonomous Error Detection** — Continuously polls SAP CPI for failed messages and runtime artifact errors
- **AI Root Cause Analysis (RCA)** — LangChain agent analyses errors using message logs, SAP notes from vector store, HANA knowledge base, and rule-based classifier
- **Self-Healing Fix Pipeline** — Downloads iFlow config, applies AI-generated fix, updates and deploys — with automatic unlock handling and retry logic
- **iFlow Example Reference** — Agent calls `list-iflow-examples` / `get-iflow-example` (MCP) to use stored S3 components as structural reference for complex fixes
- **Deleted iFlow Detection** — Pre-flight verification prevents wasted fix attempts on deleted artifacts; marks incidents as `ARTIFACT_DELETED`
- **HANA Vector Store Integration** — Cosine similarity search over `SAP_HELP_DOCS` (20,000+ scraped SAP notes, 3072-dim embeddings) retrieves top 5 relevant notes to enrich RCA context
- **Internal Escalation Tickets** — Low-confidence incidents are escalated as tickets stored in HANA (`ESCALATION_TICKETS` table) — no external ticketing system required
- **Smart Monitoring API** — Full REST backend for real-time monitoring UI (incidents, drill-down, apply fix, retry messages)
- **Dashboard API** — KPI cards, charts, leaderboards, and drill-downs for analytics dashboard
- **Conversational Chatbot** — Natural language interface; detects fix intent and triggers full RCA → fix → deploy pipeline automatically
- **Fix Pattern Learning** — Successful fixes are stored and reused for recurring errors via error signature matching
- **Live Fix Progress** — In-memory step tracker (FIX_PROGRESS store) provides granular pipeline progress without HANA polling
- **Runtime Configuration** — Toggle auto-fix enabled/disabled via API without service restart
- **Locked Artifact Handling** — Automatic unlock attempts via multiple API methods before fix application
- **Recurring Incident Correlation** — Deduplicates errors by signature and resumes fix flow for recurring failures
- **Background Task Processing** — Non-blocking fix application and RCA execution via FastAPI background tasks
- **Direct Fix API** — Apply fixes directly by iflow_id + error message without requiring existing incident
- **Retry Failed Fixes** — Re-run failed fix pipeline up to 3 times; smart retry skips already-completed stages (deploy-only for `FIX_FAILED_DEPLOY`) and re-runs RCA when confidence is low
- **iFlow Rollback** — Restore iFlow to pre-fix snapshot (`iflow_snapshot_before`) via `update-iflow` + `deploy-iflow` when a fix causes regressions
- **Enhanced Error Details** — Fetches deployment error information from runtime artifacts when fixes fail
- **Test Incident Injection** — Synthetic incident creation for end-to-end pipeline testing

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                      FastAPI Application (port 8080)                  │
│                                                                        │
│  ┌─────────────┐   ┌──────────────────────┐   ┌───────────────────┐  │
│  │ Chatbot API │   │ Smart Monitoring API │   │  Dashboard API    │  │
│  │ /query /fix │   │ /smart-monitoring/   │   │  /dashboard/      │  │
│  └──────┬──────┘   └──────────┬───────────┘   └────────┬──────────┘  │
│         └─────────────────────┴─────────────────────────┘             │
│                               │                                        │
│         ┌─────────────────────▼──────────────────────────────────┐    │
│         │                  MultiMCP Manager                        │    │
│         │   LangChain Agent · MCP Tools · RCA Engine              │    │
│         │   Autonomous Loop · Session Memory · Fix Progress        │    │
│         └──────┬─────────────────┬──────────────────┬─────────────┘    │
└────────────────┼─────────────────┼──────────────────┼──────────────────┘
                 │                 │                  │
    ┌────────────▼──────┐  ┌───────▼───────┐  ┌──────▼────────────┐
    │ Integration Suite │  │  iFlow Test   │  │  Documentation    │
    │      MCP          │  │     MCP       │  │      MCP          │
    │ get/update/deploy │  │ test/validate │  │  spec/templates   │
    │ list/get-examples │  │               │  │                   │
    └───────────────────┘  └───────────────┘  └───────────────────┘
                 │
    ┌────────────▼──────────────────────────────────────────┐
    │            SAP Integration Suite (OData API)           │
    └────────────────────────────────────────────────────────┘

External Services:
┌──────────────────────┐  ┌───────────────────┐  ┌──────────────────────┐
│    SAP HANA Cloud    │  │   SAP AI Core     │  │       AWS S3         │
│  Incidents · History │  │  LLM (GPT-5.2)    │  │  File uploads        │
│  Fix patterns        │  │  text-embedding   │  │  iFlow examples      │
│  SAP_HELP_DOCS       │  │  -3-large (3072d) │  │  (structural ref)    │
│  Escalation tickets  │  │                   │  │                      │
└──────────────────────┘  └───────────────────┘  └──────────────────────┘
```

### MCP Servers

| Server | Responsibility |
|---|---|
| `integration_suite` | iFlow get / update / deploy / unlock, message logs, iFlow examples (list + fetch from S3) |
| `mcp_testing` | Test execution, iFlow validation, test reports |
| `documentation_mcp` | SAP standard docs, spec generation, templates |

---

## Prerequisites

- Python 3.13+
- SAP BTP account with Integration Suite access
- SAP AI Core deployment (LLM + `text-embedding-3-large` embedding model)
- SAP HANA Cloud database instance
- AWS S3 bucket (for file uploads and iFlow example storage)
- The three MCP servers deployed and reachable
- Playwright Chromium browser (for `scrape_sap_docs.py` — install via `uv run playwright install chromium`)

---

## Installation

### 1. Clone the repository

```bash
git clone <repo-url>
cd auto-remediation
```

### 2. Install dependencies

Using uv (recommended):
```bash
uv add -r requirements.txt
```

Or pip:
```bash
pip install -r requirements.txt
```

### 3. Configure environment variables

Create a `.env` file in the project root.

Legend: `[REQUIRED]` must be set or the app will not start / feature will not work. `[OPTIONAL]` has a safe default or enables a non-critical feature.

```env
# ── SAP AI Core ── [REQUIRED] ─────────────────────────────────────────
AICORE_CLIENT_ID=your_client_id
AICORE_CLIENT_SECRET=your_client_secret
AICORE_AUTH_URL=https://your-tenant.authentication.region.hana.ondemand.com
AICORE_BASE_URL=https://api.ai.prod.region.aws.ml.hana.ondemand.com/v2
AICORE_RESOURCE_GROUP=default
LLM_DEPLOYMENT_ID=your_llm_deployment_id

# ── LangSmith Tracing ── [OPTIONAL] ──────────────────────────────────
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=your_langsmith_key
LANGSMITH_PROJECT=your_project_name

# ── SAP Integration Suite — Runtime API ── [REQUIRED] ────────────────
API_BASE_URL=https://your-tenant.it-cpi019.cfapps.region.hana.ondemand.com/api/v1
API_OAUTH_CLIENT_ID=your_client_id
API_OAUTH_CLIENT_SECRET=your_client_secret
API_OAUTH_TOKEN_URL=https://your-tenant.authentication.region.hana.ondemand.com/oauth/token

# ── SAP Integration Suite — Monitor / CPI Runtime ── [REQUIRED] ──────
CPI_BASE_URL=https://your-tenant.it-cpi019-rt.cfapps.region.hana.ondemand.com
CPI_OAUTH_CLIENT_ID=your_client_id
CPI_OAUTH_CLIENT_SECRET=your_client_secret
CPI_OAUTH_TOKEN_URL=https://your-tenant.authentication.region.hana.ondemand.com/oauth/token

# ── SAP Integration Suite — Design Time ── [REQUIRED] ────────────────
SAP_DESIGN_TIME_URL=https://your-tenant.it-cpi019.cfapps.region.hana.ondemand.com
SAP_DESIGN_TIME_TOKEN_URL=https://your-tenant.authentication.region.hana.ondemand.com/oauth/token
SAP_DESIGN_TIME_CLIENT_ID=your_client_id
SAP_DESIGN_TIME_CLIENT_SECRET=your_client_secret

# ── SAP Hub — Autonomous Error Polling ── [REQUIRED] ─────────────────
SAP_HUB_TENANT_URL=https://your-tenant.it-cpi019.cfapps.region.hana.ondemand.com
SAP_HUB_TOKEN_URL=https://your-tenant.authentication.region.hana.ondemand.com/oauth/token
SAP_HUB_CLIENT_ID=your_client_id
SAP_HUB_CLIENT_SECRET=your_client_secret

# ── MCP Servers ── [REQUIRED] ─────────────────────────────────────────
MCP_INTEGRATION_SUITE_URL=https://your-integration-suite-mcp.cfapps.region.hana.ondemand.com/mcp
MCP_TESTING_URL=https://your-testing-mcp.cfapps.region.hana.ondemand.com/mcp
MCP_DOCUMENTATION_URL=https://your-documentation-mcp.cfapps.region.hana.ondemand.com/mcp

# ── SAP HANA Cloud ── [REQUIRED] ──────────────────────────────────────
HANA_HOST=your-guid.hna0.prod-region.hanacloud.ondemand.com
HANA_PORT=443
HANA_USER=your_hdi_rt_user
HANA_PASSWORD=your_password
HANA_SCHEMA=your_schema
HANA_TABLE_QUERY_HISTORY=MCP_QUERY_HISTORY
HANA_TABLE_USER_FILES=USER_FILES_METADATA
HANA_TABLE_XSD_FILES=SAP_IS_XSD_FILES
HANA_TABLE_VECTOR=SAP_HELP_DOCS          # table used for vector/RCA search
HANA_TABLE_SAP_DOCS=SAP_HELP_DOCS        # table written to by scrape_sap_docs.py

# ── AWS S3 Object Store ── [REQUIRED for file uploads & iFlow examples]
BUCKET_NAME=your_bucket_name
REGION=us-east-1
ENDPOINT_URL=https://s3.amazonaws.com
OBJECT_STORE_ENDPOINT=https://s3.amazonaws.com/
OBJECT_STORE_ACCESS_KEY=your_access_key
OBJECT_STORE_SECRET_KEY=your_secret_key
WRITE_ACCESS_KEY_ID=your_write_key_id
WRITE_SECRET_ACCESS_KEY=your_write_secret
READ_ACCESS_KEY_ID=your_read_key_id
READ_SECRET_ACCESS_KEY=your_read_secret

# ── Autonomous Operations ── [OPTIONAL — defaults shown] ─────────────
AUTONOMOUS_ENABLED=false
POLL_INTERVAL_SECONDS=60
AUTO_FIX_CONFIDENCE=0.90
SUGGEST_FIX_CONFIDENCE=0.70
USE_REAL_FIXES=true
FAILED_MESSAGES_PAGE_SIZE=400
FAILED_MESSAGES_MAX_TOTAL=50000
MAX_CONSECUTIVE_FAILURES=5
PENDING_APPROVAL_TIMEOUT_HRS=24
PATTERN_MIN_SUCCESS_COUNT=2
BURST_DEDUP_WINDOW_SECONDS=60

# ── Escalation Tickets ── [OPTIONAL] ─────────────────────────────────
TICKET_DEFAULT_ASSIGNEE=team@example.com   # leave blank to assign no default

# ── Server & Logging ── [OPTIONAL — defaults shown] ──────────────────
API_HOST=0.0.0.0
API_PORT=8080
LOG_LEVEL=DEBUG
ENABLE_CONSOLE_LOGS=false

# ── File Upload ── [OPTIONAL — default: user] ─────────────────────────
UPLOAD_ROOT=user

# ── SAP Notes Scraper ── [REQUIRED only for scrape_sap_docs.py] ──────
SAP_USERNAME=your_sap_user@example.com
SAP_PASSWORD=your_sap_password
SAP_NOTE_CONCURRENCY=10       # parallel Playwright pages (default: 5)
SAP_NOTE_DELAY=0.3            # seconds between page requests (default: 1.0)

# ── Embeddings ── [REQUIRED only for vectorize_docs.py] ──────────────
EMBEDDING_DEPLOYMENT_ID=your_embedding_deployment_id
EMBEDDING_MODEL_NAME=text-embedding-3-large
VECTOR_DIMENSION=3072
```

### 4. Build the SAP Notes knowledge base (one-time setup)

Install Playwright browsers (required for scraping):
```bash
uv run playwright install chromium
```

Scrape SAP Notes from me.sap.com (split your URL list into files of ~500):
```bash
uv run scrape_sap_docs.py --notes-only --notes-file sap_notes_1.txt
uv run scrape_sap_docs.py --notes-only --notes-file sap_notes_2.txt
# ... repeat for each file
```

Vectorize all scraped notes (run once after scraping is complete):
```bash
uv run vectorize_docs.py
```

Both scripts are crash-safe — re-run at any time to resume from where they left off.

### 5. Run the server

```bash
uvicorn main:app --host 0.0.0.0 --port 8080 --reload
```

API docs available at:
- Swagger UI: `http://localhost:8080/docs`
- ReDoc: `http://localhost:8080/redoc`

---

## Project Structure

```
auto-remediation/
├── main.py                        # FastAPI app, MultiMCP manager, autonomous loop
├── smart_monitoring.py            # /smart-monitoring/* router
├── smart_monitoring_dashboard.py  # /dashboard/* router
├── generate_dashboard_pdf.py      # PDF report export
│
├── config/
│   └── config.py                  # Settings loaded from .env
│
├── db/
│   └── database.py                # SAP HANA Cloud abstraction (CRUD for all tables)
│
├── storage/
│   ├── storage.py                 # File uploads + XSD detection
│   └── object_store.py            # AWS S3 operations (read/write, separate credentials)
│
├── utils/
│   ├── utils.py                   # HANA timestamp helpers
│   ├── logger_config.py           # Rotating file logger setup
│   ├── vector_store.py            # HANA SAP_HELP_DOCS cosine similarity search for RCA
│   └── xsd_handler.py             # XSD parsing and validation
│
├── rules/                         # Coding standards for Claude Code
│   ├── coding-style.md
│   ├── testing.md
│   └── security.md
│
├── scrape_sap_docs.py             # Playwright-based scraper — me.sap.com SAP Notes → HANA
├── vectorize_docs.py              # Generate 3072-dim embeddings for SAP_HELP_DOCS via AI Core
│
├── logs/                          # Rotating application logs (mcp.log)
├── CLAUDE.md                      # Claude Code project instructions
├── .env                           # Secrets — never commit
├── requirements.txt               # Minimal dependency list
└── pyproject.toml                 # Full dependency spec with versions
```

---

## Module Overview

| File | Description |
|---|---|
| [main.py](main.py) | FastAPI app entry point — mounts all routers, initialises MultiMCP manager, runs the autonomous monitoring loop |
| [smart_monitoring.py](smart_monitoring.py) | REST router for `/smart-monitoring/*` — incident management, RCA trigger, fix application, retry, rollback, escalation tickets |
| [smart_monitoring_dashboard.py](smart_monitoring_dashboard.py) | REST router for `/dashboard/*` — KPI cards, charts, leaderboards, drill-downs, SLA metrics |
| [generate_dashboard_pdf.py](generate_dashboard_pdf.py) | Exports the dashboard as a PDF report using headless browser rendering |
| [scrape_sap_docs.py](scrape_sap_docs.py) | Playwright-based scraper — authenticates against me.sap.com via SAML2, scrapes SAP Note content, and writes chunks to `SAP_HELP_DOCS` in HANA (crash-safe, re-runnable) |
| [vectorize_docs.py](vectorize_docs.py) | One-time vectorization script — reads un-embedded rows from `SAP_HELP_DOCS`, calls SAP AI Core (`text-embedding-3-large`), and writes 3072-dim vectors back (crash-safe, re-runnable) |
| [config/config.py](config/config.py) | Loads and validates all settings from `.env` using Pydantic |
| [db/database.py](db/database.py) | SAP HANA Cloud abstraction — CRUD operations for all tables (`AUTONOMOUS_INCIDENTS`, `FIX_PATTERNS`, `ESCALATION_TICKETS`, etc.) |
| [storage/storage.py](storage/storage.py) | Handles file uploads — detects XSD files and routes them to the appropriate HANA table or S3 |
| [storage/object_store.py](storage/object_store.py) | AWS S3 operations — read/write iFlow examples and user-uploaded files using separate read/write credentials |
| [utils/utils.py](utils/utils.py) | HANA timestamp formatting helpers and shared utility functions |
| [utils/logger_config.py](utils/logger_config.py) | Configures rotating file logger with structured JSON output; all production log calls go through this |
| [utils/vector_store.py](utils/vector_store.py) | Retrieves top-N relevant SAP notes from `SAP_HELP_DOCS` using cosine similarity (REAL_VECTOR) with fuzzy-search fallback — used to enrich RCA prompts |
| [utils/xsd_handler.py](utils/xsd_handler.py) | Parses and validates XSD schema files; extracts element/type counts and target namespace |

---

## How the Agent Works

### RCA Engine

```
Error detected
      │
      ├─── LangChain Agent                   ├─── Rule-based Classifier
      │    • Calls get_message_logs            │    • Keyword matching on error text
      │    • Retrieves SAP notes from vector   │    • Returns error_type + confidence
      │      store (HANA SAP_HELP_DOCS)        │
      │    • Generates root_cause + fix        │
      │    • Returns confidence score          │
      │                                        │
      └─────────── max(LLM_conf, classifier_conf) ── final_confidence
                                    │
                    If proposed_fix empty → use FALLBACK_FIX_BY_ERROR_TYPE
```

**Vector Store Integration:**
- Retrieves top 5 relevant SAP notes from `SAP_HELP_DOCS` table (20,000+ notes)
- Uses cosine similarity search on 3072-dim embeddings (text-embedding-3-large via AI Core)
- Falls back to HANA full-text fuzzy search if vector search returns no results
- Enriches RCA prompt with SAP Note content and fix guidance

### Remediation Gate

| Condition | Action |
|---|---|
| Error type = `CONNECTIVITY_ERROR` and confidence ≥ 0.70 | Retry failed message |
| confidence ≥ 0.90 (`AUTO_FIX_CONFIDENCE`) | `AUTO_FIX` |
| confidence ≥ 0.70 (`SUGGEST_FIX_CONFIDENCE`) | `PENDING_APPROVAL` |
| confidence < 0.70 | `TICKET_CREATED` — escalation ticket written to HANA |

### Fix Pipeline

```
0. Reference lookup (optional) — agent calls list-iflow-examples → get-iflow-example
                                   for structural reference on complex fixes
1. Verify iFlow exists          — check artifact exists in SAP CPI (pre-flight)
2. Pre-flight unlock            — automatically cancel any existing iFlow edit session
3. Run RCA (if needed)         — LLM + vector store + knowledge base + classifier
4. Re-verify iFlow exists       — double-check artifact wasn't deleted during RCA
5. Download iFlow config        — MCP: get-iflow
6. Apply fix                    — LLM modifies iFlow XML (using example reference if fetched)
7. Upload updated iFlow         — MCP: update-iflow (verified with strict output checking)
8. Deploy iFlow                 — MCP: deploy-iflow (verified, mandatory)
9. Fetch deploy errors          — retrieve detailed error info if deployment fails
10. Replay message              — retry original failed message (if applicable)
11. Persist result              — update AUTONOMOUS_INCIDENTS + upsert FIX_PATTERNS
```

**iFlow Example Reference (STEP 0):**
- Agent calls `list-iflow-examples` to get names of stored example iFlows from S3
- Picks the example most structurally similar to the error type / affected adapter
- Calls `get-iflow-example(name)` to retrieve full component content from S3
- Used as read-only structural reference — not copied verbatim into the fix
- Step is skipped for simple config/value fixes that need no structural changes

**Deleted iFlow Detection:**
- System verifies iFlow existence before attempting fixes (HTTP GET to SAP CPI design-time API)
- If artifact returns 404, incident is marked as `ARTIFACT_DELETED` with status `ARTIFACT_NOT_FOUND`
- Double-check performed after RCA to catch deletions during analysis phase
- Autonomous loop automatically skips incidents with `ARTIFACT_DELETED` status

**Locked Artifact Handling:**
- System automatically attempts to unlock iFlows before applying fixes
- Uses three methods: DELETE /checkout, POST /CancelCheckout, MCP unlock tools
- If unlock fails, provides clear user guidance to manually cancel checkout
- Retries fix application once after successful unlock

### Error Classification

| Error Type | Default Action | Auto-replay |
|---|---|---|
| `MAPPING_ERROR` | AUTO_FIX | Yes |
| `DATA_VALIDATION` | AUTO_FIX | Yes |
| `AUTH_ERROR` | AUTO_FIX | Yes |
| `CONNECTIVITY_ERROR` | RETRY | Yes |
| `BACKEND_ERROR` | AUTO_FIX | Yes |
| `UNKNOWN_ERROR` | PENDING_APPROVAL | No |

---

## API Reference

### Chatbot

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/` | Health check |
| `POST` | `/query` | Chat with fix-intent detection (supports file uploads) |
| `POST` | `/fix` | Direct iFlow fix by iflow_id + error message |
| `GET` | `/get_all_history` | Query history for a user |
| `GET` | `/get_testsuite_logs` | Test suite execution logs |

#### POST `/query`

```json
// Request (multipart form-data)
{
  "query": "Fix the mapping error in SAP_ERP_Sync iFlow",
  "user_id": "user@example.com",
  "id": "optional-session-id"
}

// Response
{
  "response": "iFlow updated and deployed successfully.",
  "id": "session-uuid",
  "error": null
}
```

Fix-intent keywords that trigger the full pipeline: `fix`, `repair`, `resolve`, `remediate`, `heal`, `deploy fix`, `fix iflow`.

#### POST `/fix`

Direct API for fixing and deploying an iFlow without requiring an existing incident.

```json
// Request
{
  "iflow_id": "SAP_ERP_Sync",
  "error_message": "MappingException: Field 'NetPrice' does not exist in target structure",
  "proposed_fix": "Update message mapping to use 'NetAmount' instead of 'NetPrice'",
  "user_id": "user@example.com"
}

// Response
{
  "iflow_id": "SAP_ERP_Sync",
  "fix_applied": true,
  "deploy_success": true,
  "success": true,
  "summary": "iFlow updated and deployed successfully.",
  "rca_confidence": 0.92,
  "proposed_fix": "Update message mapping...",
  "steps_count": 3
}
```

**Note:** If `proposed_fix` is not provided, the system will automatically run RCA to generate one.

---

### Smart Monitoring

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/smart-monitoring/messages` | List failed CPI messages with filters |
| `GET` | `/smart-monitoring/messages/paginated` | Paginated failed messages |
| `GET` | `/smart-monitoring/messages/{guid}` | Full detail (6 tabs) for one message |
| `POST` | `/smart-monitoring/messages/{guid}/analyze` | Trigger AI RCA |
| `POST` | `/smart-monitoring/messages/{guid}/generate_fix_patch` | Generate fix plan |
| `POST` | `/smart-monitoring/messages/{guid}/apply_fix` | Apply and deploy fix |
| `POST` | `/smart-monitoring/incidents/{id}/retry_fix` | Retry a previously failed fix (up to 3 attempts) |
| `POST` | `/smart-monitoring/incidents/{id}/rollback` | Roll back iFlow to pre-fix snapshot |
| `POST` | `/smart-monitoring/chat` | AI chat about a specific error |
| `GET` | `/smart-monitoring/stats` | Dashboard statistics summary |
| `GET` | `/smart-monitoring/incidents` | All incidents list |
| `GET` | `/smart-monitoring/incidents/{id}/fix_status` | Live fix progress (memory-backed, no HANA on each poll) |
| `GET` | `/smart-monitoring/total-errors` | Total failed message count from SAP CPI |
| `POST` | `/smart-monitoring/messages/{guid}/retry` | Retry a failed message |
| `GET` | `/smart-monitoring/escalations` | List escalation tickets (filter by status / incident_id) |
| `GET` | `/smart-monitoring/escalations/{ticket_id}` | Get single escalation ticket |
| `PATCH` | `/smart-monitoring/escalations/{ticket_id}` | Update ticket status / assignee / resolution notes |

#### GET `/smart-monitoring/incidents/{id}/fix_status`

Returns granular pipeline progress while a fix is running. Reads from in-memory store (< 1 ms) — only hits HANA once when the status becomes terminal.

```json
// While fix is running
{
  "incident_id": "uuid",
  "status": "FIX_IN_PROGRESS",
  "current_step": "Applying fix and deploying iFlow…",
  "step_index": 3,
  "total_steps": 4,
  "steps_done": ["Downloading iFlow configuration…"],
  "fix_summary": null
}

// When complete
{
  "incident_id": "uuid",
  "status": "AUTO_FIXED",
  "current_step": "Fix applied and deployed successfully",
  "step_index": 4,
  "total_steps": 4,
  "steps_done": ["Downloading iFlow configuration…", "Applying fix and deploying iFlow…"],
  "fix_summary": "iFlow SAP_ERP_Sync updated and deployed successfully.",
  "resolved_at": "2026-03-30T10:05:00Z"
}
```

#### PATCH `/smart-monitoring/escalations/{ticket_id}`

```json
// Request
{
  "status": "RESOLVED",
  "assigned_to": "engineer@example.com",
  "resolution_notes": "Updated endpoint URL in receiver adapter."
}

// Response
{
  "success": true,
  "ticket_id": "uuid"
}
```

Automatically sets `resolved_at` when status is `RESOLVED` or `CLOSED`.

#### POST `/smart-monitoring/incidents/{id}/retry_fix`

Retries a previously failed fix. Capped at 3 attempts. Blocked if the iFlow is still locked.

```json
// Request
{ "user_id": "user@example.com" }

// Response
{
  "incident_id": "uuid",
  "iflow_id": "SAP_ERP_Sync",
  "retry_attempt": 2,
  "max_retries": 3,
  "status": "FIX_IN_PROGRESS",
  "message": "Retry attempt 2/3 started in the background. Poll GET /smart-monitoring/incidents/{id}/fix_status for progress."
}
```

Retryable statuses: `FIX_FAILED`, `FIX_FAILED_UPDATE`, `FIX_FAILED_DEPLOY`, `FIX_FAILED_RUNTIME`.

When `last_failed_stage` is `deploy`, only the deploy step is re-run (skips get + update). When confidence < 0.70 and the agent/update step failed, RCA is re-run first to generate a fresh fix before retrying.

#### POST `/smart-monitoring/incidents/{id}/rollback`

Restores the iFlow to the snapshot captured before the fix was applied (`iflow_snapshot_before`). Runs update-iflow then deploy-iflow in the background.

```json
// Response
{
  "incident_id": "uuid",
  "iflow_id": "SAP_ERP_Sync",
  "status": "FIX_IN_PROGRESS",
  "message": "Rollback started in the background. Poll GET /smart-monitoring/incidents/{id}/fix_status for progress."
}
```

On success the incident status transitions to `ROLLED_BACK`. Fails with `400` if no snapshot is available.

---

### Dashboard

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dashboard/kpi-cards` | Top-level KPI metrics |
| `GET` | `/dashboard/error-distribution` | Error type pie/donut chart data |
| `GET` | `/dashboard/status-distribution` | Incident status breakdown |
| `GET` | `/dashboard/status-breakdown` | Detailed counts for all statuses |
| `GET` | `/dashboard/failures-over-time` | Time-series failure data |
| `GET` | `/dashboard/top-failing-iflows` | Bar chart: most failing iFlows |
| `GET` | `/dashboard/sender-receiver-stats` | Adapter failure analysis |
| `GET` | `/dashboard/active-incidents-table` | Real-time active incidents feed |
| `GET` | `/dashboard/recent-failures-table` | Recent failures feed |
| `GET` | `/dashboard/fix-progress-tracker` | Fix pipeline progress widget |
| `GET` | `/dashboard/leaderboard/noisy-integrations` | Top noisy iFlows |
| `GET` | `/dashboard/leaderboard/recurring-incidents` | Most recurring errors |
| `GET` | `/dashboard/leaderboard/longest-open` | Longest unresolved incidents |
| `GET` | `/dashboard/drill-down/message/{guid}` | Message-level drill-down |
| `GET` | `/dashboard/drill-down/incident/{id}` | Incident-level drill-down |
| `GET` | `/dashboard/drill-down/iflow/{name}` | iFlow-level analytics |
| `GET` | `/dashboard/health-metrics` | System health indicators |
| `GET` | `/dashboard/sla-metrics` | SLA compliance metrics |
| `GET` | `/dashboard/rca-coverage` | RCA coverage statistics |

---

### Autonomous Operations

#### What it is

The autonomous loop is a background process that continuously monitors SAP CPI for failed messages and runtime artifact errors — without any human intervention. It polls SAP CPI on a configurable interval, runs AI-powered Root Cause Analysis on each new error, and either fixes the iFlow automatically or escalates it depending on the confidence score.

#### What it does

```
Every POLL_INTERVAL_SECONDS:
  1. Fetch all failed messages + runtime artifact errors from SAP CPI
  2. Deduplicate — skip errors already tracked as incidents
  3. For each new error:
       a. Run RCA (LangChain agent + SAP Notes vector search + rule classifier)
       b. Confidence ≥ AUTO_FIX_CONFIDENCE (0.90)  → Auto-fix + deploy iFlow
       c. Confidence ≥ SUGGEST_FIX_CONFIDENCE (0.70) → Create PENDING_APPROVAL incident
       d. Confidence < 0.70                          → Create escalation ticket in HANA
  4. Persist all incidents and fix outcomes to HANA
```

#### How to operate

**Start the loop:**
```bash
curl -X POST http://localhost:8080/autonomous/start
```

**Stop the loop:**
```bash
curl -X POST http://localhost:8080/autonomous/stop
```

**Check if it's running:**
```bash
curl http://localhost:8080/autonomous/status
```

**Approve a pending fix (when confidence was 0.70–0.89):**
```bash
curl -X POST http://localhost:8080/autonomous/incidents/{id}/approve \
  -H "Content-Type: application/json" \
  -d '{"approved": true, "user_id": "user@example.com"}'
```

**Manually trigger one-shot polling (without starting the loop):**
```bash
curl -X POST http://localhost:8080/autonomous/manual_trigger
```

**Key `.env` controls:**

| Variable | Default | Description |
|---|---|---|
| `AUTONOMOUS_ENABLED` | `false` | Start loop automatically on server boot |
| `POLL_INTERVAL_SECONDS` | `60` | How often to poll SAP CPI for errors |
| `AUTO_FIX_CONFIDENCE` | `0.90` | Minimum confidence to auto-fix without approval |
| `SUGGEST_FIX_CONFIDENCE` | `0.70` | Minimum confidence to suggest fix (pending approval) |
| `MAX_CONSECUTIVE_FAILURES` | `5` | Stop loop after this many consecutive poll errors |

---

#### API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/autonomous/start` | Start autonomous monitoring loop |
| `POST` | `/autonomous/stop` | Stop autonomous monitoring loop |
| `GET` | `/autonomous/status` | Loop status and configuration |
| `GET` | `/autonomous/cpi/errors` | Fetch current CPI error inventory (messages + artifacts) |
| `GET` | `/autonomous/cpi/messages/errors` | Fetch failed messages only |
| `GET` | `/autonomous/cpi/runtime_artifacts/errors` | Fetch runtime artifact errors only |
| `GET` | `/autonomous/cpi/runtime_artifacts/{artifact_id}` | Get detailed runtime artifact info |
| `GET` | `/autonomous/tools` | List all loaded MCP tools (optionally filter by server) |
| `GET` | `/autonomous/incidents` | List all incidents (with optional status filter) |
| `GET` | `/autonomous/incidents/{id}` | Get incident details by ID or message GUID |
| `GET` | `/autonomous/incidents/{id}/view_model` | Get enriched incident view with metadata |
| `POST` | `/autonomous/incidents/{id}/approve` | Approve or reject a pending fix |
| `POST` | `/autonomous/incidents/{id}/generate_fix` | Generate and apply fix for an incident |
| `POST` | `/autonomous/incidents/{id}/retry_rca` | Re-run RCA for an incident |
| `GET` | `/autonomous/incidents/{id}/fix_patterns` | Get historical fix patterns for similar errors |
| `GET` | `/autonomous/pending_approvals` | List all incidents pending approval |
| `POST` | `/autonomous/manual_trigger` | Manually trigger one-shot error polling |
| `POST` | `/autonomous/test_incident` | Inject synthetic test incident |
| `GET` | `/autonomous/db_test` | Test database connectivity |
| `GET` | `/autonomous/debug` | Debug autonomous loop configuration |
| `GET` | `/autonomous/debug2` | Debug SAP API connectivity |

#### GET `/autonomous/status`

```json
{
  "running": true,
  "poll_interval_seconds": 60,
  "auto_fix_confidence": 0.90,
  "suggest_fix_confidence": 0.70
}
```

### Auto-Fix Configuration

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/config/auto-fix` | Get current auto-fix configuration status |
| `POST` | `/api/config/auto-fix` | Enable/disable auto-fix at runtime |
| `POST` | `/api/config/auto-fix/reset` | Reset auto-fix to .env default value |

---

## HANA Knowledge Base

The system queries `SAP_HELP_DOCS` in HANA Cloud to retrieve relevant SAP notes during RCA. Entries are injected into the LLM prompt as context, improving the quality and specificity of generated fixes.

### Building the Knowledge Base

**Step 1 — Scrape SAP Notes** (`scrape_sap_docs.py`):

Uses Playwright (headless Chromium) to authenticate against me.sap.com via SAML2/XSUAA and scrape SAP Note content. Writes directly to HANA per note (crash-safe — re-runnable).

```bash
# Scrape a file of 500 note URLs
uv run scrape_sap_docs.py --notes-only --notes-file sap_notes_1.txt

# Options
--dry-run          # preview only, no writes
--clear            # drop and recreate SAP_HELP_DOCS before run
--notes-only       # skip all other phases, SAP notes only
```

**Step 2 — Vectorize** (`vectorize_docs.py`):

Generates 3072-dim embeddings via SAP AI Core (`text-embedding-3-large`) and stores them in the `VEC_VECTOR` column. Skips already-vectorized rows — safe to re-run after interruption.

```bash
uv run vectorize_docs.py              # vectorize all un-embedded rows
uv run vectorize_docs.py --batch 100  # override batch size
uv run vectorize_docs.py --dry-run    # show counts only
```

**Table schema (`SAP_HELP_DOCS`):**

| Column | Type | Description |
|---|---|---|
| `ID` | INTEGER | Auto-increment primary key |
| `VEC_TEXT` | NCLOB | Chunked SAP Note text (max 2000 chars/chunk) |
| `VEC_META` | NCLOB | JSON metadata — title, url, source, note_id |
| `VEC_VECTOR` | REAL_VECTOR(3072) | `text-embedding-3-large` embedding |

**Search strategy** (in order of preference):
1. `COSINE_SIMILARITY(VEC_VECTOR, TO_REAL_VECTOR(?)) DESC` — semantic vector search
2. `CONTAINS(VEC_TEXT, keyword, FUZZY(0.6))` — HANA full-text fuzzy fallback
3. `SELECT TOP N` scan — last resort

---

## Database Schema

All tables are in SAP HANA Cloud. The application auto-creates/migrates tables on startup via `ensure_*_schema()` functions.

### HANA Table DDL

#### `AUTONOMOUS_INCIDENTS`

```sql
CREATE TABLE autonomous_incidents (
    incident_id           NVARCHAR(100)  PRIMARY KEY,
    message_guid          NVARCHAR(200),
    iflow_id              NVARCHAR(200),
    sender                NVARCHAR(200),
    receiver              NVARCHAR(200),
    status                NVARCHAR(64),
    error_type            NVARCHAR(100),
    error_message         NCLOB,
    root_cause            NCLOB,
    proposed_fix          NCLOB,
    rca_confidence        DOUBLE,
    affected_component    NVARCHAR(200),
    fix_summary           NCLOB,
    comment               NCLOB,
    correlation_id        NVARCHAR(200),
    log_start             NVARCHAR(64),
    log_end               NVARCHAR(64),
    created_at            NVARCHAR(64),
    resolved_at           NVARCHAR(64),
    tags                  NCLOB,
    -- migration columns (added via ALTER TABLE on startup if missing)
    incident_group_key    NVARCHAR(64),
    occurrence_count      INTEGER,
    last_seen             NVARCHAR(64),
    verification_status   NVARCHAR(64),
    fix_steps             NCLOB,
    field_changes         NCLOB,
    fix_plan_generated_at NVARCHAR(64),
    retry_count           INTEGER,
    last_failed_stage     NVARCHAR(64),
    iflow_snapshot_before NCLOB,
    pending_since         NVARCHAR(64),
    ticket_id             NVARCHAR(512),
    consecutive_failures  INTEGER,
    auto_escalated        INTEGER
);
```

#### `ESCALATION_TICKETS`

```sql
CREATE TABLE escalation_tickets (
    ticket_id        NVARCHAR(100) PRIMARY KEY,
    incident_id      NVARCHAR(100),
    iflow_id         NVARCHAR(200),
    error_type       NVARCHAR(100),
    title            NVARCHAR(500),
    description      NCLOB,
    priority         NVARCHAR(20),
    status           NVARCHAR(20)  DEFAULT 'OPEN',
    assigned_to      NVARCHAR(200),
    resolution_notes NCLOB,
    created_at       NVARCHAR(64),
    updated_at       NVARCHAR(64),
    resolved_at      NVARCHAR(64)
);
```

#### `FIX_PATTERNS`

```sql
CREATE TABLE fix_patterns (
    pattern_id            NVARCHAR(100) PRIMARY KEY,
    error_signature       NVARCHAR(500),
    iflow_id              NVARCHAR(200),
    error_type            NVARCHAR(100),
    root_cause            NCLOB,
    fix_applied           NCLOB,
    outcome               NVARCHAR(50),
    applied_count         INTEGER,
    last_seen             NVARCHAR(64),
    -- migration columns (added via ALTER TABLE on startup if missing)
    success_count         INTEGER DEFAULT 0,
    replay_success_count  INTEGER DEFAULT 0
);
```

#### `MCP_QUERY_HISTORY`

```sql
CREATE TABLE mcp_query_history (
    session_id  NVARCHAR(200) PRIMARY KEY,
    question    NCLOB,
    answer      NCLOB,
    timestamp   NVARCHAR(64),
    user_id     NVARCHAR(200)
);
```

#### `TEST_SUITE_LOGS`

```sql
CREATE TABLE test_suite_logs (
    test_suite_id NVARCHAR(200) PRIMARY KEY,
    user_id       NVARCHAR(200),
    prompt        NCLOB,
    timestamp     NVARCHAR(64),
    status        NVARCHAR(50),
    executions    NCLOB   -- JSON array of test execution records
);
```

#### `USER_FILES_METADATA`

```sql
CREATE TABLE user_files_metadata (
    file_id    NVARCHAR(100) PRIMARY KEY,
    session_id NVARCHAR(200),
    file_name  NVARCHAR(500),
    file_type  NVARCHAR(100),
    file_size  INTEGER,
    s3_key     NVARCHAR(1000),
    timestamp  NVARCHAR(64),
    user_id    NVARCHAR(200)
);
```

#### `SAP_IS_XSD_FILES`

```sql
CREATE TABLE sap_is_xsd_files (
    file_id          NVARCHAR(100) PRIMARY KEY,
    session_id       NVARCHAR(200),
    target_namespace NVARCHAR(500),
    element_count    INTEGER,
    type_count       INTEGER,
    content          NCLOB,
    timestamp        NVARCHAR(64),
    user_id          NVARCHAR(200)
);
```

#### `SAP_HELP_DOCS`

Populated by `scrape_sap_docs.py` and vectorized by `vectorize_docs.py`. Used for semantic RCA context retrieval.

```sql
CREATE TABLE sap_help_docs (
    ID         INTEGER      PRIMARY KEY,   -- auto-increment
    VEC_TEXT   NCLOB,                      -- chunked SAP Note text
    VEC_META   NCLOB,                      -- JSON: title, url, source, note_id
    VEC_VECTOR REAL_VECTOR(3072)           -- text-embedding-3-large embedding
);
```

---

### `AUTONOMOUS_INCIDENTS`

Core incident tracking table. One row per detected error.

| Key columns | Description |
|---|---|
| `incident_id` | UUID primary key |
| `message_guid` | SAP CPI message GUID |
| `iflow_id` | Integration flow name |
| `status` | Lifecycle status (see below) |
| `error_type` | Classified error type |
| `root_cause` | AI-generated root cause |
| `proposed_fix` | AI-generated fix description |
| `rca_confidence` | Confidence score 0.0–1.0 |
| `fix_summary` | Result of fix execution |
| `occurrence_count` | Recurring error counter |
| `incident_group_key` | Deduplication hash |

**Incident lifecycle:**

```
DETECTED → RCA_IN_PROGRESS → RCA_COMPLETE → PENDING_APPROVAL → FIX_IN_PROGRESS → AUTO_FIXED
                                                                               → HUMAN_FIXED
                                                                               → FIX_FAILED ──────────┐
                                                                               → FIX_FAILED_UPDATE ───┤ retry_fix
                                                                               → FIX_FAILED_DEPLOY ───┤ (up to 3×)
                                                                               → FIX_FAILED_RUNTIME ──┘
                                                                               → ROLLED_BACK
                                                                               → ARTIFACT_DELETED
                                          → TICKET_CREATED
                          → RETRIED
```

**Terminal statuses** (not reprocessed by autonomous loop):
- `AUTO_FIXED` — Fix successfully applied and deployed
- `HUMAN_INITIATED_FIX` — Fix applied via manual approval
- `FIX_FAILED` — Fix attempt failed (general)
- `FIX_FAILED_UPDATE` — Fix failed at the iFlow update step
- `FIX_FAILED_DEPLOY` — Fix failed at the deploy step
- `FIX_FAILED_RUNTIME` — Fix deployed but caused a runtime failure
- `ROLLED_BACK` — iFlow successfully restored to pre-fix snapshot
- `ARTIFACT_DELETED` — iFlow no longer exists in SAP CPI
- `REJECTED` — Fix rejected by user
- `TICKET_CREATED` — Escalated to internal ticket
- `RETRIED` — Message retry completed

### `ESCALATION_TICKETS`

Internal escalation ticket system — replaces external JIRA/ServiceNow integration. Created automatically when an incident's RCA confidence is too low for auto-fix.

| Column | Description |
|---|---|
| `ticket_id` | UUID primary key |
| `incident_id` | Linked incident (FK to `AUTONOMOUS_INCIDENTS`) |
| `iflow_id` | Integration flow name |
| `error_type` | Classified error type |
| `title` | Auto-generated ticket title |
| `description` | Full incident context (error, root cause, proposed fix) |
| `priority` | `CRITICAL` / `HIGH` / `MEDIUM` (auto-derived from occurrence count and confidence) |
| `status` | `OPEN` / `IN_PROGRESS` / `RESOLVED` / `CLOSED` |
| `assigned_to` | Assignee (defaults to `TICKET_DEFAULT_ASSIGNEE`) |
| `resolution_notes` | Free-text resolution notes |
| `created_at` | Creation timestamp |
| `updated_at` | Last update timestamp |
| `resolved_at` | Set automatically when status → `RESOLVED` or `CLOSED` |

**Priority auto-derivation:**

| Condition | Priority |
|---|---|
| occurrence_count ≥ 5 or confidence < 0.30 | `CRITICAL` |
| occurrence_count ≥ 3 or confidence < 0.50 | `HIGH` |
| Otherwise | `MEDIUM` |

### `FIX_PATTERNS`

Stores outcomes of applied fixes for future reuse. Matched by error signature on recurring incidents.

### `QUERY_HISTORY` (`MCP_QUERY_HISTORY`)

Chat session history (question, answer, user_id, timestamp).

### `TEST_SUITE_LOGS`

iFlow test execution records with payload, headers, and message logs.

---

## Security

- All SAP API calls use OAuth 2.0 client credentials — tokens cached until expiry
- Secrets stored in `.env` — never committed to source control
- HANA connections use SSL/TLS (`encrypt=True`)
- SQL queries use parameterised statements — no string interpolation
- API responses never expose stack traces or internal error details
- Autonomous loop safety: `AUTO_FIX_CONFIDENCE=0.90` gates autonomous deployments
- Auto-fix can be toggled at runtime via API without restarting the service
- S3 uses separate read / write credentials (`READ_ACCESS_KEY_ID` / `WRITE_ACCESS_KEY_ID`)
- Locked artifact detection prevents concurrent edit conflicts
- Background task isolation prevents blocking main API thread

---

## Debugging

```bash
# View live application log
tail -f logs/mcp.log

# Check all endpoints (Swagger)
open http://localhost:8080/docs

# Test health
curl http://localhost:8080/

# Check autonomous loop status
curl http://localhost:8080/autonomous/status

# Manually fetch current SAP CPI errors (without starting the loop)
curl http://localhost:8080/autonomous/cpi/errors

# Test database connectivity
curl http://localhost:8080/autonomous/db_test

# Debug autonomous configuration
curl http://localhost:8080/autonomous/debug

# Debug SAP API connectivity
curl http://localhost:8080/autonomous/debug2

# List all loaded MCP tools (including iFlow examples)
curl http://localhost:8080/autonomous/tools

# Inject test incident for pipeline testing
curl -X POST http://localhost:8080/autonomous/test_incident

# Get current auto-fix configuration
curl http://localhost:8080/api/config/auto-fix

# Enable auto-fix at runtime
curl -X POST http://localhost:8080/api/config/auto-fix \
  -H "Content-Type: application/json" \
  -d '{"enabled": true}'

# List escalation tickets
curl "http://localhost:8080/smart-monitoring/escalations?status=OPEN"

# Update escalation ticket
curl -X PATCH http://localhost:8080/smart-monitoring/escalations/<ticket_id> \
  -H "Content-Type: application/json" \
  -d '{"status": "RESOLVED", "resolution_notes": "Fixed endpoint URL."}'
```

---

## Further Reading

- [CLAUDE.md](CLAUDE.md) — Claude Code project standards and agent instructions
- [rules/coding-style.md](rules/coding-style.md) — naming conventions and architecture rules
- [rules/security.md](rules/security.md) — security standards for SAP BTP

---

*Sierra Digital — SAP CPI Self-Healing Agent*
