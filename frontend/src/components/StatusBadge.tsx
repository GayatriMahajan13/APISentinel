import { CircleDot } from "lucide-react";

interface StatusBadgeProps {
  children: string;
  tone?: "ready" | "planned" | "neutral" | "alert";
}

export function StatusBadge({ children, tone = "neutral" }: StatusBadgeProps) {
  const colors = {
    ready: "border-accent/20 bg-accent/[0.07] text-accent",
    planned: "border-amber-400/20 bg-amber-400/[0.06] text-amber-200",
    neutral: "border-line bg-white/[0.025] text-slate-400",
    alert: "border-rose-400/20 bg-rose-400/[0.06] text-rose-300",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium tracking-wide ${colors[tone]}`}>
      <CircleDot size={11} strokeWidth={2} />
      {children}
    </span>
  );
}
