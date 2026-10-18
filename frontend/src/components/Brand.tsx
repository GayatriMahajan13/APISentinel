import { ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";

interface BrandProps {
  compact?: boolean;
}

export function Brand({ compact = false }: BrandProps) {
  return (
    <Link to="/" className="flex min-w-0 items-center gap-3" aria-label="APISentinel home">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
        <ShieldCheck size={21} strokeWidth={1.8} />
      </span>
      {!compact && (
        <span className="min-w-0">
          <span className="block truncate text-[15px] font-semibold tracking-tight text-text-primary">
            APISentinel
          </span>
          <span className="block text-[11px] tracking-wide text-text-muted">SECURITY WORKSPACE</span>
        </span>
      )}
    </Link>
  );
}
