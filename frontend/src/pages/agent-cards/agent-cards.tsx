import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchPipelineStatus, fetchQueueStats, startPipeline, stopPipeline } from "../../services/api.ts";
import _styles from "./agent-cards.module.css";
const styles = _styles as Record<string, string>;

// ── Static MCP agent catalogue ────────────────────────────────────────────────
interface Agent {
  id: string; name: string; description: string; version: string;
  status: "online" | "busy" | "offline"; skills: string[];
  emoji: string; gradient: string; accent: string;
}

const AGENTS: Agent[] = [
  { id:"A3", name:"iFlow Agent", version:"1.0.0", status:"online",
    description:"Create and deploy new iFlows in SAP Integration Suite with AI assistance.",
    emoji:"🔄", gradient:"linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%)", accent:"#3b82f6",
    skills:["iFlow Creation","Package Management","Deploy & Publish"] },
  { id:"A4", name:"Mapping Agent", version:"1.0.0", status:"online",
    description:"Automate message mapping creation between source and target structures.",
    emoji:"🗺️", gradient:"linear-gradient(135deg,#312e81 0%,#7c3aed 100%)", accent:"#8b5cf6",
    skills:["Message Mapping","XSLT Transform","Groovy Scripts"] },
  { id:"A5", name:"Testing Agent", version:"1.0.0", status:"busy",
    description:"Execute and validate iFlow tests across SAP Integration Suite environments.",
    emoji:"✅", gradient:"linear-gradient(135deg,#064e3b 0%,#059669 100%)", accent:"#10b981",
    skills:["Test Execution","Payload Validation","Log Analysis"] },
  { id:"A8", name:"CPI Documentation", version:"1.0.0", status:"online",
    description:"Generate comprehensive CPI adapter documentation as PDF reports.",
    emoji:"📄", gradient:"linear-gradient(135deg,#1c1917 0%,#d97706 100%)", accent:"#f59e0b",
    skills:["PDF Generation","Adapter Docs","Changelog Tracking"] },
  { id:"A1", name:"Bank Validation", version:"2.0.0", status:"online",
    description:"Validate bank account details in real-time using Plaid API integration.",
    emoji:"🏦", gradient:"linear-gradient(135deg,#0c4a6e 0%,#0284c7 100%)", accent:"#0ea5e9",
    skills:["Bank Validation","Plaid API","IBAN / SWIFT"] },
  { id:"A2", name:"Address Validation", version:"1.0.0", status:"online",
    description:"Validate and standardise addresses via Google Address Validation API.",
    emoji:"📍", gradient:"linear-gradient(135deg,#134e4a 0%,#0f766e 100%)", accent:"#14b8a6",
    skills:["Address Validation","Google Maps API","Auto-complete"] },
  { id:"A6", name:"Extraction Agent", version:"2.0.0", status:"busy",
    description:"Extract structured data from documents, PDFs and unstructured content.",
    emoji:"🔍", gradient:"linear-gradient(135deg,#4a1942 0%,#be185d 100%)", accent:"#ec4899",
    skills:["PDF Parsing","OCR Extraction","JSON Output"] },
  { id:"A7", name:"Email Agent", version:"1.0.0", status:"offline",
    description:"Compose and send AI-generated emails with dynamic template support.",
    emoji:"✉️", gradient:"linear-gradient(135deg,#1c1917 0%,#9f1239 100%)", accent:"#f43f5e",
    skills:["Email Compose","Template Engine","SMTP Integration"] },
];

// ── Pipeline agent meta ───────────────────────────────────────────────────────
const PIPELINE_META: Record<string, { emoji: string; desc: string; gradient: string; accent: string }> = {
  observer:     { emoji:"👁️",  desc:"Polls SAP CPI for failed messages, deduplicates, publishes to AEM.",        gradient:"linear-gradient(135deg,#0f172a 0%,#1e40af 100%)", accent:"#60a5fa" },
  classifier:   { emoji:"🏷️",  desc:"Classifies error type, confidence, and severity — zero LLM cost.",          gradient:"linear-gradient(135deg,#1e1b4b 0%,#7c3aed 100%)", accent:"#a78bfa" },
  orchestrator: { emoji:"🎯",  desc:"Routes by confidence threshold; fan-outs to RCA + Knowledge in parallel.",   gradient:"linear-gradient(135deg,#134e4a 0%,#0f766e 100%)", accent:"#2dd4bf" },
  rca:          { emoji:"🧠",  desc:"LLM root cause analysis via SAP AI Core (parallel with Knowledge).",         gradient:"linear-gradient(135deg,#064e3b 0%,#059669 100%)", accent:"#34d399" },
  knowledge:    { emoji:"📚",  desc:"HANA vector similarity search (≥0.75) for grounded fix suggestions.",        gradient:"linear-gradient(135deg,#78350f 0%,#d97706 100%)", accent:"#fbbf24" },
  aggregator:   { emoji:"🔀",  desc:"Merges parallel RCA + Knowledge results; forwards to Fixer.",                gradient:"linear-gradient(135deg,#1e3a5f 0%,#0284c7 100%)", accent:"#38bdf8" },
  fixer:        { emoji:"🔧",  desc:"Generates patch, assesses risk level (LOW/MEDIUM/HIGH), sets simulation.",   gradient:"linear-gradient(135deg,#312e81 0%,#6d28d9 100%)", accent:"#c084fc" },
  executor:     { emoji:"🚀",  desc:"Deploys fix via SAP IS API (AUTO/APPROVAL/TICKET) and triggers retry.",      gradient:"linear-gradient(135deg,#4c0519 0%,#be123c 100%)", accent:"#fb7185" },
  learner:      { emoji:"🎓",  desc:"Records outcomes, updates HANA KB embeddings, feeds Classifier.",            gradient:"linear-gradient(135deg,#1c1917 0%,#854d0e 100%)", accent:"#fbbf24" },
};

const STATUS_LABEL: Record<string, string> = { online:"Online", busy:"Busy", offline:"Offline" };

export default function AgentCards() {
  const navigate  = useNavigate();
  const [search, setSearch]   = useState("");
  const [filter, setFilter]   = useState<"all"|"online"|"busy"|"offline">("all");
  const [hoveredId, setHoveredId] = useState<string|null>(null);
  const [toggling, setToggling]   = useState(false);

  const { data: pipelineData, refetch: refetchPipeline } = useQuery({
    queryKey: ["pipeline-status"],
    queryFn:  fetchPipelineStatus,
    refetchInterval: 5_000,
  });

  const { data: queueRaw } = useQuery({
    queryKey: ["queue-stats"],
    queryFn:  fetchQueueStats,
    refetchInterval: 8_000,
    enabled:  pipelineData?.pipeline_running ?? false,
  });

  const pipelineRunning = pipelineData?.pipeline_running ?? false;
  const agentStatuses   = pipelineData?.agents ?? {};

  const qs = (queueRaw ?? {}) as Record<string, unknown>;
  const aemEnabled   = pipelineData?.aem_connected ?? false;
  const aemQueues    = (qs.queues ?? {}) as Record<string, { queue_depth: number; messages_retrieved: number }>;
  const aemQueueDepth = Object.values(aemQueues).reduce((s, q) => s + (q.queue_depth ?? 0), 0);
  const stageCounts  = (qs.stage_counts ?? {}) as Record<string, number>;

  async function handlePipelineToggle() {
    setToggling(true);
    try {
      pipelineRunning ? await stopPipeline() : await startPipeline();
      await refetchPipeline();
    } finally {
      setToggling(false);
    }
  }

  const visible = AGENTS.filter((a) => {
    const matchSearch = a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.description.toLowerCase().includes(search.toLowerCase());
    const matchFilter = filter === "all" || a.status === filter;
    return matchSearch && matchFilter;
  });

  const counts = {
    online:  AGENTS.filter(a => a.status === "online").length,
    busy:    AGENTS.filter(a => a.status === "busy").length,
    offline: AGENTS.filter(a => a.status === "offline").length,
  };

  return (
    <div className={styles.page}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <div>
          <h1 className={styles.pageTitle}>Agent Mesh</h1>
          <p className={styles.pageSubtitle}>
            {counts.online} online · {counts.busy} busy · {counts.offline} offline
          </p>
        </div>
        <div className={styles.headerActions}>
          <div className={styles.searchBox}>
            <span className={styles.searchIcon}>🔍</span>
            <input className={styles.searchInput} placeholder="Search agents…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className={styles.filterTabs}>
            {(["all","online","busy","offline"] as const).map(f => (
              <button key={f}
                className={`${styles.filterTab} ${filter === f ? styles.filterTabActive : ""}`}
                onClick={() => setFilter(f)}>
                {f === "all" ? `All (${AGENTS.length})` : `${STATUS_LABEL[f]} (${counts[f as keyof typeof counts]})`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Remediation Pipeline strip ── */}
      <div className={styles.pipelineStrip}>
        <div className={styles.pipelineStripLeft}>
          <span className={styles.pipelineStripTitle}>Auto-Remediation Pipeline</span>
          <span className={`${styles.pipelineBadge} ${pipelineRunning ? styles.pipelineBadgeOn : styles.pipelineBadgeOff}`}>
            {pipelineRunning ? "● Running" : "○ Stopped"}
          </span>
          {aemEnabled && (
            <span className={styles.pipelineAem}>AEM Connected</span>
          )}
          {aemEnabled && pipelineRunning && aemQueueDepth > 0 && (
            <span className={styles.pipelineAem}>Queue: {aemQueueDepth}</span>
          )}
          {aemEnabled && pipelineRunning && Object.keys(stageCounts).length > 0 && (
            <span className={styles.pipelineAemStages}>
              {Object.entries(stageCounts).map(([stage, n]) => (
                <span key={stage} className={styles.stageChip}>{stage}: {n}</span>
              ))}
            </span>
          )}
        </div>
        <div className={styles.pipelineStripRight}>
          <button
            className={`${styles.pipelineToggleBtn} ${pipelineRunning ? styles.pipelineToggleBtnStop : styles.pipelineToggleBtnStart}`}
            onClick={handlePipelineToggle}
            disabled={toggling}
          >
            {toggling ? "…" : pipelineRunning ? "Stop Pipeline" : "Start Pipeline"}
          </button>
          <button className={styles.pipelineDetailsBtn} onClick={() => navigate("/pipeline")}>
            View Details →
          </button>
        </div>
      </div>

      {/* ── Pipeline agent cards ── */}
      <div className={styles.sectionLabel}>Remediation Agents</div>
      <div className={styles.grid}>
        {Object.entries(PIPELINE_META).map(([key, meta], i) => {
          const raw    = agentStatuses[key] ?? "unknown";
          const isRun  = raw === "running";
          return (
            <div key={key}
              className={`${styles.card} ${hoveredId === `p-${key}` ? styles.cardHovered : ""}`}
              style={{ animationDelay: `${i * 60}ms` }}
              onMouseEnter={() => setHoveredId(`p-${key}`)}
              onMouseLeave={() => setHoveredId(null)}>
              <div className={styles.cardBanner} style={{ background: meta.gradient }}>
                <span className={styles.cardEmoji}>{meta.emoji}</span>
                <div className={styles.cardHeaderRight}>
                  <span className={`${styles.statusDot} ${isRun ? styles["status-online"] : styles["status-offline"]}`} />
                  <span className={styles.statusText}>{isRun ? "Running" : pipelineRunning ? "Stopped" : "Idle"}</span>
                </div>
              </div>
              <div className={styles.cardBody}>
                <div className={styles.cardTitleRow}>
                  <h3 className={styles.cardTitle}>{key.charAt(0).toUpperCase() + key.slice(1)} Agent</h3>
                  <span className={styles.cardVersion}>pipeline</span>
                </div>
                <p className={styles.cardDesc}>{meta.desc}</p>
              </div>
              <div className={styles.cardFooter}>
                <button className={styles.launchBtn} style={{ background: meta.gradient }}
                  onClick={() => navigate("/pipeline")}>
                  Details →
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── MCP agent cards ── */}
      <div className={styles.sectionLabel}>MCP Agents</div>
      <div className={styles.grid}>
        {visible.map((agent, i) => (
          <div key={agent.id}
            className={`${styles.card} ${hoveredId === agent.id ? styles.cardHovered : ""}`}
            style={{ animationDelay: `${i * 60}ms` }}
            onMouseEnter={() => setHoveredId(agent.id)}
            onMouseLeave={() => setHoveredId(null)}>
            <div className={styles.cardBanner} style={{ background: agent.gradient }}>
              <span className={styles.cardEmoji}>{agent.emoji}</span>
              <div className={styles.cardHeaderRight}>
                <span className={`${styles.statusDot} ${styles[`status-${agent.status}`]}`} />
                <span className={styles.statusText}>{STATUS_LABEL[agent.status]}</span>
              </div>
              {agent.status === "online" && (
                <span className={styles.pingRing} style={{ borderColor: agent.accent }} />
              )}
            </div>
            <div className={styles.cardBody}>
              <div className={styles.cardTitleRow}>
                <h3 className={styles.cardTitle}>{agent.name}</h3>
                <span className={styles.cardVersion}>v{agent.version}</span>
              </div>
              <p className={styles.cardDesc}>{agent.description}</p>
              <div className={styles.skillsRow}>
                {agent.skills.map(s => (
                  <span key={s} className={styles.skillTag}
                    style={{ borderColor:`${agent.accent}55`, color:agent.accent }}>{s}</span>
                ))}
              </div>
            </div>
            <div className={styles.cardFooter}>
              <button className={styles.launchBtn} style={{ background: agent.gradient }}
                onClick={() => navigate("/orchestrator")}
                disabled={agent.status === "offline"}>
                {agent.status === "offline" ? "Offline" : "Launch →"}
              </button>
            </div>
          </div>
        ))}
        {visible.length === 0 && (
          <div className={styles.empty}><span>🤖</span><p>No agents match your search.</p></div>
        )}
      </div>
    </div>
  );
}
