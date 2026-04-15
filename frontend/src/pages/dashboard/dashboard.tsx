import { useQuery } from "@tanstack/react-query";
import {
  PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import {
  fetchDashboardKpi,
  fetchDashboardStatusBreakdown,
  fetchDashboardErrorDistribution,
  fetchDashboardTopIflows,
  fetchDashboardTimeline,
  fetchDashboardRecentFailures,
  fetchDashboardActiveIncidents,
  fetchQueueStats,
} from "../../services/api.ts";
import styles from "./dashboard.module.css";

// ── Colour palettes ────────────────────────────────────────────────────────────
const CHART_COLORS = ["#ff6b6b", "#4dabf7", "#ffd43b", "#69db7c", "#845ef7", "#f06595", "#74c0fc"];

// ── Formatters ────────────────────────────────────────────────────────────────
function formatODataDate(value: string | null | undefined): string {
  if (!value) return "-";
  const match = /\/Date\((\d+)\)\//.exec(value);
  if (!match) return value;
  return new Date(parseInt(match[1], 10)).toLocaleTimeString("en-GB", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function formatISODate(value: string | null | undefined): string {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return value;
  return d.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

const INCIDENT_STATE: Record<string, string> = {
  RCA_COMPLETE: styles.stateSuccess,
  IN_PROGRESS:  styles.stateWarning,
  PENDING:      styles.stateNone,
  FAILED:       styles.stateError,
  FIX_APPLIED:  styles.stateSuccess,
};

// ── KPI card ──────────────────────────────────────────────────────────────────
function KpiCard({ header, subheader, value, unit, indicator, valueColor, tooltip }: {
  header: string; subheader?: string; value: unknown;
  unit?: string; indicator?: "Up" | "Down"; valueColor?: "Good" | "Critical"; tooltip?: string;
}) {
  const colorClass =
    valueColor === "Good"     ? styles.valueGood :
    valueColor === "Critical" ? styles.valueCritical : "";
  const arrow = indicator === "Up" ? " ↑" : indicator === "Down" ? " ↓" : "";

  return (
    <div className={styles.kpiCard} {...(tooltip ? { "data-tip": tooltip } : {})}>
      <div className={styles.kpiHeader}>{header}</div>
      {subheader && <div className={styles.kpiSub}>{subheader}</div>}
      <div className={`${styles.kpiValue} ${colorClass}`}>
        {String(value ?? "-")}{unit ? ` ${unit}` : ""}{arrow}
      </div>
    </div>
  );
}

// ── Section title ─────────────────────────────────────────────────────────────
function SectionTitle({ title }: { title: string }) {
  return <h3 className={styles.sectionTitle}>{title}</h3>;
}

// ── Two-column legend for pie charts with many categories ─────────────────────
function TwoColumnLegend({ payload }: { payload?: Array<{ value: string; color: string }> }) {
  if (!payload?.length) return null;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "0.2rem 1rem",
      fontSize: "0.78rem",
      padding: "0 0.75rem",
      maxHeight: 300,
      overflowY: "auto",
      alignSelf: "center",
    }}>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.35rem", minWidth: 0 }}>
          <span style={{
            width: 9, height: 9, borderRadius: 2,
            background: entry.color, flexShrink: 0,
          }} />
          <span style={{ color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Skeleton helpers ──────────────────────────────────────────────────────────
function SkeletonChart() {
  return <div className={`${styles.skeleton} ${styles.skeletonChart}`} />;
}

function SkeletonRows({ count = 5 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i}>
          <td colSpan={9}><div className={`${styles.skeleton} ${styles.skeletonRow}`} /></td>
        </tr>
      ))}
    </>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function Dashboard() {
  const qOpts = { refetchInterval: 60_000, retry: 3, retryDelay: 3_000 } as const;
  const { data: kpi,       isLoading: kpiLoading }      = useQuery({ queryKey: ["dash-kpi"],       queryFn: fetchDashboardKpi,               ...qOpts });
  const { data: status,    isLoading: statusLoading }    = useQuery({ queryKey: ["dash-status"],     queryFn: fetchDashboardStatusBreakdown,   ...qOpts });
  const { data: errorDist, isLoading: errorLoading }     = useQuery({ queryKey: ["dash-error"],      queryFn: fetchDashboardErrorDistribution, ...qOpts });
  const { data: iflows,    isLoading: iflowsLoading }    = useQuery({ queryKey: ["dash-iflows"],     queryFn: fetchDashboardTopIflows,         ...qOpts });
  const { data: timeline,  isLoading: timelineLoading }  = useQuery({ queryKey: ["dash-timeline"],   queryFn: fetchDashboardTimeline,          ...qOpts });
  const { data: failures,  isLoading: failuresLoading }  = useQuery({ queryKey: ["dash-failures"],   queryFn: fetchDashboardRecentFailures,    ...qOpts });
  const { data: incidents, isLoading: incidentsLoading } = useQuery({ queryKey: ["dash-incidents"],  queryFn: fetchDashboardActiveIncidents,   ...qOpts });
  const { data: aemRaw,    isLoading: aemLoading }       = useQuery({ queryKey: ["queue-stats"],     queryFn: fetchQueueStats,                 ...qOpts });

  const k = (kpi ?? {}) as Record<string, unknown>;
  const statusData    = (status ?? []) as { status: string; count: number }[];
  const errorData     = ((errorDist as Record<string, unknown[]> | undefined)?.distribution ?? []) as { error_type: string; count: number }[];
  const iflowData     = ((iflows   as Record<string, unknown[]> | undefined)?.top_iflows   ?? []) as { iflow_name: string; failure_count: number }[];
  const timelineData  = ((timeline as Record<string, unknown[]> | undefined)?.series        ?? []) as { time: string; count: number }[];
  const recentFails   = ((failures as Record<string, unknown[]> | undefined)?.recent_failures    ?? []) as Record<string, unknown>[];
  const activeInc     = ((incidents as Record<string, unknown[]> | undefined)?.active_incidents  ?? []) as Record<string, unknown>[];

  const aem = (aemRaw ?? {}) as Record<string, unknown>;
  const aemEnabled   = !aem.warning;
  const aemSempError = aem.semp_error as string | null;
  const aemQueues    = (aem.queues ?? {}) as Record<string, { queue_depth: number; messages_retrieved: number }>;
  const aemQueueDepth = Object.values(aemQueues).reduce((s, q) => s + (q.queue_depth ?? 0), 0);
  const aemStageRaw  = (aem.stage_counts ?? {}) as Record<string, number>;
  const aemStageData = Object.entries(aemStageRaw).map(([stage, count]) => ({ stage, count }));

  return (
    <div className={styles.page}>
      <h2 className={styles.pageTitle}>Smart Monitoring</h2>

      {/* ── AEM Status Banner ── */}
      {!aemLoading && (
        <div className={styles.aemBanner} data-enabled={aemEnabled}>
          <span className={styles.aemDot} />
          <span className={styles.aemLabel} data-tip={aemEnabled ? "Advanced Event Mesh is connected — incidents sourced via Solace pub/sub messaging" : "AEM is disabled — using direct SAP CPI polling"}>
            {aemEnabled ? "AEM Connected" : "AEM Disabled"}
          </span>
          {aemEnabled && (
            <>
              <span className={styles.aemSep}>|</span>
              <span className={styles.aemStat} data-tip="Total messages waiting across all AEM queues for processing">Queue depth: <strong>{aemQueueDepth}</strong></span>
              {Object.entries(aemQueues).map(([name, q]) => (
                <span key={name} className={styles.aemStat} data-tip={`Queue "${name}": ${q.queue_depth} waiting, ${q.messages_retrieved} retrieved this session`}>
                  {name}: <strong>{q.queue_depth}</strong> queued · <strong>{q.messages_retrieved}</strong> retrieved
                </span>
              ))}
              {aemSempError && (
                <span className={styles.aemError} data-tip="SEMP (Solace Element Management Protocol) REST API error — queue statistics may be inaccurate">SEMP: {aemSempError}</span>
              )}
            </>
          )}
        </div>
      )}

      {/* ── KPI Cards ── */}
      <div className={styles.kpiRow}>
        {kpiLoading ? (
          Array.from({ length: 9 }).map((_, i) => (
            <div key={i} className={styles.kpiCard}>
              <div className={`${styles.skeleton}`} style={{ height: "0.75rem", width: "70%" }} />
              <div className={`${styles.skeleton} ${styles.skeletonKpiValue}`} />
            </div>
          ))
        ) : (
          <>
            <KpiCard header="Failed Messages" subheader="Live" value={k.total_failed_messages} tooltip="SAP CPI messages currently in FAILED state, polled live from the message processing log" />
            <KpiCard header="Total Incidents" value={k.total_incidents} tooltip="All incidents tracked by the auto-remediation pipeline, including resolved and active" />
            <KpiCard header="In Progress" value={k.in_progress} tooltip="Incidents currently being analyzed or fixed by pipeline agents" />
            <KpiCard header="Fix Failed" value={k.fix_failed} indicator="Down" valueColor="Critical" tooltip="Incidents where the automated fix failed — manual review required" />
            <KpiCard header="Auto Fixed" value={k.auto_fixed} indicator="Up" valueColor="Good" tooltip="Incidents resolved automatically without any human intervention" />
            <KpiCard header="Pending Approval" value={k.pending_approval} tooltip="Fixes generated but awaiting manual approval before deployment to production" />
            <KpiCard header="Auto Fix Rate" value={k.auto_fix_rate} unit="%" tooltip="Percentage of incidents resolved automatically vs all closed incidents" />
            <KpiCard header="Avg Resolution Time" subheader="minutes" value={k.avg_resolution_time_minutes} unit="min" tooltip="Mean time from incident detection to terminal state (auto-fixed or failed)" />
            <KpiCard header="RCA Coverage" value={k.rca_coverage_percent} unit="%" indicator="Up" valueColor="Good" tooltip="Percentage of incidents that received AI-powered root cause analysis" />
          </>
        )}
      </div>

      {/* ── Status Breakdown ── */}
      <div className={styles.chartBlock}>
        <SectionTitle title="Status Breakdown" />
        {statusLoading ? <SkeletonChart /> : (
          <ResponsiveContainer width="100%" height={320}>
            <PieChart>
              <Pie data={statusData} dataKey="count" nameKey="status" cx="35%" label>
                {statusData.map((_, i) => (
                  <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip />
              <Legend
                layout="vertical"
                align="right"
                verticalAlign="middle"
                content={(props) => (
                  <TwoColumnLegend payload={props.payload as Array<{ value: string; color: string }>} />
                )}
              />
            </PieChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── Error Distribution + Top Failing iFlows ── */}
      <div className={styles.chartsRow}>
        <div className={styles.chartHalf}>
          <SectionTitle title="Error Distribution" />
          {errorLoading ? <SkeletonChart /> : (
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie data={errorData} dataKey="count" nameKey="error_type" innerRadius="40%" outerRadius="70%" label>
                  {errorData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className={styles.chartHalf}>
          <SectionTitle title="Top Failing iFlows" />
          {iflowsLoading ? <SkeletonChart /> : (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={iflowData} layout="vertical" margin={{ left: 20 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis type="number" />
                <YAxis type="category" dataKey="iflow_name" width={120} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="failure_count" name="Failures" fill="#4dabf7" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Failures Over Time ── */}
      <div className={styles.chartBlock}>
        <SectionTitle title="Failures Over Time" />
        {timelineLoading ? <SkeletonChart /> : (
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={timelineData} margin={{ left: 10, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="count" name="Failures" stroke="#ff6b6b" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* ── AEM Pipeline Stage Counts ── */}
      {aemEnabled && (
        <div className={styles.chartBlock}>
          <SectionTitle title="AEM Pipeline Stage Counts" />
          {aemLoading ? <SkeletonChart /> : aemStageData.length === 0 ? (
            <div className={styles.emptyCell}>No stage data — pipeline not yet running</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={aemStageData} margin={{ left: 10, right: 10 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="stage" tick={{ fontSize: 12 }} />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Bar dataKey="count" name="Incidents" fill="#845ef7" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      )}

      {/* ── Recent Failed Messages ── */}
      <div className={styles.tableBlock}>
        <SectionTitle title="Recent Failed Messages" />
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th title="Unique message processing log ID from SAP CPI">Message GUID</th>
                <th title="Integration flow that generated this failure">iFlow Name</th>
                <th title="Current processing status">Status</th>
                <th title="Message processing end time from SAP CPI">Time</th>
                <th title="Truncated error message from the CPI processing log">Error Preview</th>
              </tr>
            </thead>
            <tbody>
              {failuresLoading ? (
                <SkeletonRows count={5} />
              ) : recentFails.length === 0 ? (
                <tr><td colSpan={5} className={styles.emptyCell}>No data</td></tr>
              ) : (
                recentFails.map((row, i) => (
                  <tr key={i}>
                    <td className={styles.mono}>{String(row.message_guid ?? "-")}</td>
                    <td>{String(row.iflow_name ?? "-")}</td>
                    <td><span className={styles.statusError}>{String(row.status ?? "-")}</span></td>
                    <td>{formatISODate(row.log_end as string)}</td>
                    <td className={styles.errorPreview}>{String(row.error_preview ?? "-")}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Active Incidents ── */}
      <div className={styles.tableBlock}>
        <SectionTitle title="Active Incidents" />
        <div className={styles.tableWrapper}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th title="Auto-generated UUID for this remediation incident">Incident ID</th>
                <th title="SAP CPI message processing log identifier">Message GUID</th>
                <th title="Integration flow associated with this incident">iFlow</th>
                <th title="Classified error category (e.g. MAPPING_ERROR, CONNECTION_ERROR)">Error Type</th>
                <th title="Current pipeline stage for this incident">Status</th>
                <th title="When this incident was first detected">Created At</th>
                <th title="Most recent occurrence of this error pattern">Last Seen</th>
                <th title="Number of times this error pattern has been detected">Occurrences</th>
                <th title="AI model confidence in the root cause analysis (0–1 scale)">RCA Confidence</th>
              </tr>
            </thead>
            <tbody>
              {incidentsLoading ? (
                <SkeletonRows count={5} />
              ) : activeInc.length === 0 ? (
                <tr><td colSpan={9} className={styles.emptyCell}>No data</td></tr>
              ) : (
                activeInc.map((row, i) => {
                  const stateClass = INCIDENT_STATE[String(row.status ?? "")] ?? styles.stateNone;
                  return (
                    <tr key={i}>
                      <td className={styles.mono}>{String(row.incident_id ?? "-")}</td>
                      <td className={styles.mono}>{String(row.message_guid ?? "-")}</td>
                      <td>{String(row.iflow_id ?? "-")}</td>
                      <td>{String(row.error_type ?? "-")}</td>
                      <td><span className={`${styles.statusBadge} ${stateClass}`}>{String(row.status ?? "-")}</span></td>
                      <td>{formatISODate(row.created_at as string)}</td>
                      <td>{formatISODate(row.last_seen as string)}</td>
                      <td>{String(row.occurrence_count ?? "-")}</td>
                      <td>{String(row.rca_confidence ?? "-")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
