import { useRef, useState, type FormEvent } from "react";
import {
  AlertCircle,
  Check,
  Clipboard,
  LoaderCircle,
  RotateCcw,
  ScanSearch,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { isPredictionResult, predictRequest, type PredictionResult, type RequestScan } from "../api";
import { StatusBadge } from "../components/StatusBadge";
import { useSession } from "../context/SessionContext";

const featureLabels: Record<string, string> = {
  payload_len: "Payload length",
  url_len: "URL length",
  param_count: "Parameter count",
  special_char_count: "Special characters",
  digit_count: "Digits",
  encoded_char_count: "Encoded characters",
  path_depth: "Path depth",
  payload_entropy: "Payload entropy",
};

function validRequestUrl(value: string) {
  const input = value.trim();
  if (!input) return "Request URL is required.";
  if (/\s/.test(input)) return "URL cannot contain spaces.";
  if (input.startsWith("/")) return undefined;
  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Use an http:// or https:// URL.";
  } catch {
    return "Enter a valid URL or a path beginning with /.";
  }
  return undefined;
}

function isAnomalous(result: PredictionResult) {
  return result.prediction.toLowerCase() === "anomalous";
}

function probability(result: PredictionResult, label: string) {
  const value = result.probabilities[label];
  return typeof value === "number" ? value : undefined;
}

export function AnalyzerPage() {
  const { refreshAll, summary } = useSession();
  const submitInProgress = useRef(false);
  const [method, setMethod] = useState("GET");
  const [url, setUrl] = useState("");
  const [payload, setPayload] = useState("");
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [analyzedAt, setAnalyzedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const urlError = validRequestUrl(url);
    setValidation(urlError ?? null);
    setError(null);
    setPersistenceWarning(null);
    if (urlError || submitInProgress.current) return;

    const request: Required<RequestScan> = { method, url: url.trim(), payload };
    submitInProgress.current = true;
    setLoading(true);
    try {
      const response: unknown = await predictRequest(request);
      if (!isPredictionResult(response)) {
        throw new Error("Prediction service returned an invalid response.");
      }
      setResult(response);
      setAnalyzedAt(new Date().toISOString());
      const previousTotal = summary?.total_requests;
      const refreshed = await refreshAll();
      if (
        refreshed.errors.history ||
        refreshed.errors.summary ||
        (previousTotal !== undefined && refreshed.summary !== null && refreshed.summary.total_requests <= previousTotal)
      ) {
        setPersistenceWarning(
          "Prediction returned, but the database did not confirm that it was saved. Check the backend database status.",
        );
      }
    } catch (cause) {
      if (cause instanceof TypeError) {
        setError("Unable to connect to the APISentinel prediction service.");
      } else {
        setError(cause instanceof Error ? cause.message : "The prediction request failed.");
      }
      setResult(null);
      setAnalyzedAt(null);
    } finally {
      submitInProgress.current = false;
      setLoading(false);
    }
  }

  function clearForm() {
    setMethod("GET");
    setUrl("");
    setPayload("");
    setResult(null);
    setAnalyzedAt(null);
    setError(null);
    setPersistenceWarning(null);
    setValidation(null);
    setCopied(false);
  }

  async function copyResult() {
    if (!result || !analyzedAt) return;
    const text = JSON.stringify({ analyzedAt, method, url, prediction: result }, null, 2);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Could not copy the result. Check browser clipboard permissions.");
    }
  }

  return (
    <div className="space-y-7">
      <section className="border-b border-line pb-6">
        <div className="mb-3 flex items-center gap-2">
          <span className="eyebrow">Detection</span>
          <StatusBadge tone="ready">XGBOOST PREDICTION</StatusBadge>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">API request analyzer</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          Submit a request description to the local APISentinel model. The URL is analyzed as text only;
          APISentinel does not send traffic to the target website.
        </p>
      </section>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
        <section className="panel-card p-5 md:p-6">
          <div className="mb-5 flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-lg border border-accent/20 bg-accent/[0.07] text-accent">
              <ScanSearch size={17} />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Request input</h2>
              <p className="mt-0.5 text-xs text-slate-500">Fields accepted by POST /predict</p>
            </div>
          </div>
          <form className="space-y-4" onSubmit={handleSubmit} noValidate>
            <label className="field-label">
              HTTP method
              <select className="form-control mt-2" value={method} onChange={(event) => setMethod(event.target.value)}>
                {["GET", "POST", "PUT", "DELETE", "PATCH"].map((value) => <option key={value}>{value}</option>)}
              </select>
            </label>
            <label className="field-label">
              Request URL <span className="text-rose-300">*</span>
              <input
                className={`form-control mt-2 font-mono text-[13px] ${validation ? "border-rose-400/50" : ""}`}
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (validation) setValidation(null);
                }}
                placeholder="https://example.com/login"
                aria-invalid={Boolean(validation)}
                aria-describedby={validation ? "url-error" : "url-help"}
                autoComplete="url"
                required
              />
              {validation ? (
                <span className="mt-1.5 block text-[11px] text-rose-300" id="url-error">{validation}</span>
              ) : (
                <span className="mt-1.5 block text-[11px] text-slate-600" id="url-help">A full HTTP(S) URL or a relative path beginning with /.</span>
              )}
            </label>
            <label className="field-label">
              Request payload <span className="font-normal text-slate-600">(optional)</span>
              <textarea
                className="form-control mt-2 min-h-32 resize-y font-mono text-xs leading-5"
                value={payload}
                onChange={(event) => setPayload(event.target.value)}
                placeholder="Paste a request payload to analyze"
                rows={5}
              />
            </label>

            {error && (
              <div role="alert" className="flex items-start gap-2 rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2.5 text-xs leading-5 text-rose-200">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {error}
              </div>
            )}
            {persistenceWarning && (
              <div role="status" className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.05] px-3 py-2.5 text-xs leading-5 text-amber-100">
                <AlertCircle size={15} className="mt-0.5 shrink-0" />
                {persistenceWarning}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-1">
              <button className="button-primary min-h-10" type="submit" disabled={loading}>
                {loading ? <LoaderCircle size={15} className="animate-spin" /> : <ScanSearch size={15} />}
                {loading ? "Analyzing request…" : "Analyze request"}
              </button>
              <button className="button-secondary min-h-10" type="button" onClick={clearForm} disabled={loading}>
                <RotateCcw size={14} /> Clear form
              </button>
            </div>
          </form>
          <div className="mt-5 border-t border-line pt-4 text-[11px] leading-5 text-slate-600">
            Successful predictions persist locally. Raw payload text is never stored; sensitive URL credentials and query values are sanitized before saving.
          </div>
        </section>

        <section className="panel-card min-h-[430px] p-5 md:p-6" aria-live="polite">
          {!result ? (
            <div className="flex min-h-[380px] flex-col items-center justify-center text-center">
              <span className="grid size-12 place-items-center rounded-xl border border-line bg-white/[0.025] text-slate-500">
                <ShieldCheck size={21} />
              </span>
              <h2 className="mt-4 text-sm font-semibold text-text-primary">Prediction result</h2>
              <p className="mt-2 max-w-xs text-xs leading-5 text-slate-500">
                Submit a request to view the model classification, scores, and extracted feature values.
              </p>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className={`grid size-10 place-items-center rounded-xl border ${
                    isAnomalous(result)
                      ? "border-rose-400/20 bg-rose-400/[0.08] text-rose-300"
                      : "border-emerald-400/20 bg-emerald-400/[0.08] text-emerald-300"
                  }`}>
                    {isAnomalous(result) ? <ShieldAlert size={19} /> : <ShieldCheck size={19} />}
                  </span>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">Classification</p>
                    <h2 className={`mt-1 text-lg font-semibold ${isAnomalous(result) ? "text-rose-300" : "text-emerald-300"}`}>
                      {result.prediction.toUpperCase()}
                    </h2>
                  </div>
                </div>
                <button className="button-secondary" onClick={() => void copyResult()} type="button">
                  {copied ? <Check size={14} /> : <Clipboard size={14} />}
                  {copied ? "Copied" : "Copy result"}
                </button>
              </div>
              <p className="rounded-lg border border-line bg-black/10 px-3 py-2.5 text-[11px] leading-5 text-slate-500">
                A model classification, not a confirmed attack. Score represents the model’s output confidence; it is not a calibrated probability of a real-world cyberattack.
              </p>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric label="Class ID" value={String(result.class_id)} />
                <Metric label="Model confidence" value={`${(result.confidence * 100).toFixed(2)}%`} />
                <Metric label="Analyzed at" value={analyzedAt ? new Date(analyzedAt).toLocaleTimeString() : "—"} />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Score label="Normal score" value={probability(result, "normal")} color="#34D399" />
                <Score label="Anomalous score" value={probability(result, "anomalous")} color="#F87171" />
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-text-primary">Extracted model features</h3>
                  <span className="text-[10px] text-slate-600">8 model inputs</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Object.entries(featureLabels).map(([key, label]) => (
                    <div key={key} className="rounded-lg border border-line bg-black/[0.08] px-3 py-2">
                      <p className="text-[10px] text-slate-500">{label}</p>
                      <p className="mt-1 font-mono text-xs text-slate-200">
                        {typeof result.features[key] === "number" ? result.features[key].toLocaleString(undefined, { maximumFractionDigits: 4 }) : "Not returned"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <button className="text-xs font-medium text-accent hover:text-[#7be1d7]" type="button" onClick={clearForm}>
                Analyze another request
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.08] px-3 py-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-1 truncate font-mono text-xs text-slate-200">{value}</p>
    </div>
  );
}

function Score({ label, value, color }: { label: string; value?: number; color: string }) {
  return (
    <div className="rounded-lg border border-line bg-black/[0.08] px-3 py-2.5">
      <p className="text-[10px] text-slate-500">{label}</p>
      <p className="mt-1 font-mono text-xs" style={{ color }}>
        {value === undefined ? "Not returned" : `${(value * 100).toFixed(2)}%`}
      </p>
    </div>
  );
}
