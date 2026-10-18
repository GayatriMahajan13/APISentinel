import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Check, Clipboard, Globe2, Pencil, Plus, RefreshCw, Trash2, X } from "lucide-react";
import {
  createWebsite,
  createWebsiteCredential,
  getWebsites,
  removeWebsite,
  revokeWebsiteCredential,
  rotateWebsiteCredential,
  updateWebsite,
  type WebsiteIntegrationType,
  type WebsiteRecord,
} from "../api";
import { StatusBadge } from "../components/StatusBadge";

interface WebsiteFormData {
  name: string;
  base_url: string;
  description: string;
  integration_type: WebsiteIntegrationType;
}

const EMPTY_FORM: WebsiteFormData = {
  name: "",
  base_url: "",
  description: "",
  integration_type: "fastapi",
};

export function WebsitesPage() {
  const [websites, setWebsites] = useState<WebsiteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<WebsiteRecord | null>(null);
  const [form, setForm] = useState<WebsiteFormData>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [oneTimeCredential, setOneTimeCredential] = useState<{ websiteName: string; value: string } | null>(null);
  const [credentialBusy, setCredentialBusy] = useState<string | null>(null);
  const [credentialCopied, setCredentialCopied] = useState(false);

  const loadWebsites = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const items = await getWebsites(signal);
      setWebsites(items);
      setError(null);
    } catch (cause) {
      if (signal?.aborted) return;
      setError(cause instanceof Error ? cause.message : "Could not load website registrations.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadWebsites(controller.signal);
    return () => controller.abort();
  }, [loadWebsites]);

  function openCreateForm() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
    setError(null);
    setNotice(null);
  }

  function openEditForm(website: WebsiteRecord) {
    setEditing(website);
    setForm({
      name: website.name,
      base_url: website.base_url,
      description: website.description,
      integration_type: website.integration_type,
    });
    setFormOpen(true);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      if (editing) {
        const updated = await updateWebsite(editing.id, form);
        setWebsites((current) => current.map((item) => item.id === updated.id ? updated : item));
        setNotice("Website details updated.");
      } else {
        const created = await createWebsite(form);
        setWebsites((current) => [created, ...current]);
        setNotice("Website registered. It remains Not Connected until a real integration is configured.");
      }
      setFormOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this website.");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(website: WebsiteRecord) {
    if (!window.confirm(`Remove ${website.name} from your website list? Existing records are retained.`)) return;
    setError(null);
    setNotice(null);
    try {
      await removeWebsite(website.id);
      setWebsites((current) => current.filter((item) => item.id !== website.id));
      setNotice("Website removed from your list. Its registration data was retained.");
      if (editing?.id === website.id) setFormOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not remove this website.");
    }
  }

  async function handleCredential(website: WebsiteRecord, operation: "create" | "rotate") {
    setError(null);
    setNotice(null);
    setCredentialBusy(website.id);
    setOneTimeCredential(null);
    try {
      const result = operation === "create"
        ? await createWebsiteCredential(website.id)
        : await rotateWebsiteCredential(website.id);
      setOneTimeCredential({ websiteName: website.name, value: result.credential });
      setCredentialCopied(false);
      setWebsites((current) => current.map((item) => item.id === website.id
        ? { ...item, credential_active: true, connection_status: "Not Connected", last_event_at: null }
        : item));
      setNotice(operation === "create"
        ? "Integration credential created. Copy it now; it will not be shown again."
        : "Credential rotated. The previous credential has been revoked; copy the new one now.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the integration credential.");
    } finally {
      setCredentialBusy(null);
    }
  }

  async function handleRevoke(website: WebsiteRecord) {
    if (!window.confirm(`Revoke the monitoring credential for ${website.name}? Its collector will stop being accepted.`)) return;
    setError(null);
    setNotice(null);
    setCredentialBusy(website.id);
    setOneTimeCredential(null);
    try {
      await revokeWebsiteCredential(website.id);
      setWebsites((current) => current.map((item) => item.id === website.id
        ? { ...item, credential_active: false, connection_status: "Disconnected" }
        : item));
      setNotice("Integration credential revoked.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not revoke the integration credential.");
    } finally {
      setCredentialBusy(null);
    }
  }

  async function copyCredential() {
    if (!oneTimeCredential) return;
    try {
      await navigator.clipboard.writeText(oneTimeCredential.value);
      setCredentialCopied(true);
    } catch {
      setError("Clipboard access failed. Select and copy the credential manually; it will only be shown until dismissed.");
    }
  }

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
        <div>
          <div className="mb-3 flex items-center gap-2"><span className="eyebrow">Monitoring setup</span><StatusBadge>WEBSITE MANAGEMENT</StatusBadge></div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary md:text-[30px]">Your websites and APIs</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
            Register services you own or are authorized to monitor. Registration does not verify ownership,
            connect an integration, or send requests to the URL.
          </p>
        </div>
        <button type="button" className="button-primary shrink-0" onClick={openCreateForm}><Plus size={15} />Add website</button>
      </section>

      {error && (
        <div role="alert" className="panel-card flex items-start justify-between gap-3 p-4 text-xs text-rose-200">
          <span className="flex items-start gap-2"><AlertCircle className="mt-0.5 shrink-0" size={15} />{error}</span>
          <button className="button-secondary min-h-8" type="button" onClick={() => void loadWebsites()}><RefreshCw size={13} />Retry</button>
        </div>
      )}
      {notice && <p role="status" className="rounded-lg border border-accent/20 bg-accent/[0.05] px-4 py-3 text-xs text-accent">{notice}</p>}

      {oneTimeCredential && (
        <section className="panel-card border border-amber-400/25 p-5" aria-label="One-time integration credential">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-100">Save this credential now</h2>
              <p className="mt-1 text-xs leading-5 text-slate-400">Credential for {oneTimeCredential.websiteName}. It is shown once and is not recoverable. Keep it only in the monitored backend’s environment, never in browser code, Git, or logs.</p>
            </div>
            <button type="button" className="icon-button" aria-label="Dismiss one-time credential" onClick={() => setOneTimeCredential(null)}><X size={15} /></button>
          </div>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <code className="min-w-0 flex-1 break-all rounded-lg border border-line bg-black/20 px-3 py-2.5 font-mono text-xs text-amber-100">{oneTimeCredential.value}</code>
            <button type="button" className="button-secondary shrink-0" onClick={() => void copyCredential()}>{credentialCopied ? <Check size={14} /> : <Clipboard size={14} />}{credentialCopied ? "Copied" : "Copy credential"}</button>
          </div>
          <button type="button" className="button-primary mt-3" onClick={() => setOneTimeCredential(null)}>I’ve saved it — hide credential</button>
        </section>
      )}

      {formOpen && (
        <section className="panel-card p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div><h2 className="text-sm font-semibold text-text-primary">{editing ? "Edit website" : "Add a website"}</h2><p className="mt-1 text-xs text-slate-500">Connection status is set by verified integrations, never by this form.</p></div>
            <button type="button" className="icon-button" aria-label="Close website form" onClick={() => setFormOpen(false)}><X size={16} /></button>
          </div>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <label className="field-label">Display name
              <input className="form-control mt-2" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} maxLength={120} placeholder="My E-commerce Website" required />
            </label>
            <label className="field-label">Base URL
              <input className="form-control mt-2 font-mono text-xs" type="url" value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} maxLength={2048} placeholder="https://api.example.com" required />
              <span className="mt-1.5 block text-[10px] text-slate-600">HTTP(S) only. No username, password, query, or fragment. APISentinel will not fetch this URL.</span>
            </label>
            <label className="field-label">Integration type
              <select className="form-control mt-2" value={form.integration_type} onChange={(event) => setForm({ ...form, integration_type: event.target.value as WebsiteIntegrationType })}>
                <option value="fastapi">FastAPI middleware (planned)</option>
                <option value="express">Express middleware (planned)</option>
                <option value="manual">Other / not configured</option>
              </select>
            </label>
            <label className="field-label md:row-span-2">Description <span className="font-normal text-slate-600">(optional)</span>
              <textarea className="form-control mt-2 min-h-28 resize-y" value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} maxLength={2000} placeholder="What does this API provide?" />
            </label>
            <div className="flex items-center gap-2 md:col-span-2">
              <button className="button-primary" type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Register website"}</button>
              <button className="button-secondary" type="button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button>
            </div>
          </form>
        </section>
      )}

      {loading && !websites.length ? (
        <div className="panel-card flex min-h-48 items-center justify-center text-xs text-slate-500">Loading your website registrations…</div>
      ) : !websites.length ? (
        <div className="panel-card flex min-h-64 flex-col items-center justify-center px-6 text-center">
          <span className="grid size-11 place-items-center rounded-xl border border-line bg-white/[0.025] text-slate-500"><Globe2 size={19} /></span>
          <h2 className="mt-4 text-sm font-semibold text-text-primary">No websites registered</h2>
          <p className="mt-2 max-w-md text-xs leading-5 text-slate-500">Add an API you own or are authorized to monitor. New registrations are Not Connected until a genuine integration is configured and verified.</p>
          <button type="button" className="button-primary mt-4" onClick={openCreateForm}><Plus size={14} />Add website</button>
        </div>
      ) : (
        <section className="space-y-3" aria-label="Your registered websites">
          {websites.map((website) => (
            <article key={website.id} className="panel-card flex flex-col gap-4 p-4 md:flex-row md:items-center md:justify-between">
              <div className="flex min-w-0 items-start gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-lg border border-line bg-white/[0.02] text-slate-400"><Globe2 size={16} /></span>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><h2 className="truncate text-sm font-semibold text-text-primary">{website.name}</h2><StatusBadge>{website.connection_status.toUpperCase()}</StatusBadge></div>
                  <p className="mt-1 truncate font-mono text-xs text-slate-400">{website.base_url}</p>
                  {website.description && <p className="mt-1 truncate text-xs text-slate-500">{website.description}</p>}
                  <p className="mt-2 text-[10px] text-slate-600">Integration: {website.integration_type} · Registered {new Date(website.created_at).toLocaleDateString()}</p>
                  {website.last_event_at && <p className="mt-1 text-[10px] text-slate-500">Last authenticated event: {new Date(website.last_event_at).toLocaleString()}</p>}
                </div>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="button-secondary min-h-9"
                  type="button"
                  disabled={credentialBusy === website.id}
                  onClick={() => void handleCredential(website, website.credential_active ? "rotate" : "create")}
                  title={website.credential_active ? "Rotate the active server credential" : "Create a server credential"}
                >
                  {credentialBusy === website.id ? "Working…" : website.credential_active ? "Rotate key" : "Create key"}
                </button>
                {website.credential_active && <button className="button-secondary min-h-9" type="button" disabled={credentialBusy === website.id} onClick={() => void handleRevoke(website)}>Revoke key</button>}
                <button className="button-secondary min-h-9" type="button" onClick={() => openEditForm(website)}><Pencil size={13} />Edit</button>
                <button className="button-secondary min-h-9 text-rose-300 hover:border-rose-400/30" type="button" onClick={() => void handleRemove(website)}><Trash2 size={13} />Remove</button>
              </div>
            </article>
          ))}
        </section>
      )}
      <section className="panel-card p-5">
        <h2 className="text-sm font-semibold text-text-primary">Server-side integration setup</h2>
        <p className="mt-2 text-xs leading-5 text-slate-400">Create a credential for a website you control, then configure your backend to send approved event metadata directly to APISentinel. Never send this credential from a browser or include raw request bodies, cookies, authorization data, passwords, payment details, or personal information.</p>
        <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-xs leading-5 text-slate-500">
          <li>Store the one-time credential as <code className="text-slate-300">APISENTINEL_INTEGRATION_KEY</code> in the monitored server’s secret environment.</li>
          <li>From that server only, send <code className="text-slate-300">POST /monitoring/events</code> with the credential in <code className="text-slate-300">X-APISentinel-Integration-Key</code>.</li>
          <li>Use a normalized route template such as <code className="text-slate-300">/api/orders/{"{order_id}"}</code>, without query strings or personal identifiers.</li>
          <li>Include schema version, timezone-aware event timestamp, method, endpoint, response status, duration, and request size. Optional features must use recognized non-negative numeric fields; actor IDs must be pseudonymous.</li>
        </ol>
        <pre className="mt-3 overflow-x-auto rounded-lg border border-line bg-black/20 p-3 text-[11px] leading-5 text-slate-300">{`POST /monitoring/events
Content-Type: application/json
X-APISentinel-Integration-Key: $APISENTINEL_INTEGRATION_KEY

{
  "schema_version": "1",
  "event_timestamp": "2026-10-17T00:00:00Z",
  "method": "GET",
  "endpoint": "/api/orders/{order_id}",
  "response_status": 200,
  "request_duration_ms": 18.4,
  "request_size_bytes": 0,
  "actor_id": "pseudonymous-session-id"
}`}</pre>
        <p className="mt-3 text-[11px] leading-5 text-slate-600">Valid events may be scored when all required features are present. The Live Monitoring page lists persisted event metadata and does not capture external traffic automatically. Connection changes to Receiving Events only after a valid credential-authenticated event is persisted. Use HTTPS outside local development.</p>
      </section>
      <p className="text-[11px] leading-5 text-slate-600">Connection status reflects verified authenticated ingestion activity. Adding a URL or creating a key alone does not establish a monitoring connection.</p>
    </div>
  );
}
