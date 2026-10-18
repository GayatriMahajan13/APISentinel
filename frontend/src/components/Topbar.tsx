import { Bell, LogOut, Menu, Search } from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { sections } from "../sections";
import { useAuth } from "../context/AuthContext";

interface TopbarProps {
  onOpenMobile: () => void;
}

export function Topbar({ onOpenMobile }: TopbarProps) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { user, logout } = useAuth();
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const current = sections.find((section) => section.path === pathname);

  async function handleLogout() {
    setLogoutError(null);
    setLoggingOut(true);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (cause) {
      setLogoutError(cause instanceof Error ? cause.message : "Could not sign out.");
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center justify-between border-b border-line bg-canvas/95 px-4 backdrop-blur-sm md:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button className="icon-button md:hidden" onClick={onOpenMobile} aria-label="Open navigation">
          <Menu size={19} />
        </button>
        <div className="min-w-0">
          <div className="hidden items-center gap-2 text-[11px] text-slate-500 sm:flex">
            <span>Workspace</span>
            <span aria-hidden="true">/</span>
            <span className="truncate text-slate-300">{current?.label ?? "Security workspace"}</span>
          </div>
          <p className="truncate text-sm font-medium text-text-primary sm:hidden">
            {current?.label ?? "Security workspace"}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 sm:gap-3">
        <div className="hidden items-center gap-2 rounded-lg border border-line bg-white/[0.025] px-3 py-2 text-xs text-slate-500 lg:flex">
          <Search size={14} />
          <span>Search workspace</span>
          <kbd className="ml-5 rounded border border-line px-1.5 py-0.5 text-[10px]">⌘ K</kbd>
        </div>
        <button className="icon-button" aria-label="Notifications (not configured)" title="Notifications are not configured">
          <Bell size={17} />
          <span className="sr-only">No notifications configured</span>
        </button>
        <span className="mx-1 hidden h-7 border-l border-line sm:block" />
        <span className="hidden max-w-36 truncate text-xs text-slate-400 sm:inline" title={user?.email}>
          {user?.full_name}
        </span>
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-50"
        >
          <LogOut size={14} />{loggingOut ? "Signing out…" : "Sign out"}
        </button>
      </div>
      {logoutError && (
        <span role="alert" className="absolute right-4 top-[68px] rounded-md border border-rose-400/30 bg-canvas px-3 py-2 text-xs text-rose-200 shadow-lg md:right-8">
          {logoutError}
        </span>
      )}
    </header>
  );
}
