import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, CircleHelp, LoaderCircle, RefreshCw, Server, XCircle } from "lucide-react";
import { API_BASE_URL, API_ENDPOINTS, getHealth, getModelInfo, type HealthResponse, type ModelInfo } from "../api";
import { StatusBadge } from "../components/StatusBadge";

export function SystemPage() {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfo | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [infoError, setInfoError] = useState<string | null>(null);
  const [checkedAt, setCheckedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    const [healthResult, infoResult] = await Promise.allSettled([
      getHealth(signal),
      getModelInfo(signal),
    ]);
    if (signal?.aborted) return;
    if (healthResult.status === "fulfilled") {
      setHealth(healthResult.value);
      setHealthError(null);
    } else {
      setHealth(null);
      setHealthError(healthResult.reason instanceof Error ? healthResult.reason.message : "Health check failed.");
    }
    if (infoResult.status === "fulfilled") {
      setModelInfo(infoResult.value);
      setInfoError(null);
    } else {
      setModelInfo(null);
      setInfoError(infoResult.reason instanceof Error ? infoResult.reason.message : "Model information request failed.");
    }
    setCheckedAt(new Date().toISOString());
    setLoading(false);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const connected = Boolean(health?.status === "ok");
  const featureNames = health?.features ?? [];

  return (
    <div className="space-y-7">
      <section className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="eyebrow">Operations</span>
            <StatusBadge tone={connected ? "ready" : "neutral"}>{connected ? "CONNECTED" : "STATUS UNKNOWN"}</StatusBadge>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">System status</h1>
          <p className="mt-2 text-sm text-slate-400">Live status from the existing FastAPI health and model metadata endpoints.</p>
        </div>
        <button type="button" className="button-secondary" disabled={loading} onClick={() => void refresh()}>
          {loading ? <LoaderCircle size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Refresh status
        </button>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="panel-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-medium text-text-primary"><Server size={16} className="text-accent" /> Backend connection</div>
            {loading ? <LoaderCircle size={15} className="animate-spin text-slate-500" /> : connected ? <CheckCircle2 size={16} className="text-emerald-400" /> : <XCircle size={16} className="text-slate-500" />}
          </div>
          <p className="mt-3 font-mono text-xs text-slate-300">{API_BASE_URL}</p>
          <p className="mt-2 text-xs text-slate-500">{healthError ? "Unable to connect to the APISentinel backend." : connected ? `Health endpoint reports ${health?.status}.` : "Health response has not been received."}</p>
          {healthError && <p className="mt-3 flex items-start gap-2 rounded-md border border-rose-400/20 bg-rose-400/[0.04] p-2 text-[11px] text-rose-200"><AlertCircle size={13} />{healthError}</p>}
        </div>
        <div className="panel-card p-5">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium text-text-primary">Model readiness</div>
            <StatusBadge tone={connected ? "ready" : "neutral"}>{connected ? "READY" : "NOT CONFIRMED"}</StatusBadge>
          </div>
          <p className="mt-3 text-xs text-slate-300">Model type: <span className="font-mono">{health?.model ?? "—"}</span></p>
          <p className="mt-2 text-xs text-slate-500">{connected ? `${featureNames.length} input features reported by /health.` : "Model readiness is confirmed by a successful /health response."}</p>
          {infoError && <p className="mt-3 text-[11px] text-amber-200">Model metadata unavailable: {infoError}</p>}
        </div>
      </section>

      <section className="panel-card overflow-hidden">
        <div className="border-b border-line px-5 py-4">
          <h2 className="text-sm font-semibold text-text-primary">Model metadata</h2>
          <p className="mt-1 text-xs text-slate-500">GET /model-info response</p>
        </div>
        {modelInfo ? (
          <dl className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-3">
            {Object.entries(modelInfo).map(([key, value]) => (
              <div key={key} className="min-w-0 bg-panel px-5 py-3">
              <dt className="text-[10px] uppercase tracking-wide text-slate-500">{key.replace(/_/g, " ")}</dt>
                <dd className="mt-1 break-words font-mono text-xs text-slate-200">
                  {Array.isArray(value) ? value.join(", ") : value === null ? "—" : String(value)}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <div className="p-5 text-xs text-slate-500">{infoError ?? "Checking backend model metadata…"}</div>
        )}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1fr_0.85fr]">
        <div className="panel-card p-5">
          <h2 className="text-sm font-semibold text-text-primary">Available backend endpoints</h2>
          <div className="mt-4 space-y-2">
            {[
              ["GET", API_ENDPOINTS.health.replace(API_BASE_URL, ""), "Service and model health"],
              ["GET", API_ENDPOINTS.modelInfo.replace(API_BASE_URL, ""), "Model metadata"],
              ["GET", API_ENDPOINTS.authSession.replace(API_BASE_URL, ""), "Restore HttpOnly session and CSRF token"],
              ["POST", API_ENDPOINTS.authRegister.replace(API_BASE_URL, ""), "Register with full name, email, and password"],
              ["POST", API_ENDPOINTS.authLogin.replace(API_BASE_URL, ""), "Authenticate with email and password"],
              ["POST", API_ENDPOINTS.authLogout.replace(API_BASE_URL, ""), "Terminate current server session"],
              ["POST", API_ENDPOINTS.websites.replace(API_BASE_URL, ""), "Register an owned website (CSRF protected)"],
              ["GET", API_ENDPOINTS.websites.replace(API_BASE_URL, ""), "List your active website registrations"],
              ["GET", `${API_ENDPOINTS.websites.replace(API_BASE_URL, "")}/{website_id}`, "View an owned website"],
              ["PATCH", `${API_ENDPOINTS.websites.replace(API_BASE_URL, "")}/{website_id}`, "Update an owned website (CSRF protected)"],
              ["DELETE", `${API_ENDPOINTS.websites.replace(API_BASE_URL, "")}/{website_id}`, "Soft-remove an owned website (CSRF protected)"],
              ["POST", API_ENDPOINTS.monitoringEvents.replace(API_BASE_URL, ""), "Server-to-server event ingestion using a website integration credential"],
              ["POST", API_ENDPOINTS.predict.replace(API_BASE_URL, ""), "Authenticated, CSRF-protected request analysis"],
              ["POST", API_ENDPOINTS.predictFeatures.replace(API_BASE_URL, ""), "Authenticated prediction from eight numeric values"],
              ["GET", API_ENDPOINTS.history.replace(API_BASE_URL, ""), "Authenticated, per-user prediction history"],
              ["GET", API_ENDPOINTS.alerts.replace(API_BASE_URL, ""), "Authenticated, per-user anomaly alerts"],
              ["PATCH", `${API_ENDPOINTS.alerts.replace(API_BASE_URL, "")}/{alert_id}`, "Owner-only alert review update; CSRF protected"],
              ["GET", API_ENDPOINTS.analyticsSummary.replace(API_BASE_URL, ""), "Authenticated per-user aggregate statistics"],
            ].map(([method, path, detail]) => (
              <div key={path} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-black/[0.07] px-3 py-2.5">
                <span className="w-12 font-mono text-[10px] font-semibold text-accent">{method}</span>
                <code className="font-mono text-xs text-slate-200">{path}</code>
                <span className="text-[11px] text-slate-500">{detail}</span>
              </div>
            ))}
          </div>
          <p className="mt-4 text-[10px] text-slate-600">Last successful check: {checkedAt && connected ? new Date(checkedAt).toLocaleString() : "No successful check this session."}</p>
        </div>
        <div className="panel-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><CircleHelp size={16} className="text-accent" /> Request flow</div>
          <ol className="mt-5 space-y-3">
            {["React frontend", "FastAPI backend", "Feature extraction", "Trained XGBoost model", "Classification result"].map((item, index) => (
              <li key={item} className="flex items-center gap-3 text-xs text-slate-300">
                <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line font-mono text-[10px] text-accent">{index + 1}</span>
                {item}
              </li>
            ))}
          </ol>
          <p className="mt-4 border-t border-line pt-3 text-[11px] leading-5 text-slate-500">Requests and alerts persist in SQLite and are scoped to authenticated accounts. Batch prediction, explainability, live events, and password recovery still require backend support.</p>
        </div>
      </section>
    </div>
  );
}
