import { LoaderCircle } from "lucide-react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export function AuthGuard() {
  const { user, loading, error, refreshSession } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas text-slate-400">
        <span className="flex items-center gap-2 text-sm"><LoaderCircle className="animate-spin" size={17} />Restoring your session…</span>
      </main>
    );
  }
  if (error) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-5 text-center">
        <div className="max-w-md">
          <h1 className="text-lg font-semibold text-text-primary">Unable to restore your session</h1>
          <p className="mt-2 text-sm text-slate-400">{error}</p>
          <button className="button-primary mt-5" type="button" onClick={() => void refreshSession()}>Try again</button>
        </div>
      </main>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}
