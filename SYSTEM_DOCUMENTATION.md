# SAP CPI Self-Healing Agent — Technical Documentation

**Project:** SAP CPI Self-Healing Agent
**Owner:** Sierra Digital
**Version:** 1.0
**Date:** 2026-03-30

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture Overview](#2-system-architecture-overview)
3. [Technology Stack & Components](#3-technology-stack--components)
4. [Core Components Deep Dive](#4-core-components-deep-dive)
   - 4.1 FastAPI Application Server
   - 4.2 MultiMCP Manager (AI Orchestrator)
   - 4.3 LangChain AI Agent
   - 4.4 MCP Servers (3 External Tools)
   - 4.5 SAP Error Fetcher
   - 4.6 HANA Knowledge Base (Vector Store)
5. [How the AI Agent Works](#5-how-the-ai-agent-works)
6. [Fix Pipeline — End-to-End Flow](#6-fix-pipeline--end-to-end-flow)
7. [Autonomous Monitoring Loop](#7-autonomous-monitoring-loop)
8. [Smart Monitoring UI Backend](#8-smart-monitoring-ui-backend)
9. [Database Schema](#9-database-schema)
10. [API Reference](#10-api-reference)
11. [Configuration & Environment Variables](#11-configuration--environment-variables)
12. [Deployment Architecture](#12-deployment-architecture)

---

## 1. Executive Summary

The **SAP CPI Self-Healing Agent** is an AI-powered autonomous system that monitors SAP Cloud Platform Integration (CPI) for failed messages and integration flow (iFlow) errors, performs AI-driven Root Cause Analysis (RCA), and automatically applies fixes and redeploys iFlows — with no manual intervention required.

### Business Value

| Problem | Solution |
|---|---|
| Integration engineers spend hours manually diagnosing failed SAP CPI messages | AI automatically classifies, analyses, and fixes errors |
| Recurring errors cause repeated manual effort | Fix patterns are learned and reused automatically |
| SAP Integration Suite errors require deep technical knowledge | AI surfaces root cause and proposed fix in plain language |
| Fix-and-deploy cycle is error-prone when done manually | Autonomous pipeline applies, deploys, and verifies fixes |

### Key Capabilities

- **Autonomous error detection** — polls SAP CPI every N seconds for failed messages and deployment errors
- **AI Root Cause Analysis (RCA)** — LLM + rule-based classifier determines error type and root cause
- **Automatic fix & deploy** — AI modifies iFlow XML, uploads update, and deploys via MCP tools
- **Knowledge base lookup** — HANA vector store retrieves relevant SAP notes to improve fix quality
- **Smart Monitoring dashboard** — REST API powering a real-time monitoring UI
- **Conversational interface** — chatbot that accepts natural language fix requests

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          FastAPI Application Server                          │
│                           (main.py — port 8080)                              │
│                                                                               │
│   ┌───────────────┐  ┌────────────────────┐  ┌────────────────────────────┐ │
│   │  Chatbot API  │  │ Smart Monitoring   │  │    Dashboard API           │ │
│   │  /query /fix  │  │ /smart-monitoring/ │  │    /dashboard/             │ │
│   └───────┬───────┘  └────────┬───────────┘  └──────────────┬─────────────┘ │
│           │                   │                              │               │
│   ┌───────▼───────────────────▼──────────────────────────────▼─────────────┐ │
│   │                     MultiMCP Manager                                    │ │
│   │  • LangChain AI Agent (GPT / Claude via SAP AI Core)                   │ │
│   │  • MCP Tool Discovery & Routing                                         │ │
│   │  • RCA Engine (LLM + Rule-based classifier)                             │ │
│   │  • Fix & Deploy Pipeline                                                 │ │
│   │  • Autonomous Monitoring Loop                                            │ │
│   │  • Session Memory (per-user conversation history)                       │ │
│   │  • In-memory Fix Progress Tracker                                        │ │
│   └───────┬───────────────────┬──────────────────────────────┬─────────────┘ │
└───────────┼───────────────────┼──────────────────────────────┼───────────────┘
            │                   │                              │
   ┌────────▼──────┐  ┌─────────▼──────┐  ┌──────────────────▼──────────────┐
   │ Integration   │  │  iFlow Test    │  │    Documentation MCP            │
   │ Suite MCP     │  │  MCP Server    │  │    Server                       │
   │               │  │                │  │                                  │
   │ get-iflow     │  │ run-test       │  │  generate-spec                  │
   │ update-iflow  │  │ validate-iflow │  │  get-sap-standard               │
   │ deploy-iflow  │  │ test-reports   │  │  sap-doc-template               │
   │ unlock-iflow  │  │                │  │                                  │
   └───────────────┘  └────────────────┘  └─────────────────────────────────┘
            │
   ┌────────▼──────────────────────────────────────────────────────────────┐
   │                       SAP Integration Suite                            │
   │          (OData API + Design Time API + Runtime API)                   │
   └────────────────────────────────────────────────────────────────────────┘

External Services:
┌──────────────────┐  ┌──────────────────────┐  ┌─────────────────────────┐
│  SAP HANA Cloud  │  │   SAP AI Core        │  │   AWS S3 Object Store   │
│  • Incidents DB  │  │   (LLM endpoint)     │  │   (file uploads)        │
│  • Query history │  │   GPT-5 / Claude     │  │                         │
│  • Fix patterns  │  │                      │  │                         │
│  • CPI KB        │  │                      │  │                         │
│    (Vector store)│  │                      │  │                         │
└──────────────────┘  └──────────────────────┘  └─────────────────────────┘
```

---

## 3. Technology Stack & Components

### Core Framework

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Web Framework | FastAPI | ≥0.128 | REST API server |
| ASGI Server | Uvicorn | ≥0.40 | Production-grade async HTTP server |
| Language | Python | ≥3.13 | Application runtime |

### AI & Agent Layer

| Component | Technology | Version | Purpose |
|---|---|---|---|
| LLM Orchestration | LangChain | ≥1.2.9 | AI agent creation and tool calling |
| LLM Model | SAP AI Core (GPT-5) | — | Language model for RCA and fix generation |
| MCP Protocol | fastmcp | ≥2.14.5 | Model Context Protocol — tool interface |
| MCP ↔ LangChain | langchain-mcp-adapters | ≥0.2.1 | Bridge between MCP tools and LangChain |
| AI SDK | sap-ai-sdk-gen | ≥6.1.2 | SAP AI Core authentication and proxying |

### Data Layer

| Component | Technology | Version | Purpose |
|---|---|---|---|
| Primary Database | SAP HANA Cloud | — | Incident storage, query history, fix patterns |
| HANA Driver | hdbcli | ≥2.27.23 | Python → HANA connection |
| Vector Store | HANA Cloud (`CPI_KNOWLEDGE_BASE`) | — | Semantic knowledge base for SAP fixes |
| Local Dev DB | SQLite | built-in | Development/testing database |
| Object Storage | AWS S3 (via boto3) | ≥1.42 | File uploads (XSD, iFlow artifacts) |

### Networking & Auth

| Component | Technology | Purpose |
|---|---|---|
| HTTP Client | httpx | Async HTTP calls to SAP APIs |
| SAP Auth | OAuth 2.0 (client credentials) | Authenticates against SAP Integration Suite |
| Token Cache | In-memory dict | Reuses tokens until expiry |

### Observability

| Component | Technology | Purpose |
|---|---|---|
| Structured Logging | structlog + Python logging | JSON logs for cloud observability |
| Log Rotation | RotatingFileHandler | `logs/mcp.log` (prevents disk fill) |
| Metrics | prometheus-client | `/metrics` endpoint |

---

## 4. Core Components Deep Dive

### 4.1 FastAPI Application Server

**File:** `main.py`

The FastAPI app starts with a lifespan hook that:
1. Initialises the SQLite schema (local dev only)
2. Creates the global `MultiMCP` instance
3. Connects all 3 MCP servers
4. Discovers all available tools
5. Builds the LangChain agent

Three routers are mounted:

| Router | Prefix | File |
|---|---|---|
| Chatbot | `/` | `main.py` |
| Smart Monitoring | `/smart-monitoring` | `smart_monitoring.py` |
| Dashboard | `/dashboard` | `smart_monitoring_dashboard.py` |
| Autonomous | `/autonomous` | `main.py` |

CORS is enabled for all origins (configurable for production).

---

### 4.2 MultiMCP Manager

**File:** `main.py` — class `MultiMCP`

This is the **central orchestrator** of the entire system. It holds:

```
MultiMCP
├── clients: Dict[server_name → fastmcp.Client]    — open HTTP connections to MCP servers
├── tools: List[MCPTool]                            — all discovered tools as LangChain BaseTool
├── llm: ChatOpenAI                                 — SAP AI Core LLM proxy
├── agent: LangChain agent                          — ReAct / tool-calling agent
├── memory: Dict[session_id → List[messages]]       — per-user conversation history (last 12)
├── error_fetcher: SAPErrorFetcher                  — polls SAP CPI for failed messages
└── _autonomous_running / _autonomous_task          — background loop control
```

**Startup flow:**

```
app lifespan start
    │
    ├─ MultiMCP.__init__()
    ├─ mcp_manager.connect()       — opens HTTP to all 3 MCP servers
    ├─ mcp_manager.discover_tools()— fetches tool list from each server
    └─ mcp_manager.build_agent()   — creates LangChain agent with all tools + system prompt
```

---

### 4.3 LangChain AI Agent

**How the agent is built:**

```python
agent = create_agent(
    model = ChatOpenAI(proxy_model="gpt5-deployment"),
    tools = [MCPTool(server, name, description), ...],  # all tools from all 3 MCP servers
    system_prompt = """
        You are an SAP MCP automation agent.
        Server routing rules: ...
        Fix+Deploy rules: get-iflow → update-iflow → deploy-iflow
    """
)
```

**How the agent reasons (ReAct loop):**

```
User message → agent
        │
        ▼
   Agent THINKS: "I need to fix iFlow SAP_ERP_Sync.
                  Integration Suite MCP handles iFlow operations."
        │
        ▼
   Agent CALLS: get-iflow(iflow_id="SAP_ERP_Sync")
        │
        ▼
   MCP server executes → returns iFlow XML
        │
        ▼
   Agent THINKS: "I have the current config. I'll apply the mapping fix."
        │
        ▼
   Agent CALLS: update-iflow(iflow_id, modified_xml)
        │
        ▼
   MCP server executes → returns success
        │
        ▼
   Agent CALLS: deploy-iflow(iflow_id="SAP_ERP_Sync")
        │
        ▼
   Agent RESPONDS: "iFlow updated and deployed successfully."
```

**Server routing logic** — the agent selects the right MCP server based on intent:

| User intent | MCP server used |
|---|---|
| "fix iFlow", "deploy", "update integration flow" | `integration_suite` |
| "run test", "validate", "test report" | `mcp_testing` |
| "generate documentation", "SAP standard spec" | `documentation_mcp` |

**Session memory** — the agent keeps the last 12 messages per `session_id` so follow-up questions have context.

---

### 4.4 MCP Servers (3 External Tools)

The system connects to 3 independently deployed MCP servers over HTTP (SAP Cloud Foundry):

#### Integration Suite MCP
**Responsibility:** All iFlow design-time and runtime operations

| Tool | What it does |
|---|---|
| `get-iflow` | Downloads current iFlow XML configuration from SAP Design Time |
| `update-iflow` | Uploads modified iFlow XML back to SAP Design Time |
| `deploy-iflow` | Triggers runtime deployment of the updated iFlow |
| `unlock-iflow` / `cancel-checkout` | Removes edit lock from an iFlow |
| `get-message-logs` | Fetches processing log for a specific message GUID |

#### iFlow Test MCP
**Responsibility:** Test execution and validation

| Tool | What it does |
|---|---|
| `run-test` | Sends a test payload through an iFlow |
| `validate-iflow` | Validates iFlow structure and configuration |
| `test-reports` | Retrieves test execution results |

#### Documentation MCP
**Responsibility:** SAP documentation and template generation

| Tool | What it does |
|---|---|
| `generate-spec` | Generates SAP standard integration specification |
| `get-sap-standard` | Retrieves SAP standard documentation |
| `sap-doc-template` | Returns documentation templates |

---

### 4.5 SAP Error Fetcher

**File:** `main.py` — class `SAPErrorFetcher`

Fetches failed messages and deployment errors from SAP Integration Suite using the OData API.

**Authentication:** OAuth 2.0 client credentials — tokens are cached and refreshed before expiry.

**Two data sources polled:**

```
SAPErrorFetcher
├── fetch_failed_messages()         — OData: MessageProcessingLogs?$filter=Status eq 'FAILED'
├── fetch_failed_messages_count()   — OData: MessageProcessingLogs/$count
├── fetch_error_details(guid)       — OData: MessageProcessingLogErrorInformations
├── fetch_message_metadata(guid)    — OData: full message properties
└── fetch_runtime_artifact_errors() — OData: IntegrationRuntimeArtifacts (deployment errors)
```

**normalize()** converts raw SAP OData JSON into a standard incident dict:

```json
{
  "message_guid":   "abc123",
  "iflow_id":       "SAP_ERP_Sync",
  "sender":         "SAP_ERP",
  "receiver":       "SAP_CRM",
  "error_message":  "Field 'Material' does not exist in target",
  "log_start":      "2026-03-30T10:00:00Z",
  "log_end":        "2026-03-30T10:00:05Z",
  "correlation_id": "corr-456"
}
```

---

### 4.6 HANA Knowledge Base (Vector Store)

**File:** `utils/vector_store.py` — class `VectorStoreRetriever`

**Table:** `CPI_KNOWLEDGE_BASE` in HANA Cloud

| Column | Type | Description |
|---|---|---|
| `VEC_TEXT` | NCLOB | Full knowledge base entry text |
| `VEC_META` | NCLOB | JSON metadata (title, error_category, solution_steps, source) |
| `VEC_VECTOR` | REAL_VECTOR(0) | Pre-computed text embedding for semantic search |

**Search strategy (in order):**

1. `CONTAINS(VEC_TEXT, keyword, FUZZY(0.6))` — HANA full-text fuzzy search
2. `VEC_TEXT LIKE '%error_type%'` — keyword fallback
3. `SELECT TOP N` — last resort scan

**How it improves fixes:**

The retrieved entries are injected into the RCA prompt as context:

```
=== RELEVANT ENTRIES FROM CPI KNOWLEDGE BASE ===
--- MAPPING_ERROR: Field not found in target ---
Category : MAPPING_ERROR
Content  : When a field referenced in message mapping does not exist in the
           target structure, the integration flow fails at the mapping step...
Solution : 1. Open the affected mapping in iFlow editor
           2. Refresh target structure  3. Update field references  4. Redeploy
```

The LLM uses this context to generate more accurate, SAP-specific fix instructions.

---

## 5. How the AI Agent Works

### RCA Engine

The Root Cause Analysis engine uses a **dual approach** — LLM analysis backed by a rule-based classifier as a confidence floor:

```
Error message input
        │
        ├──────────────────────────────────────────┐
        │                                          │
        ▼                                          ▼
  LLM RCA Agent                          Rule-based Classifier
  (LangChain agent)                      (classify_error() in main.py)
        │                                          │
        │  Uses:                         Matches keywords against:
        │  • Message processing log      • "mapping", "field", "does not exist"
        │  • Error text                    → MAPPING_ERROR (confidence: 0.88)
        │  • KB entries from HANA        • "401", "403", "unauthorized"
        │  • Historical fix patterns       → AUTH_ERROR (confidence: 0.85)
        │                                • "connection refused", "timeout"
        │                                  → CONNECTIVITY_ERROR (confidence: 0.80)
        │
        ▼
  LLM returns JSON:
  {
    "root_cause": "Field 'MaterialCode' renamed to 'Material' in backend",
    "proposed_fix": "Update mapping step: change target field from 'Material' to 'MaterialCode'",
    "confidence": 0.82,
    "error_type": "MAPPING_ERROR",
    "affected_component": "MM_MessageMapping"
  }
        │
        ▼
  Confidence floor:  final_confidence = max(LLM_confidence, classifier_confidence)
  (ensures LLM under-confidence doesn't suppress valid fixes)
        │
        ▼
  If proposed_fix is empty → use FALLBACK_FIX_BY_ERROR_TYPE[error_type]
```

### Remediation Decision Gate

After RCA, the system decides what to do with the result:

```
remediation_gate(incident, rca)
        │
        ├─ Error type = CONNECTIVITY_ERROR AND confidence ≥ 0.70?
        │   └─ Action: RETRY the failed message (no iFlow change needed)
        │
        ├─ AUTO_FIX_ALL_CPI_ERRORS = true  (env flag)
        │   └─ Action: AUTO_FIX immediately regardless of confidence
        │
        ├─ confidence ≥ 0.90 (AUTO_FIX_CONFIDENCE)?
        │   └─ Action: AUTO_FIX — apply fix and deploy
        │
        ├─ confidence ≥ 0.70 (SUGGEST_FIX_CONFIDENCE)?
        │   └─ Action: PENDING_APPROVAL — human must approve before fix is applied
        │
        └─ confidence < 0.70?
            └─ Action: TICKET_CREATED — escalate, no automatic action
```

---

## 6. Fix Pipeline — End-to-End Flow

The fix pipeline is the core of the self-healing capability. It is triggered by:
- The autonomous loop (when a fixable error is detected)
- The Smart Monitoring UI (user clicks "Apply Fix")
- The chatbot (user says "fix the SAP_ERP_Sync iFlow")

### Full Pipeline Steps

```
Step 0: Pre-flight iFlow unlock
  └─ Try to cancel any existing checkout (edit lock) on the iFlow
  └─ Non-fatal — continues even if no lock exists

Step 1 (conditional): Root Cause Analysis
  └─ Only runs if incident has no actionable fix yet
  └─ LangChain agent calls get_message_logs → analyses → returns JSON RCA

Step 2: Download iFlow configuration
  └─ MCP tool: get-iflow(iflow_id)
  └─ Returns current iFlow XML/ZIP configuration from SAP Design Time

Step 3: Apply fix (LLM-driven)
  └─ LLM modifies the iFlow XML based on proposed_fix
  └─ Changes mapping nodes, adapter config, script content, etc.

Step 4: Upload modified iFlow
  └─ MCP tool: update-iflow(iflow_id, modified_config)
  └─ Verified: response must contain status=200 or "successfully updated"
  └─ If response contains "locked": attempt unlock → retry once

Step 5: Deploy iFlow
  └─ MCP tool: deploy-iflow(iflow_id)
  └─ Verified: response must contain status="Success" or "DEPLOYED"
  └─ MANDATORY — never skipped after a successful update

Step 6 (optional): Replay failed message
  └─ If error type has replay_after_fix=true
  └─ MCP retry tool replays the original failed message through the fixed iFlow

Step 7: Persist result
  └─ Update AUTONOMOUS_INCIDENTS with final status, fix_summary, resolved_at
  └─ Upsert FIX_PATTERNS for future similar errors (ML feedback loop)
```

### Fix Pipeline Result States

| Status | Meaning |
|---|---|
| `AUTO_FIXED` | Fix applied and deployed autonomously |
| `HUMAN_FIXED` | Fix applied via UI-initiated action |
| `FIX_FAILED` | Fix applied but update or deploy failed |
| `RETRIED` | Transient error — message retried, no iFlow change |
| `PENDING_APPROVAL` | Confidence below AUTO_FIX threshold, awaiting human |

---

## 7. Autonomous Monitoring Loop

When `AUTONOMOUS_ENABLED=true`, the system starts a continuous background loop.

### Loop Flow

```
Server startup
    │
    └─ asyncio.create_task(_autonomous_loop())
              │
              ▼
    ┌─────────────────────────────────────────────────────┐
    │                Every POLL_INTERVAL_SECONDS (60s)    │
    │                                                     │
    │  1. fetch_failed_messages(limit=100)                │
    │     └─ OData query: Status eq 'FAILED'              │
    │     └─ Deduplicate by (iflow_id, sender, receiver,  │
    │        error_type)                                  │
    │     └─ Limit to MAX_UNIQUE_ERRORS_PER_CYCLE (25)   │
    │                                                     │
    │  2. For each unique failed message:                 │
    │     ├─ Already in DB and terminal? → skip           │
    │     ├─ Already active incident? → handle recurring  │
    │     └─ New? → process_detected_error()             │
    │                                                     │
    │  3. fetch_runtime_artifact_errors(limit=200)        │
    │     └─ OData: deployment failures from runtime      │
    │     └─ Same processing flow                         │
    │                                                     │
    └─────────────────────────────────────────────────────┘

process_detected_error(normalized_error)
    │
    ├─ Existing open incident with same (iflow_id + error_type)?
    │   └─ RECURRING: increment occurrence_count, update last_seen
    │                 re-run RCA if confidence expired
    │
    └─ New error?
        ├─ create_incident(status=DETECTED)
        ├─ run_rca()      → status: RCA_IN_PROGRESS → RCA_COMPLETE
        └─ remediation_gate() → AUTO_FIX / RETRY / PENDING_APPROVAL / TICKET
```

### Deduplication

The loop deduplicates errors by `(IntegrationFlowName, Sender, Receiver, CustomStatus)` so the same recurring error doesn't create a new incident on every poll cycle.

A `seen_sources` set tracks processed GUIDs per restart cycle to avoid reprocessing the same message in the same session.

---

## 8. Smart Monitoring UI Backend

The Smart Monitoring backend provides a full REST API for the monitoring dashboard UI.

### Incident Lifecycle

```
DETECTED → RCA_IN_PROGRESS → RCA_COMPLETE → PENDING_APPROVAL
                                          → FIX_IN_PROGRESS → AUTO_FIXED
                                                            → HUMAN_FIXED
                                                            → FIX_FAILED
                                          → TICKET_CREATED
                          → RETRIED
```

### Live Fix Progress (No Polling Delay)

When a fix is running, the UI polls `/fix_status`. To avoid slow HANA round-trips on every poll, the fix pipeline writes granular steps to an in-memory `FIX_PROGRESS` dict:

```
/apply_fix called
    │
    ├─ FIX_PROGRESS["incident-123"] = { step: "Running RCA…",          index: 1/5 }
    ├─ FIX_PROGRESS["incident-123"] = { step: "Downloading iFlow…",    index: 2/5 }
    ├─ FIX_PROGRESS["incident-123"] = { step: "Applying fix…",         index: 3/5 }
    └─ FIX_PROGRESS["incident-123"] = { step: "Fix applied",  status: "AUTO_FIXED" }

/fix_status polls
    ├─ While in progress → reads FIX_PROGRESS dict (< 1ms, no HANA)
    └─ When terminal status → one HANA query for final persisted result
```

---

## 9. Database Schema

### HANA Table: `AUTONOMOUS_INCIDENTS`

| Column | Type | Description |
|---|---|---|
| `incident_id` | NVARCHAR(50) PK | UUID |
| `message_guid` | NVARCHAR(100) | SAP CPI message GUID |
| `iflow_id` | NVARCHAR(200) | Integration flow name |
| `sender` | NVARCHAR(200) | Source system |
| `receiver` | NVARCHAR(200) | Target system |
| `status` | NVARCHAR(50) | Current lifecycle status |
| `error_type` | NVARCHAR(100) | Classified error type |
| `error_message` | NVARCHAR(2000) | Raw error text |
| `root_cause` | NCLOB | AI-generated root cause |
| `proposed_fix` | NCLOB | AI-generated fix description |
| `rca_confidence` | DOUBLE | Confidence score (0.0–1.0) |
| `affected_component` | NVARCHAR(500) | Failing iFlow component |
| `fix_summary` | NCLOB | Result of fix execution |
| `incident_group_key` | NVARCHAR(500) | Dedup key: hash(iflow+error_type) |
| `occurrence_count` | INTEGER | How many times this error recurred |
| `last_seen` | NVARCHAR(50) | Timestamp of most recent occurrence |
| `created_at` | NVARCHAR(50) | When first detected |
| `resolved_at` | NVARCHAR(50) | When fixed |
| `verification_status` | NVARCHAR(50) | VERIFIED / PENDING |
| `tags` | NCLOB | JSON array of tags |

### HANA Table: `FIX_PATTERNS`

Stores outcomes of applied fixes. Used as a learning feedback loop — recurring errors get fix templates from past successful fixes.

| Column | Type | Description |
|---|---|---|
| `pattern_id` | NVARCHAR(50) PK | UUID |
| `error_signature` | NVARCHAR(500) | Hash of iflow_id + error_type |
| `iflow_id` | NVARCHAR(200) | Integration flow |
| `error_type` | NVARCHAR(100) | Error classification |
| `root_cause` | NCLOB | What caused the error |
| `fix_applied` | NCLOB | What fix was applied |
| `outcome` | NVARCHAR(20) | SUCCESS / FAILED |
| `applied_count` | INTEGER | Times this pattern was used |
| `last_seen` | NVARCHAR(50) | Last occurrence timestamp |

### HANA Table: `QUERY_HISTORY`

| Column | Type | Description |
|---|---|---|
| `session_id` | NVARCHAR(100) PK | Chat session ID |
| `question` | NCLOB | User query |
| `answer` | NCLOB | Agent response |
| `timestamp` | NVARCHAR(50) | When asked |
| `user_id` | NVARCHAR(100) | User identifier |

### HANA Vector Table: `CPI_KNOWLEDGE_BASE`

| Column | Type | Description |
|---|---|---|
| `VEC_TEXT` | NCLOB | Knowledge base text content |
| `VEC_META` | NCLOB | JSON metadata (title, category, solution) |
| `VEC_VECTOR` | REAL_VECTOR(0) | Semantic embedding vector |

---

## 10. API Reference

### Chatbot Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/query` | Main chat with fix-intent detection |
| `POST` | `/fix` | Direct iFlow fix by incident ID |
| `GET` | `/` | Health check |
| `GET` | `/get_all_history` | Chat history for a user |
| `GET` | `/get_testsuite_logs` | Test suite execution logs |

### Smart Monitoring Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/smart-monitoring/messages` | List failed CPI messages (filterable) |
| `GET` | `/smart-monitoring/messages/paginated` | Paginated failed messages |
| `GET` | `/smart-monitoring/messages/{guid}` | Full detail for one message (6 tabs) |
| `POST` | `/smart-monitoring/messages/{guid}/analyze` | Trigger AI RCA |
| `POST` | `/smart-monitoring/messages/{guid}/generate_fix_patch` | Generate fix plan |
| `POST` | `/smart-monitoring/messages/{guid}/apply_fix` | Apply + deploy fix |
| `POST` | `/smart-monitoring/chat` | AI chat about a specific error |
| `GET` | `/smart-monitoring/stats` | Dashboard statistics summary |
| `GET` | `/smart-monitoring/incidents` | All incidents list |
| `GET` | `/smart-monitoring/incidents/{id}/fix_status` | Live fix progress (memory-backed) |
| `GET` | `/smart-monitoring/total-errors` | Total failed message count |

### Dashboard Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/dashboard/kpi-cards` | Top-level KPI metrics |
| `GET` | `/dashboard/error-distribution` | Error type breakdown (pie chart) |
| `GET` | `/dashboard/status-distribution` | Incident status breakdown |
| `GET` | `/dashboard/status-breakdown` | Detailed status counts all statuses |
| `GET` | `/dashboard/failures-over-time` | Time-series failure data |
| `GET` | `/dashboard/top-failing-iflows` | Most frequently failing iFlows |
| `GET` | `/dashboard/sender-receiver-stats` | Adapter failure analysis |
| `GET` | `/dashboard/active-incidents-table` | Real-time active incidents feed |
| `GET` | `/dashboard/recent-failures-table` | Recent failures feed |
| `GET` | `/dashboard/fix-progress-tracker` | Fix progress widget data |
| `GET` | `/dashboard/leaderboard/noisy-integrations` | Top noisy iFlows |
| `GET` | `/dashboard/leaderboard/recurring-incidents` | Most recurring errors |
| `GET` | `/dashboard/leaderboard/longest-open` | Longest unresolved incidents |
| `GET` | `/dashboard/drill-down/message/{guid}` | Specific message deep dive |
| `GET` | `/dashboard/drill-down/incident/{id}` | Specific incident deep dive |
| `GET` | `/dashboard/drill-down/iflow/{name}` | iFlow-level analytics |
| `GET` | `/dashboard/health-metrics` | System health indicators |
| `GET` | `/dashboard/sla-metrics` | SLA compliance metrics |
| `GET` | `/dashboard/rca-coverage` | RCA coverage statistics |

### Autonomous Operations Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/autonomous/start` | Start autonomous monitoring loop |
| `POST` | `/autonomous/stop` | Stop autonomous monitoring loop |
| `GET` | `/autonomous/status` | Loop status, thresholds, config |
| `GET` | `/autonomous/cpi/errors` | Fetch all current CPI errors on demand |
| `GET` | `/autonomous/cpi/messages/errors` | Fetch failed messages only |

---

## 11. Configuration & Environment Variables

### SAP AI Core (LLM)

| Variable | Description |
|---|---|
| `AICORE_CLIENT_ID` | OAuth client ID for AI Core |
| `AICORE_CLIENT_SECRET` | OAuth client secret |
| `AICORE_AUTH_URL` | OAuth token endpoint |
| `AICORE_BASE_URL` | AI Core API base URL |
| `AICORE_RESOURCE_GROUP` | AI Core resource group |
| `LLM_DEPLOYMENT_ID` | Model deployment ID (e.g. GPT-5) |

### SAP Integration Suite

| Variable | Description |
|---|---|
| `CPI_BASE_URL` | CPI tenant API base URL |
| `CPI_OAUTH_CLIENT_ID` | OAuth client ID |
| `CPI_OAUTH_CLIENT_SECRET` | OAuth client secret |
| `CPI_OAUTH_TOKEN_URL` | OAuth token endpoint |
| `SAP_HUB_TENANT_URL` | SAP Integration Hub tenant URL |
| `SAP_DESIGN_TIME_URL` | Design time API URL |

### SAP HANA Database

| Variable | Description |
|---|---|
| `HANA_ADDRESS` | HANA Cloud hostname |
| `HANA_PORT` | Port (default: 443) |
| `HANA_USER` | Runtime DB user |
| `HANA_PASSWORD` | Runtime DB password |
| `HANA_SCHEMA` | Schema name |
| `HANA_TABLE_VECTOR` | Knowledge base table (default: `CPI_KNOWLEDGE_BASE`) |

### Autonomous Loop

| Variable | Default | Description |
|---|---|---|
| `AUTONOMOUS_ENABLED` | `false` | Enable/disable autonomous loop |
| `POLL_INTERVAL_SECONDS` | `60` | Seconds between SAP polls |
| `AUTO_FIX_CONFIDENCE` | `0.90` | Confidence threshold for auto-fix |
| `SUGGEST_FIX_CONFIDENCE` | `0.70` | Confidence threshold for suggest |
| `AUTO_FIX_ALL_CPI_ERRORS` | `true` | Treat all known error types as auto-fixable |
| `AUTO_DEPLOY_AFTER_FIX` | `true` | Always deploy after update |
| `FAILED_MESSAGE_FETCH_LIMIT` | `100` | Max messages per poll |
| `MAX_UNIQUE_MESSAGE_ERRORS_PER_CYCLE` | `25` | Max unique errors processed per cycle |

### Server

| Variable | Default | Description |
|---|---|---|
| `API_HOST` | `0.0.0.0` | Bind address |
| `API_PORT` | `8080` | Bind port |
| `LOG_LEVEL` | `DEBUG` | Logging level |

---

## 12. Deployment Architecture

### Cloud Foundry (SAP BTP) — Recommended

```
SAP BTP Cloud Foundry
┌──────────────────────────────────────────────────────┐
│  App: cpi-self-healing-agent                         │
│  Runtime: Python 3.13 buildpack                      │
│  Port: 8080                                          │
│  Memory: 512MB–1GB                                   │
│  Instances: 1 (autonomous loop must run single node) │
│                                                      │
│  Bound services:                                     │
│  • SAP HANA Cloud instance                           │
│  • SAP AI Core service instance                      │
│  • Object Store (AWS S3 service binding)             │
└──────────────────────────────────────────────────────┘
```

**Start command:**
```bash
uvicorn main:app --host 0.0.0.0 --port 8080
```

### Local Development

```bash
# Install dependencies
pip install -r requirements.txt

# Copy and fill .env
cp .env.vector_store.example .env
# edit .env with real credentials

# Run with SQLite (no HANA needed)
DB_TYPE=sqlite uvicorn main:app --reload --port 8080
```

### Key Deployment Notes

- **Single instance only** — the autonomous loop and in-memory `FIX_PROGRESS` dict are not replicated across instances. Run exactly one instance.
- **`.env` must never be committed** — all secrets go in the environment.
- **MCP servers must be reachable** — the 3 MCP servers (Integration Suite, Test, Documentation) must be running and accessible from the deployed app.
- **HANA connectivity** — SAP BTP apps reach HANA Cloud directly over port 443 within the BTP ecosystem. No additional network config needed.

---

*Document prepared by Sierra Digital — SAP CPI Self-Healing Agent Team*
