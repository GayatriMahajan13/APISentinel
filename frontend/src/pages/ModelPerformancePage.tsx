import { useEffect, useState } from "react";
import { AlertCircle, BrainCircuit, CircleHelp, Database } from "lucide-react";
import { getModelInfo, type ModelInfo } from "../api";
import { StatusBadge } from "../components/StatusBadge";

const historicalMetrics = [
  { label: "Accuracy", key: "accuracy", description: "Overall share of correctly classified requests." },
  { label: "Precision", key: "precision", description: "Share of predicted anomalies that were anomalies in the test set." },
  { label: "Recall", key: "recall", description: "Share of test-set anomalies correctly detected." },
  { label: "F1 score", key: "f1_score", description: "Harmonic mean of precision and recall." },
  { label: "ROC-AUC", key: "roc_auc", description: "Ranking discrimination measured across thresholds." },
] as const;

const fallbackMetricValues: Record<string, number> = {
  accuracy: 0.9887429643527205,
  precision: 0.9965986394557823,
  recall: 0.9832214765100671,
  f1_score: 0.9898648648648649,
  roc_auc: 0.9979080394116808,
};

export function ModelPerformancePage() {
  const [info, setInfo] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getModelInfo(controller.signal).then(setInfo).catch((cause: unknown) => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load model metadata.");
    });
    return () => controller.abort();
  }, []);

  return (
    <div className="space-y-7">
      <section className="border-b border-line pb-6">
        <div className="mb-3 flex items-center gap-2"><span className="eyebrow">Intelligence</span><StatusBadge>HISTORICAL EVALUATION</StatusBadge></div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">ML model performance</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Evaluation results for the trained XGBoost classifier. These are historical test-set metrics, not a live performance measurement.</p>
      </section>
      {error && <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-400/[0.04] p-3 text-xs text-amber-100"><AlertCircle size={15} />Current model metadata endpoint unavailable; showing the historical values recorded with this project.</div>}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {historicalMetrics.map((metric) => {
          const apiValue = info?.[metric.key];
          const value = typeof apiValue === "number" ? apiValue : fallbackMetricValues[metric.key];
          return (
            <article key={metric.key} title={metric.description} className="panel-card p-4">
              <p className="text-xs text-slate-500">{metric.label}</p>
              <p className="mt-3 font-mono text-2xl font-semibold tracking-tight text-text-primary">{(value * 100).toFixed(2)}<span className="text-sm text-slate-500">%</span></p>
              <p className="mt-2 min-h-8 text-[10px] leading-4 text-slate-500">{metric.description}</p>
            </article>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
        <section className="panel-card p-5">
          <h2 className="text-sm font-semibold text-text-primary">Confusion matrix</h2>
          <p className="mt-1 text-xs text-slate-500">Historical counts from the processed CSIC 2010 test dataset.</p>
          <div className="mt-5 grid grid-cols-[90px_1fr_1fr] gap-1 text-center text-[10px]">
            <span />
            <span className="p-2 text-slate-500">Predicted normal</span>
            <span className="p-2 text-slate-500">Predicted anomalous</span>
            <span className="flex items-center justify-center text-slate-500">Actual normal</span>
            <div className="rounded-lg border border-emerald-400/15 bg-emerald-400/[0.06] p-5"><strong className="font-mono text-xl text-emerald-300">936</strong><p className="mt-1 text-slate-500">True negative</p></div>
            <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-5"><strong className="font-mono text-xl text-amber-200">4</strong><p className="mt-1 text-slate-500">False positive</p></div>
            <span className="flex items-center justify-center text-slate-500">Actual anomalous</span>
            <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.05] p-5"><strong className="font-mono text-xl text-amber-200">20</strong><p className="mt-1 text-slate-500">False negative</p></div>
            <div className="rounded-lg border border-rose-400/15 bg-rose-400/[0.05] p-5"><strong className="font-mono text-xl text-rose-300">1,172</strong><p className="mt-1 text-slate-500">True positive</p></div>
          </div>
          <p className="mt-4 flex items-start gap-2 text-[10px] leading-4 text-slate-600"><CircleHelp size={12} className="mt-0.5 shrink-0" />Counts are project-provided historical evaluation results; the live /model-info API does not return a confusion matrix.</p>
        </section>
        <section className="panel-card p-5">
          <h2 className="text-sm font-semibold text-text-primary">Model and dataset</h2>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-line bg-black/[0.07] p-3"><BrainCircuit size={17} className="text-accent" /><div><p className="text-xs text-slate-300">{String(info?.model ?? "XGBoost")}</p><p className="text-[10px] text-slate-600">Binary classifier</p></div></div>
            <div className="flex items-center gap-3 rounded-lg border border-line bg-black/[0.07] p-3"><Database size={17} className="text-accent" /><div><p className="text-xs text-slate-300">{String(info?.dataset ?? "CSIC 2010")}</p><p className="text-[10px] text-slate-600">Historical HTTP request dataset</p></div></div>
          </div>
          <h3 className="mt-5 text-xs font-semibold text-text-primary">Eight model input features</h3>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {["payload_len", "url_len", "param_count", "special_char_count", "digit_count", "encoded_char_count", "path_depth", "payload_entropy"].map((feature) => <code key={feature} className="rounded border border-line bg-black/10 px-2 py-1 font-mono text-[10px] text-slate-400">{feature}</code>)}
          </div>
        </section>
      </div>
      <p className="rounded-lg border border-line bg-white/[0.02] p-3 text-[11px] leading-5 text-slate-500">
        Historical evaluation results from the processed CSIC 2010 test dataset. These metrics do not represent live production accuracy. Real-world performance can differ due to traffic and data distribution.
      </p>
    </div>
  );
}
