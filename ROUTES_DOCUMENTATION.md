# Frontend Routes Documentation

This document lists all API routes consumed by the Dashboard, Observability, and Pipeline tabs in the React frontend application.

## Base Configuration

- **API Base URL**: `/api` (configurable via `VITE_API_BASE` environment variable)
- **Primary API**: `https://pipoflow.cfapps.us10-001.hana.ondemand.com` (configurable via `VITE_API_PRIMARY`)

---

## Dashboard Tab (`/dashboard`)

The Dashboard tab provides a comprehensive overview of the auto-remediation system with KPIs, charts, and incident tracking.

### Routes Consumed

| Route | Method | Purpose | Refresh Interval |
|-------|--------|---------|------------------|
| `/api/dashboard/kpi-cards` | GET | Fetch KPI metrics (total incidents, auto-fix rate, resolution time, etc.) | 60s |
| `/api/dashboard/status-breakdown` | GET | Get incident status distribution for pie chart | 60s |
| `/api/dashboard/error-distribution` | GET | Get error type distribution data | 60s |
| `/api/dashboard/top-failing-iflows` | GET | Get top failing integration flows | 60s |
| `/api/dashboard/failures-over-time` | GET | Get timeline data for failures chart | 60s |
| `/api/dashboard/recent-failures-table` | GET | Get recent failed messages table data | 60s |
| `/api/dashboard/active-incidents-table` | GET | Get active incidents table data | 60s |
| `/api/aem/status` | GET | Get AEM (Advanced Event Mesh) connection status and queue statistics | 60s |

### Data Displayed

- **KPI Cards**: Failed messages, total incidents, in-progress, fix failed, auto-fixed, pending approval, auto-fix rate, avg resolution time, RCA coverage
- **Charts**: Status breakdown (pie), error distribution (pie), top failing iFlows (bar), failures over time (line), AEM pipeline stage counts (bar)
- **Tables**: Recent failed messages, active incidents
- **AEM Banner**: Connection status, queue depth, stage counts

---

## Observability Tab (`/observability`)

The Observability tab provides detailed message monitoring, AI-powered analysis, and fix application capabilities.

### Routes Consumed

| Route | Method | Purpose | Refresh Interval |
|-------|--------|---------|------------------|
| `/api/smart-monitoring/messages` | GET | Fetch all monitored messages with status | 60s |
| `/api/smart-monitoring/messages/{guid}` | GET | Get detailed information for a specific message | On-demand |
| `/api/smart-monitoring/messages/{guid}/analyze` | POST | Trigger AI analysis for a message | On-demand |
| `/api/smart-monitoring/messages/{guid}/explain_error` | POST | Get AI-powered error explanation | On-demand |
| `/api/smart-monitoring/messages/{guid}/generate_fix_patch` | POST | Generate detailed fix patch with steps | On-demand |
| `/api/smart-monitoring/messages/{guid}/apply_fix` | POST | Apply the generated fix to the iFlow | On-demand |
| `/api/smart-monitoring/incidents/{incident_id}/fix_status` | GET | Poll fix application status | 5s (during fix) |
| `/api/smart-monitoring/chat` | POST | Interactive chat with AI about incidents | On-demand |
| `/api/autonomous/status` | GET | Get pipeline running status | 15s |
| `/api/aem/status` | GET | Get AEM queue statistics | 15s |

### Request Body Examples

**Analyze Message**:
```json
{
  "user_id": "user"
}
```

**Explain Error**:
```json
{
  "user_id": "user"
}
```

**Generate Fix Patch**:
```json
{
  "user_id": "user"
}
```

**Apply Fix**:
```json
{
  "user_id": "user",
  "proposed_fix": "optional fix description"
}
```

**Chat**:
```json
{
  "query": "user question",
  "user_id": "user",
  "message_guid": "optional message guid",
  "session_id": "optional session id"
}
```

### Features

- **Message List**: Filterable list of all monitored messages with status
- **Detail Panel Tabs**:
  - Error Details: Raw error messages and timestamps
  - AI Recommendations: Diagnosis, proposed fix, confidence score
  - Properties: Message properties, adapter config, business context
  - Artifact: iFlow metadata and deployment info
  - Attachments: Message payload attachments
  - History: Timeline of status changes
- **AI Features**: Error explanation, fix generation, fix application, interactive chat
- **Status Filtering**: Filter by FAILED, SUCCESS, PROCESSING, RETRY, and specific pipeline statuses

---

## Pipeline Tab (`/pipeline`)

The Pipeline tab provides control and monitoring of the autonomous remediation pipeline with agent status and incident tracking.

### Routes Consumed

| Route | Method | Purpose | Refresh Interval |
|-------|--------|---------|------------------|
| `/api/autonomous/status` | GET | Get pipeline running status and agent states | 4s |
| `/api/autonomous/start` | POST | Start the autonomous pipeline | On-demand |
| `/api/autonomous/stop` | POST | Stop the autonomous pipeline | On-demand |
| `/api/autonomous/tools` | GET | Get tool distribution across agents | On-demand |
| `/api/autonomous/incidents` | GET | Get pipeline trace (recent incidents) | 6s |
| `/api/autonomous/incidents?limit=200` | GET | Search knowledge base for similar fixes | On-demand |
| `/api/aem/status` | GET | Get AEM queue statistics and stage counts | 8s |

### Query Parameters

**Fetch Incidents**:
- `limit`: Number of incidents to retrieve (default: 30 for trace, 200 for knowledge search)
- `status`: Filter by incident status (optional)

### Features

- **Pipeline Control**: Start/Stop buttons with status indicator
- **Agent Flow Visualization**: 5 specialist agents (Observer, Classifier, RCA, Fixer, Verifier) with real-time status
- **AEM Queue Stats**: Queue depth, consumed/published/dropped message counts
- **Stage Pipeline**: Visual representation of incidents at each stage (observed, classified, rca, fix, verified)
- **Knowledge Base Search**: Search past incidents for similar error patterns and proven fixes
- **Pipeline Trace Table**: Recent incidents with iFlow, error type, status, root cause, and timestamps

### Agent Architecture

**Specialist Mode (5 agents)**:
1. **Observer**: Monitors SAP CPI for failed messages
2. **Classifier**: Classifies error type (rule-based, zero LLM cost)
3. **RCA**: Root cause analysis via SAP AI Core
4. **Fixer**: Get → validate → update → deploy iFlow
5. **Verifier**: Test fixed iFlow and replay failed messages

**AEM Mode (9 agents)** - Legacy:
1. Observer, 2. Classifier, 3. Orchestrator, 4. RCA, 5. Knowledge, 6. Aggregator, 7. Fixer, 8. Executor, 9. Learner

---

## Common Response Structures

### Incident Object
```typescript
{
  incident_id: string;
  message_guid: string;
  iflow_name: string;
  iflow_id?: string;
  error_type: string;
  status: string;
  created_at: string;
  updated_at: string;
  root_cause?: string;
  proposed_fix?: string;
  rca_confidence?: number;
  occurrence_count?: number;
}
```

### Pipeline Status
```typescript
{
  pipeline_running: boolean;
  started_at: string | null;
  aem_connected: boolean;
  agents: Record<string, "running" | "idle">;
  pipeline_type: "specialist" | "aem";
  tool_distribution?: Record<string, string[]>;
}
```

### AEM Status
```typescript
{
  aem_enabled: boolean;
  receiver_connected: boolean;
  queue_name: string;
  queue_depth: number;
  messages_retrieved: number;
  messages_published: number;
  messages_dropped: number;
  stage_counts: Record<string, number>;
  total_incidents: number;
  semp_error?: string | null;
}
```

---

## Status Values

### Pipeline Statuses
- `DETECTED` - New failure detected
- `CLASSIFIED` - Error type identified
- `RCA_IN_PROGRESS` - Root cause analysis running
- `RCA_COMPLETE` - Root cause identified
- `RCA_FAILED` - Root cause analysis failed
- `FIX_IN_PROGRESS` - Fix being generated/applied
- `FIX_FAILED` - Fix failed
- `FIX_APPLIED_PENDING_VERIFICATION` - Fix deployed, awaiting verification
- `AUTO_FIXED` - Successfully auto-remediated
- `HUMAN_FIXED` - Manually resolved
- `FIX_VERIFIED` - Fix confirmed by tests
- `PENDING_APPROVAL` - Awaiting manual approval
- `TICKET_CREATED` - Escalated to ticketing system
- `PIPELINE_ERROR` - Internal pipeline error
- `REJECTED` - Fix rejected during review
- `RETRIED` - Message successfully retried

### Message Statuses
- `FAILED` - Message processing failed
- `SUCCESS` - Message processed successfully
- `PROCESSING` - Message currently processing
- `RETRY` - Message scheduled for retry

---

## Notes

- All routes use JSON content type for requests and responses
- Authentication is handled via user_id parameter (default: "user")
- Auto-refresh intervals are configurable via React Query
- Error handling returns HTTP status codes with error messages in response body
- The frontend normalizes incident data to ensure consistent iflow_name display across different backend response formats