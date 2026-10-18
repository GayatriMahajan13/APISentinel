import { useState, type ReactNode } from "react";
import {
  BarChart3,
  ChevronDown,
  ChartArea,
  ChartNoAxesColumn,
  ChartNoAxesColumnIncreasing,
  CircleHelp,
  LineChart as LineChartIcon,
  Table2,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type ChartType = "line" | "area" | "bar" | "horizontal-bar" | "donut" | "table";

interface ChartCardProps {
  title: string;
  description?: string;
  children?: ReactNode;
  emptyMessage?: string;
  kind?: "time" | "category" | "any";
  series?: {
    data: Array<Record<string, string | number>>;
    xAxisKey: string;
    dataKey: string;
    name?: string;
  };
  categorySeries?: {
    data: Array<{ label: string; value: number }>;
    name?: string;
  };
}

const palette = ["#4FD1C5", "#F87171", "#60A5FA", "#F59E0B", "#A78BFA", "#34D399"];
const options: Record<
  NonNullable<ChartCardProps["kind"]>,
  { value: ChartType; label: string; icon: typeof LineChartIcon }[]
> = {
  time: [
    { value: "line", label: "Line graph", icon: LineChartIcon },
    { value: "area", label: "Area chart", icon: ChartArea },
    { value: "bar", label: "Bar graph", icon: BarChart3 },
    { value: "table", label: "Table", icon: Table2 },
  ],
  category: [
    { value: "donut", label: "Donut chart", icon: CircleHelp },
    { value: "bar", label: "Bar graph", icon: BarChart3 },
    { value: "horizontal-bar", label: "Horizontal bar", icon: ChartNoAxesColumn },
    { value: "table", label: "Table", icon: Table2 },
  ],
  any: [
    { value: "line", label: "Line graph", icon: LineChartIcon },
    { value: "area", label: "Area chart", icon: ChartArea },
    { value: "bar", label: "Bar graph", icon: BarChart3 },
    { value: "horizontal-bar", label: "Horizontal bar", icon: ChartNoAxesColumnIncreasing },
    { value: "donut", label: "Donut chart", icon: CircleHelp },
    { value: "table", label: "Table", icon: Table2 },
  ],
};

const tooltipStyle = {
  background: "#111b2b",
  border: "1px solid rgba(148, 163, 184, 0.16)",
  borderRadius: 8,
  fontSize: 11,
};

export function ChartCard({
  title,
  description,
  children,
  emptyMessage = "No data available yet. Connect a data source to populate this chart.",
  kind = "time",
  series,
  categorySeries,
}: ChartCardProps) {
  const choices = options[kind];
  const [chartType, setChartType] = useState<ChartType>(choices[0].value);
  const [open, setOpen] = useState(false);
  const selected = choices.find((type) => type.value === chartType) ?? choices[0];
  const SelectedIcon = selected.icon;
  const hasData = Boolean(
    (series && series.data.length > 0) || (categorySeries && categorySeries.data.length > 0),
  );

  function changeType(value: ChartType) {
    setChartType(value);
    setOpen(false);
  }

  function renderSeriesTable() {
    if (categorySeries) {
      return (
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-wide text-slate-500">
              <th className="pb-3 pr-4 font-medium">Category</th>
              <th className="pb-3 font-medium">{categorySeries.name ?? "Count"}</th>
            </tr>
          </thead>
          <tbody>
            {categorySeries.data.map((point) => (
              <tr key={point.label} className="border-b border-line/60 text-slate-300 last:border-b-0">
                <td className="py-3 pr-4">{point.label}</td>
                <td className="py-3">{point.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      );
    }
    if (!series) return null;
    return (
      <table className="w-full border-collapse text-left text-xs">
        <thead>
          <tr className="border-b border-line text-[10px] uppercase tracking-wide text-slate-500">
            <th className="pb-3 pr-4 font-medium">{series.xAxisKey}</th>
            <th className="pb-3 font-medium">{series.name ?? series.dataKey}</th>
          </tr>
        </thead>
        <tbody>
          {series.data.map((point, index) => (
            <tr key={`${String(point[series.xAxisKey])}-${index}`} className="border-b border-line/60 text-slate-300 last:border-b-0">
              <td className="py-3 pr-4">{point[series.xAxisKey]}</td>
              <td className="py-3">{point[series.dataKey]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  function renderVisualization() {
    if (chartType === "table") {
      return <div className="overflow-x-auto p-5">{renderSeriesTable()}</div>;
    }
    if (categorySeries) {
      if (chartType === "donut") {
        return (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={categorySeries.data} dataKey="value" nameKey="label" innerRadius="58%" outerRadius="78%" paddingAngle={3}>
                {categorySeries.data.map((point, index) => (
                  <Cell key={point.label} fill={palette[index % palette.length]} />
                ))}
              </Pie>
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 10, color: "#94a3b8" }} />
            </PieChart>
          </ResponsiveContainer>
        );
      }
      const horizontal = chartType === "horizontal-bar";
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={categorySeries.data}
            layout={horizontal ? "vertical" : "horizontal"}
            margin={{ top: 8, right: 12, bottom: 2, left: horizontal ? 18 : -16 }}
          >
            <CartesianGrid stroke="rgba(148, 163, 184, 0.1)" vertical={!horizontal} horizontal={horizontal} />
            {horizontal ? (
              <>
                <XAxis type="number" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis dataKey="label" type="category" width={100} axisLine={false} tickLine={false} tick={{ fill: "#94a3b8", fontSize: 10 }} />
              </>
            ) : (
              <>
                <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
              </>
            )}
            <Tooltip contentStyle={tooltipStyle} />
            <Bar dataKey="value" name={categorySeries.name ?? "Count"} fill="#4FD1C5" radius={horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    if (!series) return null;
    const chartProps = { data: series.data, margin: { top: 8, right: 12, bottom: 0, left: -16 } };
    const common = (
      <>
        <CartesianGrid stroke="rgba(148, 163, 184, 0.1)" vertical={false} />
        <XAxis dataKey={series.xAxisKey} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
        <Tooltip contentStyle={tooltipStyle} />
      </>
    );
    if (chartType === "area") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart {...chartProps}>
            {common}
            <Area type="monotone" dataKey={series.dataKey} name={series.name} stroke="#4FD1C5" fill="#4FD1C5" fillOpacity={0.14} />
          </AreaChart>
        </ResponsiveContainer>
      );
    }
    if (chartType === "bar") {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart {...chartProps}>
            {common}
            <Bar dataKey={series.dataKey} name={series.name} fill="#4FD1C5" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      );
    }
    return (
      <ResponsiveContainer width="100%" height="100%">
        <LineChart {...chartProps}>
          {common}
          <Line type="monotone" dataKey={series.dataKey} name={series.name} stroke="#4FD1C5" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    );
  }

  return (
    <section className="panel-card min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
          {description && <p className="mt-1 text-xs text-slate-500">{description}</p>}
        </div>
        <div className="relative">
          <button
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white/[0.025] px-3 py-2 text-xs text-slate-300 hover:border-slate-500"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <SelectedIcon size={14} />
            {selected.label}
            <ChevronDown size={13} className={open ? "rotate-180" : ""} />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-10 mt-1 w-40 rounded-lg border border-line bg-[#111b2b] p-1 shadow-panel" role="listbox" aria-label="Chart type">
              {choices.map(({ value, label, icon: Icon }) => (
                <button
                  key={value}
                  role="option"
                  aria-selected={value === chartType}
                  className={`flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-xs ${
                    value === chartType ? "text-accent" : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                  }`}
                  onClick={() => changeType(value)}
                >
                  <Icon size={14} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="min-h-[230px]">
        {children ? children : hasData ? (
          chartType === "table" ? renderVisualization() : (
            <div className="h-[250px] p-4">{renderVisualization()}</div>
          )
        ) : (
          <div className="flex min-h-[230px] flex-col items-center justify-center px-8 text-center">
            <span className="mb-3 grid size-10 place-items-center rounded-xl border border-line bg-white/[0.025] text-slate-500">
              <SelectedIcon size={18} />
            </span>
            <p className="max-w-xs text-xs leading-5 text-slate-500">{emptyMessage}</p>
          </div>
        )}
      </div>
    </section>
  );
}
