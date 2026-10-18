import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { NavLink } from "react-router-dom";
import { sections } from "../sections";
import { Brand } from "./Brand";

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onToggleCollapse: () => void;
  onCloseMobile: () => void;
}

const groups = ["Monitoring", "Detection", "Investigation", "Reporting & System"] as const;

export function Sidebar({
  collapsed,
  mobileOpen,
  onToggleCollapse,
  onCloseMobile,
}: SidebarProps) {
  return (
    <>
      {mobileOpen && (
        <button
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-label="Close navigation"
          onClick={onCloseMobile}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-[264px] flex-col border-r border-line bg-sidebar transition-[width,transform] duration-200 md:translate-x-0 ${
          collapsed ? "md:w-[78px]" : ""
        } ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="flex h-[76px] items-center justify-between border-b border-line px-4">
          <Brand compact={collapsed} />
          <button
            className="icon-button md:hidden"
            onClick={onCloseMobile}
            aria-label="Close sidebar"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="scrollbar-thin flex-1 space-y-6 overflow-y-auto px-3 py-5">
          {groups.map((group) => {
            const items = sections.filter((section) => section.group === group);
            return (
              <section key={group} aria-label={group}>
                {!collapsed && (
                  <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                    {group}
                  </h2>
                )}
                <div className="space-y-1">
                  {items.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.path}
                        to={item.path}
                        end={item.path === "/"}
                        title={collapsed ? item.label : undefined}
                        onClick={onCloseMobile}
                        className={({ isActive }) =>
                          `group flex min-h-10 items-center gap-3 rounded-lg px-3 text-[13px] transition-colors ${
                            isActive
                              ? "bg-accent/10 font-medium text-accent"
                              : "text-slate-400 hover:bg-white/[0.04] hover:text-text-primary"
                          } ${collapsed ? "justify-center px-0" : ""}`
                        }
                      >
                        <Icon size={17} strokeWidth={1.8} className="shrink-0" />
                        {!collapsed && (
                          <>
                            <span className="min-w-0 flex-1 truncate">{item.label}</span>
                            {item.status === "planned" && (
                              <span
                                className="size-1.5 shrink-0 rounded-full bg-slate-600"
                                aria-label="Planned"
                                title="Planned"
                              />
                            )}
                          </>
                        )}
                      </NavLink>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </nav>

        <div className="border-t border-line p-3">
          <button
            className={`hidden min-h-10 w-full items-center gap-3 rounded-lg px-3 text-xs text-slate-500 hover:bg-white/[0.04] hover:text-text-primary md:flex ${
              collapsed ? "justify-center px-0" : ""
            }`}
            onClick={onToggleCollapse}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            {!collapsed && <span>Collapse navigation</span>}
          </button>
          {!collapsed && (
            <p className="px-3 pt-2 text-[10px] text-slate-600">APISentinel · Foundation 0.1</p>
          )}
        </div>
      </aside>
    </>
  );
}
