import { useEffect, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  AlertTriangle,
  CircleHelp,
  Clock3,
  ScanSearch,
  Server,
  ShieldAlert,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { API_BASE_URL, getHealth } from "../api";
import { ChartCard } from "../components/ChartCard";
import { StatusBadge } from "../components/StatusBadge";
import { useSession } from "../context/SessionContext";
import { classificationData, methodData, trendData } from "../utils/data";

const quickLinks = [
  { title: "Analyze a request", description: "Inspect a single HTTP request with the trained model.", icon: ScanSearch, to: "/analyzer", label: "Open analyzer" },
  { title: "Review model details", description: "Explore historical evaluation and model metadata.", icon: ShieldCheck, to: "/model-performance", label: "View model" },
  { title: "Check system status", description: "Confirm backend availability and model readiness.", icon: Server, to: "/system", label: "View status" },
];

function score(record: { result: { confidence: number } }) {
  return `${(record.result.confidence * 100).toFixed(1)}%`;
}

export function DashboardPage() {
  const {
    requests,
    alerts,
    summary,
    summaryError,
    summaryLoading,
    historyError,
    alertsError,
  } = useSession();
  const [backendConnected, setBackendConnected] = useState<boolean | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void getHealth(controller.signal)
      .then((health) => setBackendConnected(health.status === "ok"))
      .catch(() => {
        if (!controller.signal.aborted) setBackendConnected(false);
      });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-7">
      <section className="flex flex-col justify-between gap-5 border-b border-line pb-7 lg:flex-row lg:items-end">
        <div className="max-w-2xl">
          <div className="mb-3 flex items-center gap-2">
            <span className="eyebrow">Security workspace</span>
            <StatusBadge tone={backendConnected ? "ready" : "neutral"}>
              {backendConnected === null ? "CHECKING BACKEND" : backendConnected ? "BACKEND ONLINE" : "BACKEND OFFLINE"}
            </StatusBadge>
          </div>
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary md:text-[34px]">Welcome to APISentinel</h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-slate-400">
            Analyze requests using your trained model and review results stored in the local database.
          </p>
        </div>
        <Link to="/analyzer" className="button-primary w-fit"><ScanSearch size={16} />Quick analyze request<ArrowRight size={15} /></Link>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Kpi title="Requests analyzed" value={summaryLoading ? "…" : summary?.total_requests ?? "Unavailable"} hint="Stored predictions · all time" icon={ScanSearch} />
        <Kpi title="Normal classifications" value={summaryLoading ? "…" : summary?.normal_requests ?? "Unavailable"} hint="Stored model predictions" icon={ShieldCheck} tone="normal" />
        <Kpi title="Anomalous classifications" value={summaryLoading ? "…" : summary?.anomalous_requests ?? "Unavailable"} hint="Model flagged · not confirmed attacks" icon={ShieldAlert} tone="anomalous" />
        <Kpi title="Anomaly rate" value={summaryLoading ? "…" : summary ? `${(summary.anomaly_rate * 100).toFixed(1)}%` : "Unavailable"} hint="Across stored predictions" icon={CircleHelp} />
        <Kpi title="Total alerts" value={summaryLoading ? "…" : summary?.total_alerts ?? "Unavailable"} hint="Stored anomaly alerts" icon={AlertTriangle} tone="anomalous" />
        <Kpi title="Backend status" value={backendConnected === null ? "Checking" : backendConnected ? "Online" : "Offline"} hint="Live GET /health check" icon={Server} tone={backendConnected ? "normal" : undefined} />
      </section>

      {historyError || alertsError || summaryError ? (
        <div role="alert" className="panel-card flex items-start gap-3 p-4 text-xs leading-5 text-rose-200">
          <ShieldAlert size={16} className="mt-0.5 shrink-0" />
          <div><p className="font-medium">Some database-backed dashboard data could not be loaded.</p><p className="mt-1 text-rose-200/70">{[historyError, alertsError, summaryError].filter(Boolean).join(" · ")}</p></div>
        </div>
      ) : null}

      {summaryLoading ? (
        <section className="panel-card flex min-h-28 items-center justify-center text-xs text-slate-500">Loading stored analytics…</section>
      ) : summary?.total_requests === 0 ? (
        <section className="panel-card flex flex-col justify-between gap-5 p-5 md:flex-row md:items-center md:p-6">
          <div className="flex items-start gap-4">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.07] text-accent"><ScanSearch size={19} /></span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Your database is ready for its first request</h2>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-400">No prediction records are stored yet. Start an analysis to populate history, charts, and any model-generated alerts.</p>
            </div>
          </div>
          <Link to="/analyzer" className="button-primary w-fit">Analyze first request<ArrowRight size={14} /></Link>
        </section>
      ) : summary && summary.total_requests > 0 ? (
        <div className="grid gap-4 xl:grid-cols-[1.3fr_0.7fr]">
          <ChartCard
            title="Request activity"
            description="Recent stored analyses (up to 100 records)"
            kind="time"
            series={{ data: trendData(requests), xAxisKey: "time", dataKey: "requests", name: "Requests analyzed" }}
          />
          <ChartCard
            title="Classification mix"
            description="Predictions returned by the model"
            kind="category"
            categorySeries={{ data: classificationData(requests), name: "Requests" }}
          />
        </div>
      ) : null}

      <section className="grid gap-4 xl:grid-cols-[1fr_0.8fr]">
        <div className="panel-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div><h2 className="text-sm font-semibold text-text-primary">Recent analyzed requests</h2><p className="mt-1 text-xs text-slate-500">Newest records from the persistent local database.</p></div>
            <Link to="/history" className="text-xs font-medium text-accent hover:text-[#7be1d7]">View history</Link>
          </div>
          {requests.length === 0 ? <EmptyRow text={historyError ?? "No stored predictions yet."} /> : (
            <div className="divide-y divide-line">
              {requests.slice(0, 5).map((record) => <Link to="/history" key={record.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/[0.02]">
                <div className="min-w-0"><p className="truncate font-mono text-xs text-slate-200">{record.request.method} {record.request.url}</p><p className="mt-1 text-[10px] text-slate-600">{new Date(record.analyzedAt).toLocaleString()}</p></div>
                <div className="flex shrink-0 items-center gap-3"><Classification prediction={record.result.prediction} /><span className="font-mono text-xs text-slate-400">{score(record)}</span></div>
              </Link>)}
            </div>
          )}
        </div>
        <div className="panel-card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div><h2 className="text-sm font-semibold text-text-primary">Model-generated alerts</h2><p className="mt-1 text-xs text-slate-500">Persisted alerts from real anomalous predictions.</p></div>
            <Link to="/alerts" className="text-xs font-medium text-accent hover:text-[#7be1d7]">View alerts</Link>
          </div>
          {alerts.length === 0 ? <EmptyRow text={alertsError ?? "No stored anomalous predictions."} /> : (
            <div className="divide-y divide-line">
              {alerts.slice(0, 4).map((record) => <Link to={`/incidents?request=${record.id}`} key={record.id} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-white/[0.02]">
                <div className="min-w-0"><p className="truncate font-mono text-xs text-slate-200">{record.request.url}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-slate-600"><Clock3 size={11} />{new Date(record.analyzedAt).toLocaleString()}</p></div>
                <Classification prediction={record.result.prediction} />
              </Link>)}
            </div>
          )}
        </div>
      </section>

      {requests.length > 0 && (
        <ChartCard title="Requests by method" description="Derived from the recent stored records" kind="category" categorySeries={{ data: methodData(requests), name: "Requests" }} />
      )}

      <section className="grid gap-3 md:grid-cols-3">
        {quickLinks.map(({ title, description, icon: Icon, to, label }) => (
          <Link key={to} to={to} className="panel-card group p-4 transition-colors hover:border-slate-600">
            <div className="flex items-start justify-between"><span className="grid size-9 place-items-center rounded-lg border border-line bg-white/[0.025] text-accent"><Icon size={17} /></span><ArrowUpRight size={15} className="text-slate-600 group-hover:text-accent" /></div>
            <h3 className="mt-4 text-sm font-medium text-text-primary">{title}</h3><p className="mt-1 min-h-10 text-xs leading-5 text-slate-500">{description}</p>
            <span className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-accent">{label}<ArrowRight size={12} /></span>
          </Link>
        ))}
      </section>
      <p className="flex items-start gap-2 text-[11px] leading-5 text-slate-600"><CircleHelp size={13} className="mt-0.5 shrink-0" />KPI totals come from the persistent local SQLite database. The request table and charts show up to 100 newest records. Backend URL: <code className="font-mono">{API_BASE_URL}</code></p>
    </div>
  );
}

function Kpi({ title, value, hint, icon: Icon, tone }: { title: string; value: string | number; hint: string; icon: LucideIcon; tone?: "normal" | "anomalous" }) {
  return <div className="panel-card p-4"><div className="flex items-center justify-between gap-3"><p className="text-xs text-slate-500">{title}</p><Icon size={15} className={tone === "normal" ? "text-emerald-300" : tone === "anomalous" ? "text-rose-300" : "text-slate-500"} /></div><p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-text-primary">{value}</p><p className="mt-1 text-[10px] text-slate-600">{hint}</p></div>;
}

function Classification({ prediction }: { prediction: string }) {
  const anomalous = prediction.toLowerCase() === "anomalous";
  return <StatusBadge tone={anomalous ? "alert" : "ready"}>{prediction.toUpperCase()}</StatusBadge>;
}

function EmptyRow({ text }: { text: string }) {
  return <div className="flex min-h-28 items-center justify-center px-5 text-center text-xs text-slate-600">{text}</div>;
}
