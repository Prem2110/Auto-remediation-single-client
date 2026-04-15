import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  fetchMonitorMessages,
  fetchMonitorMessageDetail,
  analyzeMessage,
  explainError,
  generateFixPatch,
  applyMessageFix,
  fetchFixStatus,
  smartMonitoringChat,
  fetchPipelineStatus,
  fetchQueueStats,
} from "../../services/api.ts";
import type {
  IMonitorMessage,
  IFilterState,
  IMessageDetail,
  IFixPatchResponse,
  IFieldChange,
  IFixPlanStep,
  IHistoryTimelineEntry,
  IErrorExplanation,
} from "../../types/index.ts";
import styles from "./observability.module.css";

/* ── Status config ───────────────────────────────────────────────────── */
type StatusCfg = { label: string; color: string; bg: string; dot: string };

const RED:    StatusCfg = { label: "Failed",        color: "#dc2626", bg: "#fee2e2", dot: "#ef4444" };
const GREEN:  StatusCfg = { label: "Success",       color: "#16a34a", bg: "#dcfce7", dot: "#22c55e" };
const BLUE:   StatusCfg = { label: "Processing",    color: "#2563eb", bg: "#dbeafe", dot: "#3b82f6" };
const AMBER:  StatusCfg = { label: "Retry",         color: "#d97706", bg: "#fef3c7", dot: "#f59e0b" };
const PURPLE: StatusCfg = { label: "Pending",       color: "#7c3aed", bg: "#ede9fe", dot: "#8b5cf6" };
const GREY:   StatusCfg = { label: "Unknown",       color: "#6b7280", bg: "#f3f4f6", dot: "#9ca3af" };

const STATUS_CONFIG: Record<string, StatusCfg> = {
  FAILED:     RED,
  SUCCESS:    GREEN,
  PROCESSING: BLUE,
  RETRY:      AMBER,
  // Pipeline statuses
  DETECTED:                       { ...RED,   label: "Detected" },
  CLASSIFIED:                     { ...BLUE,  label: "Classified" },
  RCA_IN_PROGRESS:                { ...BLUE,  label: "Analyzing" },
  RCA_COMPLETE:                   { ...BLUE,  label: "RCA Done" },
  RCA_FAILED:                     { ...RED,   label: "RCA Failed" },
  FIX_IN_PROGRESS:                { ...AMBER, label: "Fixing" },
  FIX_FAILED:                     { ...RED,   label: "Fix Failed" },
  FIX_APPLIED_PENDING_VERIFICATION:{ ...AMBER,label: "Verifying" },
  AUTO_FIXED:                     { ...GREEN, label: "Auto-Fixed" },
  HUMAN_FIXED:                    { ...GREEN, label: "Fixed" },
  FIX_VERIFIED:                   { ...GREEN, label: "Verified" },
  PENDING_APPROVAL:               { ...PURPLE,label: "Pending Approval" },
  TICKET_CREATED:                 { ...PURPLE,label: "Ticket Created" },
  PIPELINE_ERROR:                 { ...RED,   label: "Pipeline Error" },
  REJECTED:                       { ...GREY,  label: "Rejected" },
  RETRIED:                        { ...GREEN, label: "Retried" },
};

function StatusPill({ status }: { status: string }) {
  const key = (status || "").toUpperCase();
  const cfg = STATUS_CONFIG[key] ?? { ...GREY, label: status || "Unknown" };
  return (
    <span className={styles.statusPill} style={{ color: cfg.color, background: cfg.bg }}>
      <span className={styles.statusDot} style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

const TERMINAL_STATUSES = new Set([
  "AUTO_FIXED", "HUMAN_FIXED", "FIX_VERIFIED", "RETRIED",
  "FIX_FAILED", "PIPELINE_ERROR", "REJECTED", "TICKET_CREATED",
]);

/* ── Tab definitions ─────────────────────────────────────────────────── */
type TabKey = "error" | "ai" | "properties" | "artifact" | "attachments" | "history";

const TABS: { key: TabKey; label: string; tip: string }[] = [
  { key: "error",       label: "Error Details",                       tip: "Raw error message, error type and processing timestamps from SAP CPI" },
  { key: "ai",          label: "AI Recommendations & Suggested Fix",  tip: "AI-generated diagnosis, proposed fix and confidence score from SAP AI Core" },
  { key: "properties",  label: "Properties",                          tip: "Message properties, adapter configuration and business context" },
  { key: "artifact",    label: "Artifact",                            tip: "iFlow artifact metadata: version, deployment info and runtime node" },
  { key: "attachments", label: "Attachments",                         tip: "Message payload attachments from the CPI processing log" },
  { key: "history",     label: "History",                             tip: "Timeline of status changes for this remediation incident" },
];

const INITIAL_FILTERS: IFilterState = {
  statuses: [], types: [], artifacts: [],
  dateFrom: "", dateTo: "", idQuery: "", searchQuery: "",
};

const CARD_TIPS: Record<string, string> = {
  FAILED:      "Messages in FAILED, FIX_FAILED, RCA_FAILED or DETECTED state — need attention",
  SUCCESS:     "Messages that reached AUTO_FIXED, HUMAN_FIXED or FIX_VERIFIED state",
  PROCESSING:  "Messages currently in RCA, classification or fix-in-progress stages",
  RETRY:       "Messages pending approval, ticket created or scheduled for retry",
  DETECTED:    "New failure detected — awaiting pipeline classification",
  CLASSIFIED:  "Error type identified — root cause analysis pending",
  RCA_IN_PROGRESS:  "Root cause analysis is currently running via SAP AI Core",
  RCA_COMPLETE:     "Root cause identified — fix generation is pending",
  RCA_FAILED:       "Root cause analysis failed — may require manual investigation",
  FIX_IN_PROGRESS:  "Automated fix is being generated or applied to the iFlow",
  FIX_FAILED:       "Automated fix failed — manual intervention required",
  FIX_APPLIED_PENDING_VERIFICATION: "Fix deployed — awaiting automated test verification",
  AUTO_FIXED:       "Successfully remediated by the autonomous pipeline without human intervention",
  HUMAN_FIXED:      "Manually resolved by a human operator",
  FIX_VERIFIED:     "Fix deployed and confirmed by automated integration tests",
  PENDING_APPROVAL: "Fix ready — awaiting manual approval before deployment to production",
  TICKET_CREATED:   "Escalated to ticketing system for manual handling",
  PIPELINE_ERROR:   "Internal pipeline error — check the pipeline logs for details",
  REJECTED:         "Fix was rejected during manual review",
  RETRIED:          "Message was successfully retried",
};

/* ── Field-change highlight component ────────────────────────────────── */
function FieldChangeHighlight({ changes }: { changes: IFieldChange[] }) {
  if (!changes?.length) return null;
  return (
    <div className={styles.fieldChanges}>
      {changes.map((fc, i) => (
        <div key={i} className={styles.fieldChangeRow}>
          Field <span className={styles.oldField}>{fc.old_field}</span> was renamed to{" "}
          <span className={styles.newField}>{fc.new_field}</span> but message mapping still references{" "}
          <span className={styles.oldField}>{fc.old_field}</span>
        </div>
      ))}
    </div>
  );
}

/* ── Confidence badge ────────────────────────────────────────────────── */
function ConfidenceBadge({ value, label }: { value: number; label: string }) {
  const pct = Math.round(value * 100);
  const color = value >= 0.9 ? "#16a34a" : value >= 0.7 ? "#d97706" : "#dc2626";
  return (
    <div className={styles.confidenceSection}>
      <span className={styles.confidenceVal} style={{ color }}>
        Confidence: {value.toFixed(2)} ({label})
      </span>
      <div className={styles.confidenceBar}>
        <div className={styles.confidenceFill} style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

/* ── Fix Plan Step component ─────────────────────────────────────────── */
function FixPlanSteps({ steps }: { steps: IFixPlanStep[] }) {
  return (
    <div className={styles.fixPlanSteps}>
      {steps.map((s) => (
        <div key={s.step_number} className={styles.fixPlanStep}>
          <div className={styles.fixStepHeader}>
            <span className={styles.fixStepNum}>{s.step_number}.</span>
            <span className={styles.fixStepTitle}>{s.title}</span>
          </div>
          <p className={styles.fixStepDesc}>{s.description}</p>
          {s.sub_steps?.length > 0 && (
            <ul className={styles.fixSubSteps}>
              {s.sub_steps.map((sub, j) => <li key={j}>{sub}</li>)}
            </ul>
          )}
          {s.note && <div className={styles.fixStepNote}>{s.note}</div>}
        </div>
      ))}
    </div>
  );
}

/* ── Timeline component for History tab ──────────────────────────────── */
function Timeline({ entries }: { entries: IHistoryTimelineEntry[] }) {
  const statusIcon: Record<string, string> = {
    completed: "check_circle", failed: "error", pending: "schedule",
    in_progress: "sync", info: "info",
  };
  const statusColor: Record<string, string> = {
    completed: "#16a34a", failed: "#dc2626", pending: "#d97706",
    in_progress: "#2563eb", info: "#6b7280",
  };
  return (
    <div className={styles.timeline}>
      {entries.map((e, i) => (
        <div key={i} className={styles.timelineEntry}>
          <div className={styles.timelineDot} style={{ background: statusColor[e.status] || "#6b7280" }}>
            {(statusIcon[e.status] || "circle")[0].toUpperCase()}
          </div>
          <div className={styles.timelineContent}>
            <div className={styles.timelineStep}>{e.step}</div>
            <div className={styles.timelineDesc}>{e.description}</div>
            {e.timestamp && <div className={styles.timelineTs}>{e.timestamp}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── Rich text renderer (handles newlines + simple bullet lines) ──────── */
function RichText({ text }: { text: string }) {
  if (!text) return null;
  const lines = text.split(/\n/).filter((l) => l.trim());
  return (
    <div className={styles.richText}>
      {lines.map((line, i) => {
        const isBullet = /^[-•*]\s/.test(line);
        const isNum    = /^\d+\.\s/.test(line);
        if (isBullet) return (
          <div key={i} className={styles.richBullet}>
            <span className={styles.richBulletDot}>•</span>
            <span>{line.replace(/^[-•*]\s/, "")}</span>
          </div>
        );
        if (isNum) return (
          <div key={i} className={styles.richBullet}>
            <span className={styles.richBulletDot}>{line.match(/^\d+/)?.[0]}.</span>
            <span>{line.replace(/^\d+\.\s/, "")}</span>
          </div>
        );
        return <p key={i} className={styles.richPara}>{line}</p>;
      })}
    </div>
  );
}

/* ── AI Error Explanation card ────────────────────────────────────────── */
const CATEGORY_COLORS: Record<string, { color: string; bg: string }> = {
  HTTP_ERROR:          { color: "#b91c1c", bg: "#fee2e2" },
  MAPPING_ERROR:       { color: "#92400e", bg: "#fef3c7" },
  CONNECTIVITY_ERROR:  { color: "#1e40af", bg: "#dbeafe" },
  AUTH_ERROR:          { color: "#6b21a8", bg: "#f3e8ff" },
  DATA_ERROR:          { color: "#92400e", bg: "#fef3c7" },
  TIMEOUT_ERROR:       { color: "#9a3412", bg: "#ffedd5" },
  CONFIG_ERROR:        { color: "#1e40af", bg: "#dbeafe" },
  RUNTIME_ERROR:       { color: "#b91c1c", bg: "#fee2e2" },
};

function ErrorExplanationCard({ exp }: { exp: IErrorExplanation }) {
  const catStyle = CATEGORY_COLORS[exp.error_category] ?? { color: "#374151", bg: "#f3f4f6" };
  return (
    <div className={styles.explainCard}>
      <div className={styles.explainCardHeader}>
        <span className={styles.explainSparkle}>✦</span>
        <span className={styles.explainCardTitle}>AI Error Analysis</span>
        <span className={styles.explainCategoryBadge} style={{ color: catStyle.color, background: catStyle.bg }}>
          {exp.category_label || exp.error_category}
        </span>
      </div>

      {exp.summary && (
        <div className={styles.explainSummaryBox}>
          <p className={styles.explainSummaryText}>{exp.summary}</p>
        </div>
      )}

      {exp.what_happened && (
        <div className={styles.explainSection}>
          <div className={styles.explainSectionLabel}>What Happened</div>
          <p className={styles.explainSectionBody}>{exp.what_happened}</p>
        </div>
      )}

      {exp.likely_causes?.length > 0 && (
        <div className={styles.explainSection}>
          <div className={styles.explainSectionLabel}>Likely Causes</div>
          <ul className={styles.explainList}>
            {exp.likely_causes.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}

      {exp.recommended_actions?.length > 0 && (
        <div className={styles.explainSection}>
          <div className={styles.explainSectionLabel}>Recommended Actions</div>
          <ol className={styles.explainList}>
            {exp.recommended_actions.map((a, i) => <li key={i}>{a}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
   ════════════════════════════════════════════════════════════════════════ */
export default function Observability() {
  const [filters, setFilters] = useState<IFilterState>(INITIAL_FILTERS);
  const [selectedGuid, setSelectedGuid] = useState<string | null>(null);
  const [detail, setDetail] = useState<IMessageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("error");

  // Error explanation state
  const [errorExplain, setErrorExplain]           = useState<IErrorExplanation | null>(null);
  const [errorExplainLoading, setErrorExplainLoading] = useState(false);
  const [errorExplainErr, setErrorExplainErr]     = useState<string | null>(null);

  // Fix-related state
  const [fixPatch, setFixPatch] = useState<IFixPatchResponse | null>(null);
  const [fixPatchLoading, setFixPatchLoading] = useState(false);
  const [fixState, setFixState] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [fixResult, setFixResult] = useState<string>("");
  const [analyzeLoading, setAnalyzeLoading] = useState(false);

  // Chat state
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: "user" | "ai"; text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["monitor-messages"],
    queryFn: fetchMonitorMessages,
    refetchInterval: 60_000,
  });

  const { data: pipelineData } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn:  fetchPipelineStatus,
    refetchInterval: 15_000,
  });
  const { data: queueRaw } = useQuery({
    queryKey: ["queue-stats"],
    queryFn:  fetchQueueStats,
    refetchInterval: 15_000,
    enabled:  pipelineData?.aem_connected ?? false,
  });

  const aemConnected = pipelineData?.aem_connected ?? false;
  const qs           = (queueRaw ?? {}) as Record<string, unknown>;
  const aemQueues    = (qs.queues ?? {}) as Record<string, { queue_depth: number; messages_retrieved: number }>;
  const aemDepth     = Object.values(aemQueues).reduce((s, q) => s + (q.queue_depth ?? 0), 0);
  const stageCounts  = (qs.stage_counts ?? {}) as Record<string, number>;
  const sempError    = qs.semp_error as string | null;

  const STATUS_GROUP: Record<string, string[]> = {
    FAILED:     ["FAILED", "FIX_FAILED", "RCA_FAILED", "PIPELINE_ERROR", "DETECTED"],
    SUCCESS:    ["AUTO_FIXED", "HUMAN_FIXED", "FIX_VERIFIED", "RETRIED", "SUCCESS"],
    PROCESSING: ["RCA_IN_PROGRESS", "FIX_IN_PROGRESS", "CLASSIFIED", "RCA_COMPLETE", "FIX_APPLIED_PENDING_VERIFICATION", "PROCESSING"],
    RETRY:      ["RETRY", "PENDING_APPROVAL", "TICKET_CREATED"],
  };

  const messages = useMemo(() => {
    return ((data?.messages || []) as IMonitorMessage[]).filter((m) => {
      const s = (m.status || "").toUpperCase();
      if (filters.statuses.length) {
        const allowed = filters.statuses.flatMap((g) => STATUS_GROUP[g] || [g]);
        if (!allowed.includes(s)) return false;
      }
      if (filters.searchQuery) {
        const q = filters.searchQuery.toLowerCase();
        if (!(m.iflow_display || m.title || "").toLowerCase().includes(q)) return false;
      }
      if (filters.idQuery) {
        const q = filters.idQuery.toLowerCase();
        if (!(m.message_guid || "").toLowerCase().includes(q) &&
            !(m.iflow_display || "").toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [data, filters]);

  const counts = useMemo(() => {
    const all = (data?.messages || []) as IMonitorMessage[];
    const result: Record<string, number> = { FAILED: 0, SUCCESS: 0, PROCESSING: 0, RETRY: 0 };
    all.forEach((m) => {
      const s = (m.status || "").toUpperCase();
      if (["FAILED", "FIX_FAILED", "RCA_FAILED", "PIPELINE_ERROR", "DETECTED"].includes(s)) result.FAILED++;
      else if (["AUTO_FIXED", "HUMAN_FIXED", "FIX_VERIFIED", "RETRIED"].includes(s)) result.SUCCESS++;
      else if (["RCA_IN_PROGRESS", "FIX_IN_PROGRESS", "CLASSIFIED", "RCA_COMPLETE", "FIX_APPLIED_PENDING_VERIFICATION"].includes(s)) result.PROCESSING++;
      else if (["RETRY", "PENDING_APPROVAL", "TICKET_CREATED"].includes(s)) result.RETRY++;
    });
    return result;
  }, [data]);

  /* ── Select a message and load full detail ─────────────────────────── */
  const handleSelect = useCallback(async (msg: IMonitorMessage) => {
    const guid = msg.message_guid;
    if (!guid) return;
    setSelectedGuid(guid);
    setDetail(null);
    setFixPatch(null);
    setFixState("idle");
    setFixResult("");
    setActiveTab("error");
    setChatMessages([]);
    setChatSessionId(null);
    setErrorExplain(null);
    setErrorExplainLoading(false);
    setErrorExplainErr(null);
    setDetailLoading(true);
    try {
      const d = await fetchMonitorMessageDetail(guid) as IMessageDetail;
      setDetail(d);
      // Auto-switch to AI tab if RCA is already available
      if (d.ai_recommendation?.diagnosis) {
        setActiveTab("ai");
      }
    } catch {
      // Keep previous state
    } finally {
      setDetailLoading(false);
    }
  }, []);

  /* ── Run / re-run AI analysis ──────────────────────────────────────── */
  const handleAnalyze = useCallback(async () => {
    if (!selectedGuid) return;
    setAnalyzeLoading(true);
    try {
      await analyzeMessage(selectedGuid);
      // Reload detail to get fresh RCA
      const d = await fetchMonitorMessageDetail(selectedGuid) as IMessageDetail;
      setDetail(d);
      setActiveTab("ai");
    } catch {
      // handled
    } finally {
      setAnalyzeLoading(false);
    }
  }, [selectedGuid]);

  /* ── Explain error ─────────────────────────────────────────────────── */
  const handleExplainError = useCallback(async () => {
    if (!selectedGuid) return;
    setErrorExplainLoading(true);
    setErrorExplainErr(null);
    try {
      const exp = await explainError(selectedGuid) as IErrorExplanation;
      setErrorExplain(exp);
    } catch (e) {
      setErrorExplainErr(e instanceof Error ? e.message : "Failed to explain error");
    } finally {
      setErrorExplainLoading(false);
    }
  }, [selectedGuid]);

  /* ── Generate fix patch ────────────────────────────────────────────── */
  const handleGenerateFixPatch = useCallback(async () => {
    if (!selectedGuid) return;
    setFixPatchLoading(true);
    try {
      const patch = await generateFixPatch(selectedGuid) as IFixPatchResponse;
      setFixPatch(patch);
    } catch {
      // handled
    } finally {
      setFixPatchLoading(false);
    }
  }, [selectedGuid]);

  /* ── Apply fix (with status polling) ───────────────────────────────── */
  const pollAbortRef = useRef<{ cancelled: boolean }>({ cancelled: false });

  const handleApplyFix = useCallback(async () => {
    if (!selectedGuid) return;
    setFixState("loading");
    setFixResult("Applying fix… get-iflow → update-iflow → deploy-iflow");
    pollAbortRef.current.cancelled = false;
    try {
      const proposedFix =
        fixPatch?.summary_structured?.proposed_fix ||
        detail?.ai_recommendation?.proposed_fix ||
        undefined;
      const result = await applyMessageFix(selectedGuid, "user", proposedFix) as Record<string, unknown>;
      const incidentId = (result.incident_id as string) || detail?.incident_id || "";

      // If backend responded synchronously with terminal outcome, use it directly
      const syncStatus = (result.status as string || "").toUpperCase();
      const syncFixApplied = result.fix_applied === true;
      const syncDeploy = result.deploy_success === true;

      if (syncStatus === "AUTO_FIXED" || syncStatus === "HUMAN_FIXED" || (syncFixApplied && syncDeploy)) {
        setFixState("success");
        setFixResult((result.summary as string) || "Fix applied and deployed successfully.");
      } else if (syncStatus === "FIX_FAILED") {
        setFixState("error");
        setFixResult((result.summary as string) || "Fix failed.");
      } else if (incidentId) {
        // Background mode — poll fix_status until terminal
        for (let i = 0; i < 60; i++) {  // up to ~5 min (60 * 5s)
          if (pollAbortRef.current.cancelled) break;
          await new Promise((r) => setTimeout(r, 5000));
          try {
            const s = await fetchFixStatus(incidentId) as Record<string, unknown>;
            const st = (s.status as string || "").toUpperCase();
            setFixResult(`Status: ${st}…`);
            if (TERMINAL_STATUSES.has(st)) {
              if (["AUTO_FIXED", "HUMAN_FIXED", "FIX_VERIFIED", "RETRIED"].includes(st)) {
                setFixState("success");
                setFixResult((s.fix_summary as string) || "Fix applied and deployed.");
              } else {
                setFixState("error");
                setFixResult((s.fix_summary as string) || `Fix failed (${st}).`);
              }
              break;
            }
          } catch {
            // keep polling
          }
        }
        if (fixState === "loading") {
          // No terminal status reached — leave UI in current state
          setFixResult("Still in progress. Refresh later for final status.");
        }
      } else {
        setFixState("success");
        setFixResult((result.message as string) || "Fix queued. Refresh later for status.");
      }

      // Refresh detail panel
      try {
        const d = await fetchMonitorMessageDetail(selectedGuid) as IMessageDetail;
        setDetail(d);
      } catch { /* ignore */ }
    } catch (e) {
      setFixState("error");
      setFixResult(e instanceof Error ? e.message : "Fix failed");
    }
  }, [selectedGuid, fixPatch, detail, fixState]);

  // Cancel any in-flight polling when a different message is selected
  useEffect(() => {
    return () => { pollAbortRef.current.cancelled = true; };
  }, [selectedGuid]);

  /* ── Chat ──────────────────────────────────────────────────────────── */
  const handleChat = useCallback(async () => {
    if (!chatInput.trim() || !selectedGuid) return;
    const userMsg = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: userMsg }]);
    setChatLoading(true);
    try {
      const resp = await smartMonitoringChat(userMsg, "user", selectedGuid, chatSessionId || undefined);
      setChatSessionId(resp.session_id);
      setChatMessages((prev) => [...prev, { role: "ai", text: resp.answer }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", text: "Sorry, I could not process your query." }]);
    } finally {
      setChatLoading(false);
    }
  }, [chatInput, selectedGuid, chatSessionId]);

  /* ════════════════════════════════════════════════════════════════════
     RENDER
     ════════════════════════════════════════════════════════════════════ */
  return (
    <div className={styles.page}>

      {/* ── AEM Status Banner ── */}
      <div className={styles.aemBanner} data-connected={String(aemConnected)}>
        <span className={styles.aemDot} />
        <span className={styles.aemBannerLabel}>
          {aemConnected ? "AEM Connected" : "AEM Offline — incidents sourced directly from SAP CPI"}
        </span>
        {aemConnected && (
          <>
            <span className={styles.aemSep}>·</span>
            <span className={styles.aemStat} data-tip="Total messages waiting in the AEM queue for pipeline processing">Queue: <strong>{aemDepth}</strong></span>
            {Object.entries(stageCounts).map(([stage, n]) => (
              <span key={stage} className={styles.aemStage} data-tip={`${n} incident${n !== 1 ? "s" : ""} currently at the ${stage} stage`}>{stage}: {n}</span>
            ))}
            {sempError && <span className={styles.aemError} data-tip="SEMP (Solace Element Management Protocol) REST API error — queue statistics may be inaccurate">SEMP: {sempError}</span>}
          </>
        )}
      </div>

      {/* ── Summary cards ── */}
      <div className={styles.summaryRow}>
        {Object.entries(STATUS_CONFIG).map(([k, cfg]) => (
          <div
            key={k}
            className={`${styles.summaryCard} ${filters.statuses.includes(k) ? styles.summaryCardActive : ""}`}
            style={{ borderTop: `3px solid ${cfg.dot}` }}
            onClick={() => setFilters((f) => ({
              ...f,
              statuses: f.statuses.includes(k) ? f.statuses.filter((s) => s !== k) : [...f.statuses, k],
            }))}
            data-tip={CARD_TIPS[k] ?? `Click to filter by ${cfg.label} status`}
          >
            <span className={styles.summaryCount} style={{ color: cfg.color }}>
              {counts[k] ?? 0}
            </span>
            <span className={styles.summaryLabel} style={{ color: cfg.color }}>{cfg.label}</span>
          </div>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className={styles.filterBar}>
        <input
          className={styles.filterInput}
          placeholder="Search messages..."
          value={filters.searchQuery}
          onChange={(e) => setFilters((f) => ({ ...f, searchQuery: e.target.value }))}
          title="Filter messages by iFlow name or message title"
        />
        <input
          className={styles.filterInput}
          placeholder="Message ID / iFlow name..."
          value={filters.idQuery}
          onChange={(e) => setFilters((f) => ({ ...f, idQuery: e.target.value }))}
          title="Filter by message GUID or iFlow name (exact or partial match)"
        />
        <select
          className={styles.filterSelect}
          value=""
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            setFilters((f) => ({ ...f, statuses: f.statuses.includes(v) ? f.statuses.filter((s) => s !== v) : [...f.statuses, v] }));
          }}
          title="Filter messages by their current remediation pipeline status"
        >
          <option value="">Filter by Status...</option>
          {Object.entries(STATUS_CONFIG).map(([k, c]) => <option key={k} value={k}>{c.label}</option>)}
        </select>
        <button
          className={styles.refreshBtn}
          onClick={() => refetch()}
          disabled={isFetching}
          data-tip="Reload messages from SAP CPI (auto-refreshes every 60s)"
        >
          {isFetching ? "..." : "Refresh"}
        </button>
        <button className={styles.resetBtn} onClick={() => setFilters(INITIAL_FILTERS)} data-tip="Clear all active filters and show all messages">Reset</button>
      </div>

      {/* Active filter chips */}
      {filters.statuses.length > 0 && (
        <div className={styles.chipRow}>
          {filters.statuses.map((s) => {
            const cfg = STATUS_CONFIG[s];
            return (
              <span key={s} className={styles.filterChip} style={{ background: cfg.bg, color: cfg.color, borderColor: cfg.dot }}>
                {cfg.label}
                <button onClick={() => setFilters((f) => ({ ...f, statuses: f.statuses.filter((x) => x !== s) }))} data-tip="Remove this filter">x</button>
              </span>
            );
          })}
        </div>
      )}

      {/* ── Two-column layout ── */}
      <div className={styles.columns}>
        {/* Message list */}
        <div className={`${styles.listCol} ${selectedGuid ? styles.listColNarrow : ""}`}>
          {isLoading ? (
            <div className={styles.centered}>
              <div className={styles.spinner} />
              <span>Loading messages...</span>
            </div>
          ) : messages.length === 0 ? (
            <div className={styles.centered}>
              <span>No messages found</span>
            </div>
          ) : (
            <div className={styles.messageList}>
              {messages.map((msg, i) => {
                const cfg = STATUS_CONFIG[msg.status?.toUpperCase()] ?? STATUS_CONFIG.FAILED;
                const isSelected = selectedGuid === msg.message_guid;
                return (
                  <div
                    key={msg.message_guid || i}
                    className={`${styles.messageRow} ${isSelected ? styles.messageRowSelected : ""}`}
                    style={{ borderLeft: `3px solid ${isSelected ? cfg.dot : "transparent"}` }}
                    onClick={() => handleSelect(msg)}
                  >
                    <div className={styles.messageMain}>
                      <StatusPill status={msg.status} />
                      <span className={styles.messageName}>
                        {msg.iflow_display || msg.title || "Unknown"}
                      </span>
                    </div>
                    <div className={styles.messageMeta}>
                      <span className={styles.metaItem} data-tip="Message processing duration in SAP CPI">{msg.duration || "--"}</span>
                      <span className={styles.metaItem} data-tip="Last updated or processing start timestamp">{msg.log_start || msg.updatedAt || "--"}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Detail panel ── */}
        {selectedGuid && (
          <div className={styles.detailPanel}>
            {/* Header */}
            <div className={styles.detailHeader}>
              <div className={styles.detailHeaderLeft}>
                <h3 className={styles.detailTitle}>
                  {detail?.iflow_display || selectedGuid}
                </h3>
                <StatusPill status={detail?.status || "FAILED"} />
                {detail?.last_updated && (
                  <span className={styles.detailUpdated}>
                    Last Updated at: {detail.last_updated}
                  </span>
                )}
              </div>
              <div className={styles.detailHeaderRight}>
                <button
                  className={styles.recheckBtn}
                  onClick={handleAnalyze}
                  disabled={analyzeLoading}
                  data-tip="Re-run AI analysis — useful after applying a fix to get fresh diagnosis and recommendations"
                >
                  {analyzeLoading ? "Analyzing..." : "Recheck"}
                </button>
                <button className={styles.closeBtn} onClick={() => { setSelectedGuid(null); setDetail(null); }} data-tip="Close detail panel">x</button>
              </div>
            </div>

            {/* Tab bar */}
            <div className={styles.tabBar}>
              {TABS.map((tab) => (
                <button
                  key={tab.key}
                  className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                  data-tip={tab.tip}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            {detailLoading ? (
              <div className={styles.centered}>
                <div className={styles.spinner} />
                <span>Loading details...</span>
              </div>
            ) : detail ? (
              <div className={styles.detailBody}>
                {/* ─── Error Details tab ─── */}
                {activeTab === "error" && (
                  <div className={styles.tabContent}>
                    <div className={styles.errorBox}>
                      <code className={styles.errorCode}>
                        {detail.error_details.error_message || detail.error_details.raw_error_text || "No error details available"}
                      </code>
                    </div>
                    {detail.error_details.error_type && (
                      <div className={styles.detailMeta}>
                        <span className={styles.metaLabel}>Error Type:</span>
                        <span className={styles.metaValue}>{detail.error_details.error_type}</span>
                      </div>
                    )}
                    {detail.error_details.log_start && (
                      <div className={styles.detailMeta}>
                        <span className={styles.metaLabel}>Processing Start:</span>
                        <span className={styles.metaValue}>{detail.error_details.log_start}</span>
                      </div>
                    )}
                    {detail.error_details.log_end && (
                      <div className={styles.detailMeta}>
                        <span className={styles.metaLabel}>Processing End:</span>
                        <span className={styles.metaValue}>{detail.error_details.log_end}</span>
                      </div>
                    )}

                    {/* ── AI Error Explanation ── */}
                    <div className={styles.explainTrigger}>
                      {errorExplain ? (
                        <ErrorExplanationCard exp={errorExplain} />
                      ) : (
                        <button
                          className={styles.explainBtn}
                          onClick={handleExplainError}
                          disabled={errorExplainLoading}
                          data-tip="Ask SAP AI Core to explain this error in plain English with likely causes and recommended actions"
                        >
                          {errorExplainLoading
                            ? <><span className={styles.explainSpinner} /> Analyzing error...</>
                            : <><span className={styles.explainSparkle}>✦</span> Explain with AI</>
                          }
                        </button>
                      )}
                      {errorExplainErr && (
                        <div className={styles.explainErrText}>{errorExplainErr}</div>
                      )}
                    </div>
                  </div>
                )}

                {/* ─── AI Recommendations & Suggested Fix tab ─── */}
                {activeTab === "ai" && (
                  <div className={styles.tabContent}>
                    {!detail.ai_recommendation?.diagnosis && !analyzeLoading ? (
                      <div className={styles.noRcaBox}>
                        <p>No AI analysis available yet for this message.</p>
                        <button className={styles.analyzeBtn} onClick={handleAnalyze} disabled={analyzeLoading} data-tip="Trigger SAP AI Core to analyze this message and generate a root cause and fix recommendation">
                          {analyzeLoading ? "Running Analysis..." : "Run AI Analysis"}
                        </button>
                      </div>
                    ) : (
                      <>
                        {/* AI Recommendations header */}
                        <div className={styles.aiHeader}>
                          <span className={styles.aiIcon}>*</span>
                          <span className={styles.aiTitle}>AI Recommendations & Suggested Fix</span>
                        </div>

                        {/* Diagnosis */}
                        {detail.ai_recommendation.diagnosis && (
                          <div className={styles.aiSection}>
                            <div className={styles.aiSectionLabel}>Diagnosis:</div>
                            <div className={styles.aiSectionText}>
                              <RichText text={detail.ai_recommendation.diagnosis} />
                            </div>
                          </div>
                        )}

                        {/* Field change highlights */}
                        <FieldChangeHighlight changes={detail.ai_recommendation.field_changes} />

                        {/* Proposed fix */}
                        {detail.ai_recommendation.proposed_fix && (
                          <div className={styles.aiSection}>
                            <div className={styles.aiSectionLabel}>Suggested Fix:</div>
                            <div className={styles.aiSectionText}>
                              <RichText text={detail.ai_recommendation.proposed_fix} />
                            </div>
                          </div>
                        )}

                        {/* Confidence */}
                        {detail.ai_recommendation.confidence > 0 && (
                          <div data-tip="AI confidence in the root cause: ≥90% = High (green), 70–89% = Medium (amber), <70% = Low (red)">
                            <ConfidenceBadge
                              value={detail.ai_recommendation.confidence}
                              label={detail.ai_recommendation.confidence_label}
                            />
                          </div>
                        )}

                        {/* Fix Patch section */}
                        {fixPatch ? (
                          <div className={styles.fixPatchSection}>
                            <h4 className={styles.fixPatchTitle}>Steps (Fix Plan)</h4>
                            {fixPatch.summary && (
                              <div className={styles.fixPatchSummary}>
                                <strong>Summary:</strong> {fixPatch.summary}
                              </div>
                            )}
                            <FixPlanSteps steps={fixPatch.steps} />

                            {/* Apply Fix button */}
                            {fixPatch.can_apply && (
                              <div className={styles.fixActionBar}>
                                <button
                                  className={`${styles.applyFixBtn} ${styles[`applyFixBtn_${fixState}`] || ""}`}
                                  onClick={handleApplyFix}
                                  disabled={fixState === "loading" || fixState === "success"}
                                  data-tip="Execute the fix pipeline: get-iflow → validate → update-iflow → deploy-iflow via the SAP IS API"
                                >
                                  {fixState === "idle"    && "Apply Fix"}
                                  {fixState === "loading" && "Applying..."}
                                  {fixState === "success" && "Fix Applied"}
                                  {fixState === "error"   && "Retry Fix"}
                                </button>
                                {fixResult && (
                                  <span className={styles.fixResultText}>{fixResult}</span>
                                )}
                              </div>
                            )}
                          </div>
                        ) : (
                          /* Generate Fix Patch button */
                          detail.ai_recommendation.can_generate_fix && (
                            <div className={styles.fixActionBar}>
                              <button
                                className={styles.generateFixBtn}
                                onClick={handleGenerateFixPatch}
                                disabled={fixPatchLoading}
                                data-tip="Ask the AI to generate a detailed step-by-step fix plan with XML change instructions"
                              >
                                {fixPatchLoading ? "Generating..." : "* Generate Fix Patch"}
                              </button>
                            </div>
                          )
                        )}

                        {/* Chat section */}
                        <div className={styles.chatSection}>
                          {chatMessages.length > 0 && (
                            <div className={styles.chatMessages}>
                              {chatMessages.map((m, i) => (
                                <div key={i} className={`${styles.chatMsg} ${styles[`chatMsg_${m.role}`]}`}>
                                  <span className={styles.chatRole}>{m.role === "user" ? "You" : "AI"}:</span>
                                  <span>{m.text}</span>
                                </div>
                              ))}
                              {chatLoading && <div className={styles.chatLoading}>AI is thinking...</div>}
                            </div>
                          )}
                          <div className={styles.chatInputRow}>
                            <input
                              className={styles.chatInput}
                              placeholder="Ask your queries here"
                              value={chatInput}
                              onChange={(e) => setChatInput(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleChat()}
                              disabled={chatLoading}
                              title="Ask questions about this incident — context is maintained across the conversation"
                            />
                            <button
                              className={styles.chatSendBtn}
                              onClick={handleChat}
                              disabled={chatLoading || !chatInput.trim()}
                              data-tip="Send your question to the AI assistant"
                            >
                              Send
                            </button>
                          </div>
                          <div className={styles.aiDisclaimer}>
                            The response provided is generated by an AI system. User is advised to independently verify the information prior to applying it in any production or decision-making context.
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ─── Properties tab ─── */}
                {activeTab === "properties" && (
                  <div className={styles.tabContent}>
                    <h4 className={styles.propGroupTitle}>Message Properties</h4>
                    <div className={styles.propGrid}>
                      {Object.entries(detail.properties.message || {}).map(([k, v]) => v ? (
                        <div key={k} className={styles.propRow}>
                          <span className={styles.propLabel}>{k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                          <span className={styles.propValue}>{String(v)}</span>
                        </div>
                      ) : null)}
                    </div>
                    {detail.properties.adapter && Object.values(detail.properties.adapter).some(Boolean) && (
                      <>
                        <h4 className={styles.propGroupTitle}>Adapter</h4>
                        <div className={styles.propGrid}>
                          {Object.entries(detail.properties.adapter).map(([k, v]) => v ? (
                            <div key={k} className={styles.propRow}>
                              <span className={styles.propLabel}>{k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                              <span className={styles.propValue}>{String(v)}</span>
                            </div>
                          ) : null)}
                        </div>
                      </>
                    )}
                    {detail.properties.business_context && Object.values(detail.properties.business_context).some(Boolean) && (
                      <>
                        <h4 className={styles.propGroupTitle}>Business Context</h4>
                        <div className={styles.propGrid}>
                          {Object.entries(detail.properties.business_context).map(([k, v]) => v ? (
                            <div key={k} className={styles.propRow}>
                              <span className={styles.propLabel}>{k.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())}</span>
                              <span className={styles.propValue}>{String(v)}</span>
                            </div>
                          ) : null)}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ─── Artifact tab ─── */}
                {activeTab === "artifact" && (
                  <div className={styles.tabContent}>
                    <div className={styles.propGrid}>
                      {[
                        ["Name",         detail.artifact.name],
                        ["Artifact ID",  detail.artifact.artifact_id],
                        ["Version",      detail.artifact.version],
                        ["Package",      detail.artifact.package],
                        ["Deployed On",  detail.artifact.deployed_on],
                        ["Deployed By",  detail.artifact.deployed_by],
                        ["Runtime Node", detail.artifact.runtime_node],
                        ["Status",       detail.artifact.status],
                      ].map(([label, val]) => val ? (
                        <div key={label} className={styles.propRow}>
                          <span className={styles.propLabel}>{label}</span>
                          <span className={styles.propValue}>{String(val)}</span>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}

                {/* ─── Attachments tab ─── */}
                {activeTab === "attachments" && (
                  <div className={styles.tabContent}>
                    {detail.attachments?.length > 0 ? (
                      <div>Attachments available: {detail.attachments.length}</div>
                    ) : (
                      <div className={styles.emptyTab}>No attachments available for this message.</div>
                    )}
                  </div>
                )}

                {/* ─── History tab ─── */}
                {activeTab === "history" && (
                  <div className={styles.tabContent}>
                    {detail.history?.length > 0 ? (
                      <Timeline entries={detail.history} />
                    ) : (
                      <div className={styles.emptyTab}>No history entries yet.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className={styles.centered}>
                <span>Could not load message details.</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
