import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Activity, AlertCircle, ArrowDownUp, ArrowRight, Download, FileText, RefreshCw, Search } from "lucide-react";
import { Link, useSearchParams } from "react-router-dom";
import { ChartCard } from "../components/ChartCard";
import { StatusBadge } from "../components/StatusBadge";
import { getMonitoringEvents, predictRequest, type MonitoringEventItem, type PredictionResult, type RequestScan, type ReviewStatus } from "../api";
import { useSession, type AnalystDecision, type RequestRecord } from "../context/SessionContext";
import { endpointData, exportCsv, modelScore, summarizeRequests, trendData, classificationData, confidenceDistribution, methodData } from "../utils/data";

const anomalous = (record: RequestRecord) => record.result.prediction.toLowerCase() === "anomalous";

function Header({ eyebrow, title, description, badge }: { eyebrow: string; title: string; description: string; badge?: string }) {
  return (
    <section className="border-b border-line pb-6">
      <div className="mb-3 flex items-center gap-2"><span className="eyebrow">{eyebrow}</span>{badge && <StatusBadge>{badge}</StatusBadge>}</div>
      <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{description}</p>
    </section>
  );
}

function PredictionTag({ record }: { record: RequestRecord }) {
  return <StatusBadge tone={anomalous(record) ? "alert" : "ready"}>{record.result.prediction.toUpperCase()}</StatusBadge>;
}

function EmptyState({ title, message, link = "/analyzer" }: { title: string; message: string; link?: string }) {
  return (
    <div className="panel-card flex min-h-64 flex-col items-center justify-center px-6 text-center">
      <span className="grid size-10 place-items-center rounded-xl border border-line bg-white/[0.025] text-slate-500"><AlertCircle size={18} /></span>
      <h2 className="mt-4 text-sm font-semibold text-text-primary">{title}</h2>
      <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">{message}</p>
      <Link to={link} className="mt-4 text-xs font-medium text-accent hover:text-[#7be1d7]">Open request analyzer <ArrowRight size={12} className="ml-1 inline" /></Link>
    </div>
  );
}

export function HistoryPage() {
  const {
    requests,
    historyTotal,
    historyLoading,
    historyError,
    refreshHistory,
  } = useSession();
  const [query, setQuery] = useState("");
  const [classification, setClassification] = useState("all");
  const [sortNewest, setSortNewest] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return requests
      .filter((record) => !normalized || `${record.request.url} ${record.request.method} ${record.result.prediction}`.toLowerCase().includes(normalized))
      .filter((record) => classification === "all" || record.result.prediction.toLowerCase() === classification)
      .sort((left, right) => sortNewest ? right.analyzedAt.localeCompare(left.analyzedAt) : left.analyzedAt.localeCompare(right.analyzedAt));
  }, [requests, query, classification, sortNewest]);

  function exportHistory() {
    exportCsv("apisentinel-session-history.csv", ["Request ID", "Timestamp", "Method", "URL", "Classification", "Class ID", "Model confidence"], filtered.map((record) => [
      record.id, record.analyzedAt, record.request.method, record.request.url, record.result.prediction, String(record.result.class_id), String(record.result.confidence),
    ]));
  }

  return (
    <div className="space-y-6">
      <Header eyebrow="Investigation" title="Request history" description="Persisted prediction records from the local SQLite database. Payloads are never stored." badge={`${historyTotal} STORED RECORDS`} />
      {historyError && <div role="alert" className="panel-card flex items-center justify-between gap-3 p-4 text-xs text-rose-200"><span>{historyError}</span><button className="button-secondary" onClick={() => void refreshHistory(0)} type="button">Retry</button></div>}
      {historyLoading && !requests.length ? <div className="panel-card flex min-h-48 items-center justify-center text-xs text-slate-500">Loading stored request history…</div> : !requests.length ? <EmptyState title="No stored predictions yet" message="Successful model analyses are saved to the local database and listed here." /> : (
        <section className="panel-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative block"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input value={query} onChange={(event) => setQuery(event.target.value)} className="form-control h-9 w-full pl-9 text-xs sm:w-64" placeholder="Search method or URL" aria-label="Search request history" /></label>
              <select className="form-control h-9 text-xs sm:w-40" value={classification} onChange={(event) => setClassification(event.target.value)} aria-label="Filter by classification">
                <option value="all">All classifications</option><option value="normal">Normal</option><option value="anomalous">Anomalous</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button className="button-secondary min-h-9" type="button" onClick={() => setSortNewest((value) => !value)}><ArrowDownUp size={13} />{sortNewest ? "Newest first" : "Oldest first"}</button>
              <button className="button-secondary min-h-9" type="button" onClick={exportHistory}><Download size={13} />Export CSV</button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="data-table min-w-[740px]">
              <thead><tr><th>Timestamp</th><th>Method</th><th>URL</th><th>Classification</th><th>Model score</th><th>Details</th></tr></thead>
              <tbody>
                {filtered.map((record) => (
                  <tr key={record.id}>
                    <td className="whitespace-nowrap text-slate-400">{new Date(record.analyzedAt).toLocaleString()}</td>
                    <td className="font-mono text-slate-300">{record.request.method}</td>
                    <td className="max-w-[300px] truncate font-mono text-slate-300" title={record.request.url}>{record.request.url}</td>
                    <td><PredictionTag record={record} /></td>
                    <td className="font-mono text-slate-300">{(modelScore(record) * 100).toFixed(2)}%</td>
                    <td><button className="text-xs text-accent hover:text-white" type="button" onClick={() => setSelected(selected === record.id ? null : record.id)}>{selected === record.id ? "Hide" : "View details"}</button></td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={6} className="py-10 text-center text-xs text-slate-500">No stored records match these filters.</td></tr>}
              </tbody>
            </table>
          </div>
          {filtered.filter((record) => record.id === selected).map((record) => <div key={record.id} className="border-t border-line bg-black/[0.08] p-5">
            <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-xs font-semibold text-text-primary">Prediction details</h3>{anomalous(record) && <Link to={`/incidents?request=${record.id}`} className="text-xs text-accent hover:text-white">Investigate <ArrowRight size={12} className="ml-1 inline" /></Link>}</div>
            <p className="mt-2 break-all font-mono text-xs text-slate-300">{record.request.method} {record.request.url}</p>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Object.entries(record.result.features).map(([name, value]) => <div key={name} className="rounded border border-line px-2.5 py-2"><p className="text-[10px] text-slate-500">{name}</p><p className="mt-1 font-mono text-xs text-slate-200">{value}</p></div>)}
            </div>
          </div>)}
          {requests.length < historyTotal && <div className="border-t border-line p-4 text-center"><button className="button-secondary" type="button" disabled={historyLoading} onClick={() => void refreshHistory(requests.length)}>{historyLoading ? "Loading…" : `Load more (${requests.length} of ${historyTotal})`}</button></div>}
        </section>
      )}
    </div>
  );
}

export function AlertsPage() {
  const { alerts, alertsTotal, alertsLoading, alertsError, refreshAlerts, updateRequest } = useSession();
  return (
    <div className="space-y-6">
      <Header eyebrow="Investigation" title="Security alerts" description="Persisted alerts linked to anomalous model predictions. A model flag is a review signal, not confirmation of an attack." badge={`${alertsTotal} STORED ALERTS`} />
      {alertsError && <div role="alert" className="panel-card p-4 text-xs text-rose-200">{alertsError}</div>}
      {alertsLoading && !alerts.length ? <div className="panel-card flex min-h-48 items-center justify-center text-xs text-slate-500">Loading stored alerts…</div> : !alerts.length ? <EmptyState title="No stored anomaly alerts" message="Alerts are created only when a prediction is classified as anomalous and saved." /> : (
        <div className="space-y-3">{alerts.map((record) => (
          <article key={record.id} className="panel-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><StatusBadge tone="planned">MODEL FLAGGED</StatusBadge><code className="font-mono text-[10px] text-slate-500">ALT-{record.id.slice(0, 8).toUpperCase()}</code></div>
              <p className="mt-2 truncate font-mono text-xs text-slate-200">{record.request.method} {record.request.url}</p>
              <p className="mt-1 text-[10px] text-slate-600">{new Date(record.analyzedAt).toLocaleString()} · Model score {(modelScore(record) * 100).toFixed(2)}%</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <select className="form-control h-9 text-xs" value={record.reviewStatus} onChange={(event) => updateRequest(record.id, { reviewStatus: event.target.value as ReviewStatus })} aria-label="Alert review status">
                {(["New", "Under Review", "Resolved", "False Positive"] as const).map((value) => <option key={value}>{value}</option>)}
              </select>
              <Link className="button-secondary min-h-9" to={`/incidents?request=${record.id}`}>Investigate<ArrowRight size={13} /></Link>
            </div>
          </article>
        ))}{alerts.length < alertsTotal && <div className="text-center"><button className="button-secondary" type="button" disabled={alertsLoading} onClick={() => void refreshAlerts(alerts.length)}>{alertsLoading ? "Loading…" : `Load more (${alerts.length} of ${alertsTotal})`}</button></div>}</div>
      )}
    </div>
  );
}

export function TrafficPage() {
  const { requests, historyError, historyLoading } = useSession();
  const summary = summarizeRequests(requests);
  return (
    <div className="space-y-6">
      <Header eyebrow="Monitoring" title="Traffic analytics" description="Charts use persisted APISentinel prediction records, not observed network traffic." badge="STORED ANALYSES" />
      {historyError && <p role="alert" className="panel-card p-4 text-xs text-rose-200">{historyError}</p>}
      {historyLoading && !requests.length ? <div className="panel-card p-6 text-center text-xs text-slate-500">Loading stored prediction records…</div> : !requests.length ? <EmptyState title="No request data to chart" message="Stored prediction records will populate charts after successful analyses." /> : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Summary label="Recent records shown" value={String(summary.total)} />
            <Summary label="Normal" value={String(summary.normal)} />
            <Summary label="Anomalous" value={String(summary.anomalous)} />
            <Summary label="Recent-record anomaly rate" value={`${(summary.anomalyRate * 100).toFixed(1)}%`} />
          </div>
          <div className="grid gap-4 xl:grid-cols-2">
            <ChartCard title="Request analyses over time" description="Stored analyses grouped by minute" kind="time" series={{ data: trendData(requests), xAxisKey: "time", dataKey: "requests", name: "Analyzed requests" }} />
            <ChartCard title="Normal vs anomalous" description="Model classification counts" kind="category" categorySeries={{ data: classificationData(requests), name: "Requests" }} />
            <ChartCard title="Requests by method" description="Methods in the stored records shown" kind="category" categorySeries={{ data: methodData(requests), name: "Requests" }} />
            <ChartCard title="Most analyzed endpoints" description="Request counts grouped by path" kind="category" categorySeries={{ data: endpointData(requests).map((entry) => ({ label: entry.endpoint, value: entry.count })), name: "Requests" }} />
            <ChartCard title="Model confidence distribution" description="Score bins derived from actual stored predictions; not calibrated attack probabilities" kind="category" categorySeries={{ data: confidenceDistribution(requests), name: "Predictions" }} />
          </div>
          <p className="text-[11px] leading-5 text-slate-600">Charts use up to 100 most recent stored prediction records. They are not equivalent to network throughput; the backend has no traffic ingestion or event timeline API.</p>
        </>
      )}
    </div>
  );
}

export function EndpointRiskPage() {
  const { requests, historyError, historyLoading } = useSession();
  const [sortKey, setSortKey] = useState<"anomalyRate" | "count" | "averageScore">("anomalyRate");
  const [query, setQuery] = useState("");
  const endpoints = useMemo(
    () => endpointData(requests).filter((entry) => entry.endpoint.toLowerCase().includes(query.toLowerCase())).sort((a, b) => b[sortKey] - a[sortKey]),
    [requests, sortKey, query],
  );
  return (
    <div className="space-y-6">
      <Header eyebrow="Monitoring" title="Endpoint risk ranking" description="Endpoint summaries derived from persisted prediction records. Average model confidence is descriptive, not a validated endpoint risk score." badge="RECENT RECORDS" />
      {historyError && <p role="alert" className="panel-card p-4 text-xs text-rose-200">{historyError}</p>}
      {historyLoading && !requests.length ? <div className="panel-card p-6 text-center text-xs text-slate-500">Loading stored prediction records…</div> : !requests.length ? <EmptyState title="No endpoints ranked" message="An endpoint appears after at least one successful prediction has been stored." /> : (
        <>
        <ChartCard title="Requests per endpoint" description="Counts in the currently loaded stored records (up to 100)" kind="category" categorySeries={{ data: endpoints.map((entry) => ({ label: entry.endpoint, value: entry.count })), name: "Requests" }} />
        <section className="panel-card overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-line p-4 sm:flex-row sm:items-center sm:justify-between">
            <label className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" /><input className="form-control h-9 pl-9 text-xs sm:w-64" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter endpoint" aria-label="Filter endpoints" /></label>
            <label className="flex items-center gap-2 text-xs text-slate-500">Sort by<select className="form-control h-9" value={sortKey} onChange={(event) => setSortKey(event.target.value as typeof sortKey)}><option value="anomalyRate">Anomaly rate</option><option value="count">Request count</option><option value="averageScore">Average model score</option></select></label>
          </div>
          <div className="overflow-x-auto"><table className="data-table min-w-[800px]"><thead><tr><th>Endpoint</th><th>Requests</th><th>Anomalous</th><th>Anomaly rate</th><th>Avg. model score</th><th>Last analyzed</th></tr></thead><tbody>
            {endpoints.map((entry) => <tr key={entry.endpoint}><td className="font-mono text-slate-200">{entry.endpoint}</td><td>{entry.count}</td><td>{entry.anomalous}</td><td>{(entry.anomalyRate * 100).toFixed(1)}%</td><td>{(entry.averageScore * 100).toFixed(2)}%</td><td>{new Date(entry.lastAnalyzed).toLocaleString()}</td></tr>)}
            {!endpoints.length && <tr><td colSpan={6} className="py-8 text-center text-xs text-slate-500">No endpoints match this filter.</td></tr>}
          </tbody></table></div>
          <p className="border-t border-line px-4 py-3 text-[10px] text-slate-600">Endpoint = URL path only. Query strings are excluded. Ranking is descriptive, not a security verdict.</p>
        </section>
        </>
      )}
    </div>
  );
}

export function IncidentsPage() {
  const [searchParams] = useSearchParams();
  const requestId = searchParams.get("request");
  const { alerts, alertsError, alertsLoading, updateRequest } = useSession();
  const incident = alerts.find((record) => record.id === requestId);
  const [draft, setDraft] = useState(incident?.notes ?? "");
  const anomalyRecords = alerts;
  useEffect(() => {
    setDraft(incident?.notes ?? "");
  }, [incident?.id, incident?.notes]);

  if (!incident) {
    return <div className="space-y-6"><Header eyebrow="Investigation" title="Incident investigation" description="Investigate a persisted anomaly alert using its model result and extracted feature values." badge="NO ATTACK ATTRIBUTION" />{alertsError && <p role="alert" className="text-xs text-rose-200">{alertsError}</p>}{alertsLoading ? <div className="panel-card p-6 text-center text-xs text-slate-500">Loading stored alerts…</div> : anomalyRecords.length ? (
      <section className="panel-card divide-y divide-line">{anomalyRecords.map((record) => <Link key={record.id} to={`/incidents?request=${record.id}`} className="flex flex-wrap items-center justify-between gap-3 p-4 hover:bg-white/[0.02]"><div><p className="font-mono text-xs text-slate-200">{record.request.method} {record.request.url}</p><p className="mt-1 text-[10px] text-slate-600">{new Date(record.analyzedAt).toLocaleString()}</p></div><PredictionTag record={record} /></Link>)}</section>
    ) : <EmptyState title="No anomalous request to investigate" message="A case can be opened after the model returns an anomalous classification." link="/alerts" />}</div>;
  }

  const featureRows = Object.entries(incident.result.features);
  const statusOptions: ReviewStatus[] = ["New", "Under Review", "Resolved", "False Positive"];
  return (
    <div className="space-y-6">
      <Header eyebrow="Investigation" title="Incident investigation" description="Review the prediction evidence and add analyst notes. The model output does not establish attack attribution or root cause." badge={`CASE ${incident.id.slice(0, 8).toUpperCase()}`} />
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="panel-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div><p className="text-[10px] uppercase tracking-wide text-slate-500">Analyzed request</p><p className="mt-2 break-all font-mono text-sm text-text-primary">{incident.request.method} {incident.request.url}</p><p className="mt-2 text-xs text-slate-500">{new Date(incident.analyzedAt).toLocaleString()}</p></div>
            <PredictionTag record={incident} />
          </div>
          <div className="mt-5 grid gap-2 sm:grid-cols-4"><Summary label="Alert ID" value={`ALT-${incident.id.slice(0, 8).toUpperCase()}`} /><Summary label="Prediction" value={incident.result.prediction.toUpperCase()} /><Summary label="Class ID" value={String(incident.result.class_id)} /><Summary label="Model confidence" value={`${(modelScore(incident) * 100).toFixed(2)}%`} /></div>
          <h2 className="mt-6 text-xs font-semibold text-text-primary">Extracted model features</h2>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">{featureRows.map(([key, value]) => <div key={key} className="rounded-lg border border-line px-3 py-2"><p className="truncate text-[10px] text-slate-500">{key}</p><p className="mt-1 font-mono text-xs text-slate-200">{value}</p></div>)}</div>
        </section>
        <section className="panel-card p-5">
          <h2 className="text-sm font-semibold text-text-primary">Analyst review</h2>
          <label className="field-label mt-4 block">Review status<select className="form-control mt-2" value={incident.reviewStatus} onChange={(event) => updateRequest(incident.id, { reviewStatus: event.target.value as ReviewStatus })}>{statusOptions.map((status) => <option key={status}>{status}</option>)}</select></label>
          <label className="field-label mt-4 block">Investigation notes<textarea className="form-control mt-2 min-h-32 resize-y text-xs leading-5" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Record observations. Avoid unsupported conclusions." /></label>
          <div className="mt-3 flex flex-wrap gap-2"><button className="button-primary" onClick={() => updateRequest(incident.id, { notes: draft })} type="button">Save notes</button><button className="button-secondary" type="button" onClick={() => exportCsv(`apisentinel-incident-${incident.id.slice(0, 8)}.csv`, ["Alert ID", "Timestamp", "Method", "URL", "Prediction", "Class ID", "Confidence", "Review status", "Notes"], [[`ALT-${incident.id.slice(0, 8)}`, incident.analyzedAt, incident.request.method, incident.request.url, incident.result.prediction, String(incident.result.class_id), String(modelScore(incident)), incident.reviewStatus, incident.notes]])}><Download size={13} />Export details</button></div>
          {alertsError && <p role="alert" className="mt-3 text-[11px] text-rose-200">Could not save review changes: {alertsError}</p>}
          <p className="mt-4 text-[10px] leading-4 text-slate-600">Status and notes are persisted in the local database. This is a single-user local development service without authentication; do not expose it to untrusted users.</p>
        </section>
      </div>
    </div>
  );
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-lg border border-line bg-black/[0.07] p-3"><p className="text-[10px] text-slate-500">{label}</p><p className="mt-1 font-mono text-xs text-slate-200">{value}</p></div>;
}

export function FeedbackPage() {
  const { requests, historyError, historyLoading, updateRequest } = useSession();
  const [decisions, setDecisions] = useState<Record<string, AnalystDecision>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  function saveFeedback(record: RequestRecord) {
    const decision = decisions[record.id];
    if (!decision) return;
    updateRequest(record.id, { feedback: { decision, notes: notes[record.id] ?? "", reviewedAt: new Date().toISOString() } });
  }
  return (
    <div className="space-y-6">
      <Header eyebrow="Investigation" title="Analyst feedback" description="The current backend has no analyst-feedback endpoint. Record decisions only for the current page session; they are not saved to SQLite and do not retrain the model." badge="BACKEND API REQUIRED" />
      {historyError && <p role="alert" className="panel-card p-4 text-xs text-rose-200">{historyError}</p>}
      {historyLoading && !requests.length ? <div className="panel-card p-6 text-center text-xs text-slate-500">Loading stored predictions…</div> : !requests.length ? <EmptyState title="No predictions to review" message="Stored successful predictions will appear here for analyst review." /> : (
        <div className="space-y-3">{requests.map((record) => (
          <article key={record.id} className="panel-card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="mb-1 font-mono text-[10px] text-slate-500">REQ-{record.id.slice(0, 8).toUpperCase()}</p><p className="truncate font-mono text-xs text-slate-200">{record.request.method} {record.request.url}</p><p className="mt-1 text-[10px] text-slate-600">{new Date(record.analyzedAt).toLocaleString()} · {(modelScore(record) * 100).toFixed(2)}% model confidence</p></div><PredictionTag record={record} /></div>
            <div className="mt-4 grid gap-3 md:grid-cols-[200px_1fr_auto] md:items-end">
              <label className="field-label">Analyst decision<select className="form-control mt-2" value={decisions[record.id] ?? record.feedback?.decision ?? ""} onChange={(event) => setDecisions((previous) => ({ ...previous, [record.id]: event.target.value as AnalystDecision }))}><option value="" disabled>Select decision</option><option>Confirmed anomaly</option><option>False positive</option><option>Uncertain</option></select></label>
              <label className="field-label">Review notes<input className="form-control mt-2" value={notes[record.id] ?? record.feedback?.notes ?? ""} onChange={(event) => setNotes((previous) => ({ ...previous, [record.id]: event.target.value }))} placeholder="Optional notes" /></label>
              <button className="button-primary min-h-10" type="button" disabled={!(decisions[record.id] ?? record.feedback?.decision)} onClick={() => saveFeedback(record)}>Save in page session</button>
            </div>
            {record.feedback && <p className="mt-3 text-[10px] text-slate-600">Page-session only: {record.feedback.decision} · {new Date(record.feedback.reviewedAt).toLocaleString()}</p>}
          </article>
        ))}</div>
      )}
    </div>
  );
}

export function ReportsPage() {
  const { requests, historyTotal, historyError, historyLoading } = useSession();
  const [reportTitle, setReportTitle] = useState("APISentinel database security report");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const filteredRequests = requests.filter((record) => {
    const day = record.analyzedAt.slice(0, 10);
    return (!startDate || day >= startDate) && (!endDate || day <= endDate);
  });
  const stats = summarizeRequests(filteredRequests);
  const endpointSummary = endpointData(filteredRequests);
  function exportReport() {
    exportCsv("apisentinel-database-report.csv", ["Report title", "Timestamp", "Method", "URL", "Prediction", "Model score", "Review status", "Analyst notes"], filteredRequests.map((record) => [
      reportTitle, record.analyzedAt, record.request.method, record.request.url, record.result.prediction,
      String(modelScore(record)), record.alertId ? record.reviewStatus : "—", record.alertId ? record.notes : "",
    ]));
  }
  return (
    <div className="space-y-6 print:space-y-4">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6 print:border-black">
        <div><div className="mb-3 flex items-center gap-2"><span className="eyebrow">Reporting</span><StatusBadge>DATABASE RECORDS</StatusBadge></div><h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">Security report</h1><p className="mt-2 text-sm text-slate-400">A printable summary of the 100 newest persisted prediction records.</p></div>
        <div className="flex gap-2 print:hidden"><button className="button-secondary" onClick={exportReport} disabled={!filteredRequests.length}><Download size={14} />Export CSV</button><button className="button-primary" onClick={() => window.print()} disabled={!filteredRequests.length}><FileText size={14} />Print / PDF</button></div>
      </section>
      {historyError && <p role="alert" className="panel-card p-4 text-xs text-rose-200">{historyError}</p>}
      {historyLoading && !requests.length ? <div className="panel-card p-6 text-center text-xs text-slate-500">Loading stored report records…</div> : !requests.length ? <EmptyState title="No report data available" message="Run one or more successful model analyses to create a database-backed report." /> : (
        <div className="space-y-5">
          <div className="panel-card grid gap-3 p-4 md:grid-cols-[1fr_180px_180px] print:hidden">
            <label className="field-label">Report title<input className="form-control mt-2" value={reportTitle} onChange={(event) => setReportTitle(event.target.value)} maxLength={120} /></label>
            <label className="field-label">From<input className="form-control mt-2" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
            <label className="field-label">Through<input className="form-control mt-2" type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} min={startDate || undefined} /></label>
          </div>
          <div className="space-y-1"><h2 className="text-lg font-semibold text-text-primary">{reportTitle}</h2><p className="text-xs text-slate-500">Generated {new Date().toLocaleString()} · showing {requests.length} of {historyTotal} stored records (newest first) · payload contents excluded · {startDate || "all dates"} to {endDate || "present"}</p></div>
          {!filteredRequests.length ? <EmptyState title="No records in this date range" message="Adjust the date range to include one or more stored prediction records." link="/reports" /> : (
            <>
              <div className="grid gap-3 sm:grid-cols-4"><Summary label="Requests analyzed" value={String(stats.total)} /><Summary label="Normal predictions" value={String(stats.normal)} /><Summary label="Anomalous predictions" value={String(stats.anomalous)} /><Summary label="Recent-record anomaly rate" value={`${(stats.anomalyRate * 100).toFixed(1)}%`} /></div>
              <ChartCard title="Prediction distribution" description="Classification counts from persisted report records" kind="category" categorySeries={{ data: classificationData(filteredRequests), name: "Requests" }} />
              <section className="panel-card grid gap-3 p-4 sm:grid-cols-3"><Summary label="Model" value="XGBoost" /><Summary label="Training dataset" value="CSIC 2010" /><Summary label="Input features" value="8" /></section>
              <section className="panel-card overflow-hidden print:border-black print:bg-white"><div className="border-b border-line px-5 py-4 print:border-black"><h2 className="text-sm font-semibold text-text-primary print:text-black">Endpoint summary</h2></div><div className="overflow-x-auto"><table className="data-table min-w-[600px]"><thead><tr><th>Endpoint</th><th>Requests</th><th>Anomalous</th><th>Anomaly rate</th><th>Average score</th></tr></thead><tbody>{endpointSummary.map((endpoint) => <tr key={endpoint.endpoint}><td className="font-mono">{endpoint.endpoint}</td><td>{endpoint.count}</td><td>{endpoint.anomalous}</td><td>{(endpoint.anomalyRate * 100).toFixed(1)}%</td><td>{(endpoint.averageScore * 100).toFixed(2)}%</td></tr>)}</tbody></table></div></section>
              <section className="panel-card overflow-hidden print:border-black print:bg-white"><div className="border-b border-line px-5 py-4 print:border-black"><h2 className="text-sm font-semibold text-text-primary print:text-black">Analyzed request records</h2></div><div className="overflow-x-auto"><table className="data-table min-w-[700px]"><thead><tr><th>Timestamp</th><th>Method</th><th>URL</th><th>Prediction</th><th>Confidence</th><th>Review</th></tr></thead><tbody>{filteredRequests.map((record) => <tr key={record.id}><td>{new Date(record.analyzedAt).toLocaleString()}</td><td>{record.request.method}</td><td className="max-w-[320px] truncate font-mono">{record.request.url}</td><td>{record.result.prediction.toUpperCase()}</td><td>{(modelScore(record) * 100).toFixed(2)}%</td><td>{record.alertId ? record.reviewStatus : "—"}{record.alertId && record.notes && <p className="max-w-48 truncate text-[10px] text-slate-500">{record.notes}</p>}</td></tr>)}</tbody></table></div></section>
            </>
          )}
          <p className="text-[11px] leading-5 text-slate-500">This report contains the newest stored records loaded from SQLite. An anomalous classification is not a confirmed incident. This local single-user database is not protected by authentication and should not be exposed to untrusted users.</p>
        </div>
      )}
    </div>
  );
}

export function ExplainabilityPage() {
  return <div className="space-y-6"><Header eyebrow="Intelligence" title="Explainable AI" description="A model decision can only be explained using attribution information actually computed and returned by the backend." badge="INTEGRATION PENDING" /><EmptyState title="Feature attribution is not available" message="The current prediction response includes raw extracted feature values, but no SHAP values, feature contributions, or explanation data. Raw inputs are not presented as explanations." link="/analyzer" /></div>;
}

export function LiveMonitoringPage() {
  const [events, setEvents] = useState<MonitoringEventItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<string | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(false);
  const hasLoadedRef = useRef(false);

  async function refreshEvents() {
    if (requestRef.current || !mountedRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(!hasLoadedRef.current);
    setRefreshing(hasLoadedRef.current);
    try {
      const response = await getMonitoringEvents({ limit: 100, offset: 0 }, controller.signal);
      if (controller.signal.aborted || !mountedRef.current) return;
      setEvents(response.items);
      setTotal(response.total);
      setError(null);
      setLastRefreshed(new Date().toISOString());
      hasLoadedRef.current = true;
    } catch (cause) {
      if (controller.signal.aborted || !mountedRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load monitoring events.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
      if (mountedRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    let interval: number | undefined;
    const cancelRequest = () => {
      const controller = requestRef.current;
      requestRef.current = null;
      controller?.abort();
    };
    const stopPolling = () => {
      if (interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    const updatePolling = () => {
      stopPolling();
      if (document.visibilityState !== "visible") {
        cancelRequest();
        return;
      }
      void refreshEvents();
      interval = window.setInterval(() => void refreshEvents(), 10_000);
    };
    document.addEventListener("visibilitychange", updatePolling);
    updatePolling();
    return () => {
      mountedRef.current = false;
      document.removeEventListener("visibilitychange", updatePolling);
      stopPolling();
      cancelRequest();
    };
  }, []);

  return (
    <div className="space-y-6">
      <Header
        eyebrow="Monitoring"
        title="Live request monitoring"
        description="Recent metadata submitted by your registered integrations and application workflows. APISentinel does not capture external traffic automatically."
        badge="POLLING · 10 SECONDS"
      />
      <section className="panel-card space-y-4 p-5" aria-label="Monitoring event dashboard">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
              <Activity size={15} className="text-accent" />Recent received events
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Showing up to 100 newest events · {total} total for your account
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-slate-500">
              {lastRefreshed ? `Last refreshed ${new Date(lastRefreshed).toLocaleTimeString()}` : "Not refreshed yet"}
            </span>
            <button
              className="button-secondary min-h-9"
              type="button"
              disabled={refreshing || loading}
              onClick={() => void refreshEvents()}
            >
              <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
              {refreshing || loading ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </div>
        {error && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] p-3 text-xs text-rose-200">
            <span>{error}</span>
            <button className="button-secondary min-h-8" type="button" onClick={() => void refreshEvents()}>Retry</button>
          </div>
        )}
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-500">Loading recent monitoring events…</div>
        ) : events.length === 0 ? (
          <div className="flex min-h-48 flex-col items-center justify-center text-center">
            <span className="grid size-10 place-items-center rounded-lg border border-line text-slate-500"><AlertCircle size={18} /></span>
            <h3 className="mt-3 text-sm font-semibold text-text-primary">No monitoring events received</h3>
            <p className="mt-2 max-w-lg text-xs leading-5 text-slate-500">
              Events appear here after a registered integration submits them. Website registration alone does not capture traffic.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table min-w-[1120px]">
              <thead>
                <tr>
                  <th>Received</th><th>Event time</th><th>Website</th><th>Method</th><th>Endpoint</th><th>Status</th>
                  <th>Duration</th><th>Request size</th><th>Scoring</th><th>Prediction</th><th>Model score</th>
                </tr>
              </thead>
              <tbody>
                {events.map((event) => (
                  <tr key={event.id}>
                    <td className="whitespace-nowrap">{new Date(event.received_at).toLocaleString()}</td>
                    <td className="whitespace-nowrap">{new Date(event.event_timestamp).toLocaleString()}</td>
                    <td>{event.website_name}</td>
                    <td>{event.method}</td>
                    <td className="max-w-[260px] truncate font-mono" title={event.endpoint}>{event.endpoint}</td>
                    <td>{event.response_status}</td>
                    <td>{event.request_duration_ms.toFixed(1)} ms</td>
                    <td>{event.request_size_bytes.toLocaleString()} B</td>
                    <td>{event.scoring_status}</td>
                    <td>{event.prediction_label ?? "—"}</td>
                    <td>{event.model_score === null ? "—" : `${(event.model_score * 100).toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="text-[10px] leading-5 text-slate-600">
          Event time is supplied by the integration; received time is recorded by APISentinel. Model scores are not calibrated attack probabilities.
          Polling pauses when this page is hidden and stops when it is closed.
        </p>
      </section>
    </div>
  );
}

const MAX_CSV_FILE_BYTES = 1024 * 1024;
const MAX_CSV_DATA_ROWS = 1_000;
const MAX_CSV_COLUMNS = 32;
const MAX_REQUEST_URL_LENGTH = 8_192;
const MAX_REQUEST_PAYLOAD_LENGTH = 256 * 1024;
const CSV_PREVIEW_ROWS = 10;

function parseCsv(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  function pushCell() {
    if (row.length >= MAX_CSV_COLUMNS) {
      throw new Error(`CSV exceeds the maximum of ${MAX_CSV_COLUMNS} columns.`);
    }
    row.push(cell);
    cell = "";
  }
  function pushRow() {
    pushCell();
    if (row.some((value) => value.trim())) {
      if (rows.length > MAX_CSV_DATA_ROWS) {
        throw new Error(`CSV exceeds the maximum of ${MAX_CSV_DATA_ROWS.toLocaleString()} data rows.`);
      }
      rows.push(row);
    }
    row = [];
  }
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"' && quoted && text[index + 1] === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      pushCell();
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  pushRow();
  return rows;
}

type BatchRowStatus = "pending" | "processing" | "completed" | "failed";

interface BatchRow {
  rowNumber: number;
  url: string;
  method: string;
  payload: string;
  status: BatchRowStatus;
  prediction?: string;
  error?: string;
}

function validateBatchRows(headers: string[], csvRows: string[][]): BatchRow[] {
  const urlIndex = headers.indexOf("url");
  const payloadIndex = headers.indexOf("payload");
  const methodIndex = headers.indexOf("method");
  return csvRows.map((csvRow, index) => {
    const url = csvRow[urlIndex]?.trim() ?? "";
    const payload = csvRow[payloadIndex] ?? "";
    const method = methodIndex === -1 ? "" : csvRow[methodIndex]?.trim().toUpperCase() ?? "";
    let error: string | undefined;
    if (csvRow.length !== headers.length) {
      error = `Expected ${headers.length} columns but found ${csvRow.length}.`;
    } else if (!url) {
      error = "URL is required.";
    } else if (url.length > MAX_REQUEST_URL_LENGTH) {
      error = `URL exceeds the ${MAX_REQUEST_URL_LENGTH.toLocaleString()}-character limit.`;
    } else if (payload.length > MAX_REQUEST_PAYLOAD_LENGTH) {
      error = `Payload exceeds the ${(MAX_REQUEST_PAYLOAD_LENGTH / 1024).toLocaleString()} KiB character limit.`;
    }
    return {
      rowNumber: index + 2,
      url,
      method: method || "GET",
      payload,
      status: error ? "failed" : "pending",
      error,
    };
  });
}

function csvHeaderIndexes(headers: string[]) {
  const required = ["url", "payload"];
  const missing = required.filter((column) => !headers.includes(column));
  if (missing.length) {
    throw new Error(`Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }
  const allowed = ["url", "payload", "method"];
  const unexpected = headers.filter((column) => !allowed.includes(column));
  if (unexpected.length) {
    throw new Error(`Unsupported column${unexpected.length > 1 ? "s" : ""}: ${unexpected.join(", ")}.`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new Error("CSV contains duplicate column names.");
  }
}

export function BatchPage() {
  const { refreshAll, summary } = useSession();
  const fileInput = useRef<HTMLInputElement>(null);
  const runInProgress = useRef(false);
  const [filename, setFilename] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [batchRows, setBatchRows] = useState<BatchRow[]>([]);
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [runFinished, setRunFinished] = useState(false);
  const [runMessage, setRunMessage] = useState("");
  const [persistenceWarning, setPersistenceWarning] = useState("");
  const totalRows = batchRows.length;
  const completedRows = batchRows.filter((row) => row.status === "completed" || row.status === "failed").length;
  const successCount = batchRows.filter((row) => row.status === "completed").length;
  const failedCount = batchRows.filter((row) => row.status === "failed").length;
  const currentRow = batchRows.find((row) => row.status === "processing");
  const canRun = batchRows.some((row) => row.status === "pending");

  async function handleFile(file?: File) {
    if (running) return;
    setError("");
    setFilename("");
    setHeaders([]);
    setRows([]);
    setBatchRows([]);
    setRunFinished(false);
    setRunMessage("");
    setPersistenceWarning("");
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("Choose a .csv file.");
      return;
    }
    if (file.size > MAX_CSV_FILE_BYTES) {
      setError("CSV exceeds the 1 MiB preview size limit.");
      return;
    }
    try {
      const parsed = parseCsv(await file.text());
      const first = parsed[0]?.map((value) => value.trim().toLowerCase()) ?? [];
      csvHeaderIndexes(first);
      const dataRows = parsed.slice(1);
      if (!dataRows.length) throw new Error("CSV contains no data rows.");
      const validatedRows = validateBatchRows(first, dataRows);
      setFilename(file.name);
      setHeaders(first);
      setRows(dataRows.slice(0, CSV_PREVIEW_ROWS));
      setBatchRows(validatedRows);
      if (validatedRows.every((row) => row.status === "failed")) {
        setRunFinished(true);
        setRunMessage("No valid rows to submit; all rows failed validation.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read this CSV file.");
    }
  }

  async function runBatch() {
    if (runInProgress.current || !canRun) return;
    runInProgress.current = true;
    setRunning(true);
    setRunFinished(false);
    setRunMessage("");
    setPersistenceWarning("");
    const previousTotal = summary?.total_requests;
    const pendingRows = batchRows.filter((row) => row.status === "pending");
    let succeeded = 0;
    let failed = batchRows.filter((row) => row.status === "failed").length;
    try {
      for (const batchRow of pendingRows) {
        setBatchRows((current) => current.map((row) =>
          row.rowNumber === batchRow.rowNumber ? { ...row, status: "processing" } : row,
        ));
        try {
          const request: Required<RequestScan> = {
            method: batchRow.method,
            url: batchRow.url,
            payload: batchRow.payload,
          };
          const result: PredictionResult = await predictRequest(request);
          succeeded += 1;
          setBatchRows((current) => current.map((row) =>
            row.rowNumber === batchRow.rowNumber
              ? { ...row, status: "completed", prediction: result.prediction }
              : row,
          ));
        } catch (cause) {
          failed += 1;
          const message = cause instanceof Error ? cause.message : "Prediction request failed.";
          setBatchRows((current) => current.map((row) =>
            row.rowNumber === batchRow.rowNumber
              ? { ...row, status: "failed", error: message.slice(0, 300) }
              : row,
          ));
        }
      }
      const refreshed = await refreshAll();
      const expectedTotal = (previousTotal ?? 0) + succeeded;
      if (
        refreshed.errors.history ||
        refreshed.errors.summary ||
        (succeeded > 0 &&
          (refreshed.summary === null || refreshed.summary.total_requests < expectedTotal))
      ) {
        setPersistenceWarning(
          "One or more successful prediction responses could not be confirmed in stored history. Check the refreshed history and summary; the existing prediction endpoint can return a result even when persistence fails.",
        );
      }
      setRunMessage(
        failed
          ? `Batch partially completed: ${succeeded} succeeded, ${failed} failed.`
          : `Batch completed: ${succeeded} prediction${succeeded === 1 ? "" : "s"} succeeded.`,
      );
      setRunFinished(true);
    } finally {
      runInProgress.current = false;
      setRunning(false);
    }
  }

  function resetBatch() {
    if (running) return;
    setFilename("");
    setHeaders([]);
    setRows([]);
    setBatchRows([]);
    setError("");
    setRunFinished(false);
    setRunMessage("");
    setPersistenceWarning("");
    if (fileInput.current) fileInput.current.value = "";
  }

  function downloadResults() {
    exportCsv(
      "apisentinel-batch-results.csv",
      ["Row Number", "URL", "Method", "Prediction", "Row Status/Error"],
      batchRows.map((row) => [
        String(row.rowNumber),
        row.url,
        row.method,
        row.prediction ?? "",
        row.status === "completed" ? "Completed" : row.error ? `Failed: ${row.error}` : row.status,
      ]),
    );
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    void handleFile(event.dataTransfer.files[0]);
  }
  return (
    <div className="space-y-6">
      <Header
        eyebrow="Detection"
        title="Batch CSV analyzer"
        description="Validate a local CSV file and analyze each valid request sequentially using the authenticated request analyzer."
        badge="SEQUENTIAL ANALYSIS"
      />
      <div className="panel-card space-y-5 p-5">
        <label
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
          className={`flex min-h-40 flex-col items-center justify-center rounded-lg border border-dashed border-slate-600 bg-black/[0.06] p-6 text-center ${running ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:border-accent/50"}`}
        >
          <span className="text-sm font-medium text-text-primary">Drop a CSV here or choose a file</span>
          <span className="mt-2 text-xs text-slate-500">
            Required: url, payload · Optional: method · Up to 1 MiB, 1,000 rows, and 32 columns
          </span>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={running}
            onChange={(event) => void handleFile(event.target.files?.[0])}
          />
        </label>
        {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}
        {filename && (
          <section aria-label="CSV preview">
            <p className="text-xs text-slate-400">
              {filename} · previewing {rows.length} of at most {CSV_PREVIEW_ROWS} rows
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table">
                <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
                <tbody>
                  {rows.map((row, index) => (
                    <tr key={index}>
                      {headers.map((_, col) => (
                        <td key={col} className="max-w-[280px] truncate font-mono">{row[col] ?? ""}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">Total rows: {totalRows}</p>
          </section>
        )}
        <div className="flex flex-wrap gap-2">
          <button className="button-primary" type="button" disabled={running || !canRun} onClick={() => void runBatch()}>
            {running ? "Analyzing rows…" : runFinished ? "Batch processed" : "Analyze valid rows"}
          </button>
          <button className="button-secondary" type="button" disabled={running || !filename} onClick={resetBatch}>
            Reset batch
          </button>
          <button
            className="button-secondary"
            type="button"
            disabled={running || !batchRows.length || (!runFinished && !failedCount)}
            onClick={downloadResults}
          >
            <Download size={14} />Download results CSV
          </button>
        </div>
        {totalRows > 0 && (
          <section aria-label="Batch results" className="space-y-3">
            <div className="flex flex-wrap justify-between gap-2 text-xs text-slate-300">
              <span>Total rows: {totalRows}</span>
              <span>Completed rows: {completedRows} of {totalRows}</span>
              <span>Successful: {successCount} · Failed: {failedCount}</span>
            </div>
            <progress
              className="h-2 w-full accent-teal-400"
              value={completedRows}
              max={totalRows}
              aria-label="Batch progress"
            />
            {currentRow && <p role="status" className="text-xs text-accent">Processing row {currentRow.rowNumber} of {totalRows}…</p>}
            {runMessage && <p role="status" className="text-xs text-slate-200">{runMessage}</p>}
            {persistenceWarning && <p role="alert" className="text-xs text-amber-200">{persistenceWarning}</p>}
            <p className="text-xs leading-5 text-slate-500">
              A successful prediction response does not guarantee that it was saved. Verify results in Request history;
              this page refreshes history and summary after processing.
            </p>
            <div className="overflow-x-auto">
              <table className="data-table min-w-[640px]">
                <thead><tr><th>Row</th><th>URL</th><th>Method</th><th>Prediction</th><th>Status / error</th></tr></thead>
                <tbody>
                  {batchRows.map((row) => (
                    <tr key={row.rowNumber}>
                      <td>{row.rowNumber}</td>
                      <td className="max-w-[280px] truncate font-mono" title={row.url}>{row.url || "—"}</td>
                      <td>{row.method}</td>
                      <td>{row.prediction ?? "—"}</td>
                      <td>{row.error ? `Failed: ${row.error}` : row.status === "completed" ? "Completed" : row.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
