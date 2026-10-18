import { ArrowUpRight, CircleHelp, Construction, Database } from "lucide-react";
import { Link } from "react-router-dom";
import type { Section } from "../sections";
import { ChartCard } from "../components/ChartCard";
import { StatusBadge } from "../components/StatusBadge";

interface SectionPageProps {
  section: Section;
}

export function SectionPage({ section }: SectionPageProps) {
  const Icon = section.icon;
  const isAvailable = section.status === "available";

  return (
    <div className="space-y-7">
      <section className="border-b border-line pb-7">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="eyebrow">{section.group}</span>
          <StatusBadge tone={isAvailable ? "ready" : "planned"}>
            {isAvailable ? "BACKEND CAPABILITY EXISTS" : "PLANNED"}
          </StatusBadge>
        </div>
        <div className="flex items-start gap-4">
          <span className="mt-1 grid size-11 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/[0.07] text-accent">
            <Icon size={20} />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">
              {section.label}
            </h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">{section.description}</p>
          </div>
        </div>
      </section>

      <section className="panel-card p-5 md:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.025] text-slate-400">
            {isAvailable ? <Database size={17} /> : <Construction size={17} />}
          </span>
          <div>
            <h2 className="text-sm font-semibold text-text-primary">
              {isAvailable ? "Ready for frontend integration" : "This section is a layout placeholder"}
            </h2>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-400">{section.apiNote}</p>
          </div>
        </div>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <CircleHelp size={13} />
            No sample results or fabricated metrics are shown.
          </p>
          <Link to="/system" className="inline-flex items-center gap-1.5 text-xs font-medium text-accent hover:text-[#7be1d7]">
            Backend status <ArrowUpRight size={13} />
          </Link>
        </div>
      </section>

      <ChartCard
        title={section.label}
        description="Visualization controls are ready for real data."
        emptyMessage={
          isAvailable
            ? "No data has been requested yet. Connect this view to the corresponding backend endpoint."
            : "This view will populate once the required backend API and data source are implemented."
        }
      />
    </div>
  );
}
