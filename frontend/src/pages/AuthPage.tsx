import { useEffect, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeOff,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { StatusBadge } from "../components/StatusBadge";
import { useAuth } from "../context/AuthContext";

type AuthMode = "login" | "register" | "forgot" | "reset";

interface AuthPageProps {
  mode: AuthMode;
}

export function AuthPage({ mode }: AuthPageProps) {
  const { user, login, register, loading: sessionLoading, error: sessionError, refreshSession } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isRegister = mode === "register";
  const isLogin = mode === "login";
  const needsPassword = isLogin || isRegister || mode === "reset";
  const title = {
    login: "Welcome back",
    register: "Create your account",
    forgot: "Reset your password",
    reset: "Choose a new password",
  }[mode];
  const passwordRules = [
    { label: "At least 12 characters", valid: password.length >= 12 },
    { label: "No more than 128 characters", valid: password.length <= 128 },
    { label: "Confirmation matches", valid: confirmation.length > 0 && confirmation === password },
  ];
  const destination =
    location.state && typeof location.state === "object" && "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  useEffect(() => {
    if (user && (isLogin || isRegister)) navigate(destination, { replace: true });
  }, [user, isLogin, isRegister, destination, navigate]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!isLogin && !isRegister) return;
    if (isRegister && password !== confirmation) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    try {
      if (isLogin) await login(email, password);
      else await register({ full_name: fullName, email, password, confirm_password: confirmation });
      navigate(destination, { replace: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen bg-canvas lg:grid-cols-[minmax(0,1fr)_minmax(420px,0.85fr)]">
      <section className="relative hidden flex-col justify-between overflow-hidden border-r border-line bg-sidebar p-10 lg:flex xl:p-14">
        <Link to="/" className="inline-flex w-fit items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl border border-accent/20 bg-accent/10 text-accent">
            <ShieldCheck size={21} />
          </span>
          <span className="text-sm font-semibold text-text-primary">APISentinel</span>
        </Link>
        <div className="relative z-10 max-w-lg">
          <span className="eyebrow">API security workspace</span>
          <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight text-text-primary xl:text-5xl">
            See the signals behind every request.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
            Sign in to access your private prediction history, alerts, and security analytics.
          </p>
        </div>
        <p className="text-xs text-slate-600">APISentinel · College project foundation</p>
        <div className="pointer-events-none absolute -bottom-28 -right-24 size-[420px] rounded-full border border-accent/[0.06]" />
        <div className="pointer-events-none absolute -bottom-16 -right-12 size-[300px] rounded-full border border-accent/[0.08]" />
      </section>

      <section className="flex min-h-screen items-center justify-center px-5 py-10">
        <div className="w-full max-w-[390px]">
          <Link to="/" className="mb-9 inline-flex items-center gap-2 text-xs text-slate-500 hover:text-text-primary">
            <ArrowLeft size={14} /> Back to workspace
          </Link>
          <div className="mb-6">
            <div className="mb-4 flex items-center gap-2 lg:hidden">
              <span className="grid size-9 place-items-center rounded-lg border border-accent/20 bg-accent/10 text-accent"><ShieldCheck size={18} /></span>
              <span className="text-sm font-semibold text-text-primary">APISentinel</span>
            </div>
            <StatusBadge tone="ready">{isRegister || isLogin ? "SERVER-MANAGED SECURE SESSION" : "ACCOUNT RECOVERY UNAVAILABLE"}</StatusBadge>
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-text-primary">{title}</h2>
            <p className="mt-2 text-sm text-slate-400">
              {isLogin ? "Sign in to your APISentinel account." : isRegister ? "Create an account to get started." : "Password recovery is not available yet."}
            </p>
          </div>

          <form className="space-y-4" onSubmit={handleSubmit}>
            {isRegister && <label className="field-label">Full name<span className="field-wrap"><UserRound size={16} /><input type="text" placeholder="Your name" autoComplete="name" maxLength={120} required value={fullName} onChange={(event) => setFullName(event.target.value)} /></span></label>}
            {(isLogin || isRegister || mode === "forgot") && <label className="field-label">Email address<span className="field-wrap"><Mail size={16} /><input type="email" placeholder="you@example.com" autoComplete="email" maxLength={254} required={isLogin || isRegister} value={email} onChange={(event) => setEmail(event.target.value)} /></span></label>}
            {needsPassword && (
              <>
                <label className="field-label">
                  {mode === "reset" ? "New password" : "Password"}
                  <span className="field-wrap">
                    <LockKeyhole size={16} />
                    <input
                      type={showPassword ? "text" : "password"}
                      placeholder={isLogin ? "Your password" : "12–128 characters"}
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      minLength={isLogin ? undefined : 12}
                      maxLength={128}
                      required={isLogin || isRegister}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                    />
                    <button type="button" onClick={() => setShowPassword((visible) => !visible)} className="text-slate-500 hover:text-slate-200" aria-label={showPassword ? "Hide password" : "Show password"}>
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </span>
                </label>
                {(isRegister || mode === "reset") && (
                  <>
                    <label className="field-label">Confirm password<span className="field-wrap"><LockKeyhole size={16} /><input type={showPassword ? "text" : "password"} placeholder="Re-enter password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></span></label>
                    <div className="space-y-1 rounded-lg border border-line bg-white/[0.02] p-3">
                      <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-slate-500">Password guidance</p>
                      {passwordRules.map((rule) => <p key={rule.label} className={`flex items-center gap-2 text-[10px] ${rule.valid ? "text-emerald-300" : "text-slate-500"}`}>{rule.valid ? <Check size={12} /> : <X size={12} />}{rule.label}</p>)}
                      <p className="pt-1 text-[10px] text-slate-600">Use a unique password; it is stored as a salted scrypt hash.</p>
                    </div>
                  </>
                )}
              </>
            )}
            {isLogin && <div className="flex justify-end text-xs"><Link className="text-accent hover:text-[#7be1d7]" to="/forgot-password">Forgot password?</Link></div>}
            {(error || sessionError) && <p role="alert" className="rounded-lg border border-rose-400/20 bg-rose-400/[0.05] px-3 py-2.5 text-xs leading-5 text-rose-200">{error ?? sessionError}</p>}
            {sessionError && <button className="text-xs text-accent hover:underline" type="button" onClick={() => void refreshSession()}>Retry secure session setup</button>}
            {(isLogin || isRegister) ? (
              <button className="button-primary w-full justify-center" type="submit" disabled={submitting || sessionLoading || Boolean(sessionError)}>
                {sessionLoading ? "Preparing secure session…" : submitting ? "Please wait…" : isLogin ? "Sign in" : "Create account"}
                <ArrowRight size={15} />
              </button>
            ) : (
              <button className="button-primary w-full justify-center opacity-60" type="button" disabled>
                Password recovery unavailable <ArrowRight size={15} />
              </button>
            )}
          </form>
          <p className="mt-6 text-center text-xs text-slate-500">
            {isLogin ? "Need an account?" : isRegister ? "Already registered?" : "Back to sign in?"}{" "}
            <Link className="font-medium text-accent hover:text-[#7be1d7]" to={isLogin ? "/register" : "/login"}>
              {isLogin ? "Create account" : "Sign in"}
            </Link>
          </p>
          <p className="mt-8 rounded-lg border border-line bg-white/[0.02] px-3 py-2.5 text-center text-[11px] leading-5 text-slate-600">
            Authentication uses server-managed HttpOnly sessions. CSRF protection is enabled; session tokens are not stored in browser storage.
          </p>
        </div>
      </section>
    </main>
  );
}
