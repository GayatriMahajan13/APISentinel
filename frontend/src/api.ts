const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim();
const localHost =
  typeof window !== "undefined" &&
  (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1")
    ? window.location.hostname
    : "127.0.0.1";

export const API_BASE_URL = (configuredBaseUrl || `http://${localHost}:8000`).replace(
  /\/+$/,
  "",
);

export const API_ENDPOINTS = {
  health: `${API_BASE_URL}/health`,
  modelInfo: `${API_BASE_URL}/model-info`,
  predict: `${API_BASE_URL}/predict`,
  predictFeatures: `${API_BASE_URL}/predict-features`,
  history: `${API_BASE_URL}/history`,
  alerts: `${API_BASE_URL}/alerts`,
  analyticsSummary: `${API_BASE_URL}/analytics/summary`,
  authSession: `${API_BASE_URL}/auth/session`,
  authRegister: `${API_BASE_URL}/auth/register`,
  authLogin: `${API_BASE_URL}/auth/login`,
  authLogout: `${API_BASE_URL}/auth/logout`,
  websites: `${API_BASE_URL}/websites`,
  monitoringEvents: `${API_BASE_URL}/monitoring/events`,
} as const;

let csrfToken: string | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  const method = (init.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && csrfToken) {
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(input, {
    ...init,
    headers,
    credentials: "include",
  });
  const requestUrl = input instanceof Request ? input.url : String(input);
  if (response.status === 401 && !new URL(requestUrl, window.location.href).pathname.startsWith("/auth/")) {
    window.dispatchEvent(new Event("apisentinel:unauthorized"));
  }
  return response;
}

export interface AuthUser {
  id: string;
  full_name: string;
  email: string;
}

export interface AuthSessionResponse {
  user: AuthUser | null;
  csrf_token: string;
}

export type WebsiteIntegrationType = "fastapi" | "express" | "manual";
export type WebsiteConnectionStatus =
  | "Not Connected"
  | "Connected"
  | "Receiving Events"
  | "Disconnected"
  | "Error";

export interface WebsiteRecord {
  id: string;
  name: string;
  base_url: string;
  description: string;
  integration_type: WebsiteIntegrationType;
  connection_status: WebsiteConnectionStatus;
  credential_active: boolean;
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface IntegrationCredentialResponse {
  credential: string;
  created_at: string;
}

function isAuthSessionResponse(value: unknown): value is AuthSessionResponse {
  if (
    !value ||
    typeof value !== "object" ||
    !("csrf_token" in value) ||
    typeof value.csrf_token !== "string" ||
    !("user" in value)
  ) {
    return false;
  }
  const user = value.user;
  return user === null || (
    typeof user === "object" &&
    "id" in user &&
    typeof user.id === "string" &&
    "full_name" in user &&
    typeof user.full_name === "string" &&
    "email" in user &&
    typeof user.email === "string"
  );
}

export interface RequestScan {
  method?: string;
  url: string;
  payload?: string;
}

export interface FeatureScan {
  payload_len: number;
  url_len: number;
  param_count: number;
  special_char_count: number;
  digit_count: number;
  encoded_char_count: number;
  path_depth: number;
  payload_entropy: number;
}

export interface PredictionResult {
  prediction: string;
  class_id: number;
  confidence: number;
  probabilities: Record<string, number>;
  features: Record<string, number>;
  method?: string;
  url?: string;
}

export interface HealthResponse {
  status: string;
  model?: string;
  features: string[];
}

export type ModelInfo = Record<string, string | number | boolean | string[] | null>;

export interface PredictionRecordResponse {
  id: string;
  timestamp: string;
  method: string;
  url: string;
  prediction: string;
  class_id: number;
  confidence: number;
  normal_score: number | null;
  anomalous_score: number | null;
  features: Record<string, number>;
}

export interface HistoryResponse {
  items: PredictionRecordResponse[];
  total: number;
  limit: number;
  offset: number;
}

export type ReviewStatus = "New" | "Under Review" | "Resolved" | "False Positive";

export interface AlertResponse {
  id: string;
  prediction_id: string;
  created_at: string;
  updated_at: string;
  review_status: ReviewStatus;
  analyst_notes: string;
  prediction: PredictionRecordResponse;
}

export interface AlertsResponse {
  items: AlertResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface AnalyticsSummary {
  total_requests: number;
  normal_requests: number;
  anomalous_requests: number;
  anomaly_rate: number;
  total_alerts: number;
}

export interface MonitoringEventItem {
  id: string;
  event_id: string | null;
  website_id: string;
  website_name: string;
  received_at: string;
  event_timestamp: string;
  method: string;
  endpoint: string;
  response_status: number;
  request_duration_ms: number;
  request_size_bytes: number;
  scoring_status: string;
  prediction_label: string | null;
  model_score: number | null;
  model_identifier: string | null;
}

export interface MonitoringEventListResponse {
  items: MonitoringEventItem[];
  total: number;
  limit: number;
  offset: number;
}

async function readJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    let detail = `Request failed with status ${response.status}.`;
    if (body && typeof body === "object" && "detail" in body) {
      const value = body.detail;
      detail = typeof value === "string"
        ? value
        : Array.isArray(value) && value[0] && typeof value[0] === "object" && "msg" in value[0]
          ? String(value[0].msg)
          : detail;
    }
    throw new Error(detail);
  }
  return body;
}

export async function getHealth(signal?: AbortSignal) {
  const value = await readJson(
    await apiFetch(API_ENDPOINTS.health, { signal, headers: { Accept: "application/json" } }),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    typeof value.status !== "string" ||
    !("features" in value) ||
    !Array.isArray(value.features) ||
    !value.features.every((feature) => typeof feature === "string")
  ) {
    throw new Error("Backend returned an unexpected health response.");
  }
  return value as HealthResponse;
}

export async function getModelInfo(signal?: AbortSignal) {
  const value = await readJson(
    await apiFetch(API_ENDPOINTS.modelInfo, { signal, headers: { Accept: "application/json" } }),
  );
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Backend returned unexpected model information.");
  }
  return value as ModelInfo;
}

export async function getHistory(
  options: { limit?: number; offset?: number; classification?: "normal" | "anomalous" },
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.classification) query.set("classification", options.classification);
  const value = await readJson(
    await apiFetch(`${API_ENDPOINTS.history}?${query.toString()}`, {
      signal,
      headers: { Accept: "application/json" },
    }),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    !("total" in value) ||
    typeof value.total !== "number" ||
    !("limit" in value) ||
    typeof value.limit !== "number" ||
    !("offset" in value) ||
    typeof value.offset !== "number"
  ) {
    throw new Error("Backend returned an unexpected history response.");
  }
  return value as HistoryResponse;
}

export async function getAlerts(
  options: { limit?: number; offset?: number } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  const value = await readJson(
    await apiFetch(`${API_ENDPOINTS.alerts}?${query.toString()}`, {
      signal,
      headers: { Accept: "application/json" },
    }),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    !("total" in value) ||
    typeof value.total !== "number"
  ) {
    throw new Error("Backend returned an unexpected alerts response.");
  }
  return value as AlertsResponse;
}

export async function getAnalyticsSummary(signal?: AbortSignal) {
  const value = await readJson(
    await apiFetch(API_ENDPOINTS.analyticsSummary, {
      signal,
      headers: { Accept: "application/json" },
    }),
  );
  if (
    !value ||
    typeof value !== "object" ||
    !("total_requests" in value) ||
    typeof value.total_requests !== "number" ||
    !("normal_requests" in value) ||
    typeof value.normal_requests !== "number" ||
    !("anomalous_requests" in value) ||
    typeof value.anomalous_requests !== "number" ||
    !("anomaly_rate" in value) ||
    typeof value.anomaly_rate !== "number" ||
    !("total_alerts" in value) ||
    typeof value.total_alerts !== "number"
  ) {
    throw new Error("Backend returned an unexpected analytics summary.");
  }
  return value as AnalyticsSummary;
}

export async function patchAlert(
  alertId: string,
  updates: { review_status?: ReviewStatus; analyst_notes?: string },
  signal?: AbortSignal,
) {
  const value = await readJson(
    await apiFetch(`${API_ENDPOINTS.alerts}/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(updates),
    }),
  );
  if (!value || typeof value !== "object" || !("prediction" in value) || !("prediction_id" in value)) {
    throw new Error("Backend returned an unexpected alert response.");
  }
  return value as AlertResponse;
}

export async function predictRequest(request: Required<RequestScan>, signal?: AbortSignal) {
  const value = await readJson(
    await apiFetch(API_ENDPOINTS.predict, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(request),
    }),
  );
  if (!isPredictionResult(value)) {
    throw new Error("Backend returned an unexpected prediction response.");
  }
  return value;
}

let pendingAuthSession: Promise<AuthSessionResponse> | null = null;

export async function getAuthSession(signal?: AbortSignal): Promise<AuthSessionResponse> {
  if (pendingAuthSession) return pendingAuthSession;
  const request = (async () => {
    const value = await readJson(
      await apiFetch(API_ENDPOINTS.authSession, {
        signal,
        headers: { Accept: "application/json" },
      }),
    );
    if (!isAuthSessionResponse(value)) {
      throw new Error("Backend returned an unexpected authentication session.");
    }
    setCsrfToken(value.csrf_token);
    return value;
  })();
  pendingAuthSession = request;
  try {
    return await request;
  } finally {
    if (pendingAuthSession === request) pendingAuthSession = null;
  }
}

async function authMutation(
  endpoint: string,
  body?: Record<string, string>,
): Promise<AuthSessionResponse | { ok: boolean }> {
  const value = await readJson(
    await apiFetch(endpoint, {
      method: "POST",
      headers: body
        ? { "Content-Type": "application/json", Accept: "application/json" }
        : { Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
  const session = isAuthSessionResponse(value) ? value : null;
  if (session) {
    setCsrfToken(session.csrf_token);
    return session;
  }
  if (value && typeof value === "object" && "ok" in value && value.ok === true) {
    return { ok: true };
  }
  throw new Error("Backend returned an unexpected authentication response.");
}

export function registerAccount(data: {
  full_name: string;
  email: string;
  password: string;
  confirm_password: string;
}) {
  return authMutation(API_ENDPOINTS.authRegister, data).then((value) => {
    if (!("csrf_token" in value)) throw new Error("Backend returned an unexpected registration response.");
    return value;
  });
}

export function loginAccount(data: { email: string; password: string }) {
  return authMutation(API_ENDPOINTS.authLogin, data).then((value) => {
    if (!("csrf_token" in value)) throw new Error("Backend returned an unexpected login response.");
    return value;
  });
}

export function logoutAccount() {
  return authMutation(API_ENDPOINTS.authLogout).then((value) => {
    if (!("ok" in value)) throw new Error("Backend returned an unexpected logout response.");
    return value;
  });
}

function isWebsiteRecord(value: unknown): value is WebsiteRecord {
  if (!value || typeof value !== "object") return false;
  return (
    "id" in value && typeof value.id === "string" &&
    "name" in value && typeof value.name === "string" &&
    "base_url" in value && typeof value.base_url === "string" &&
    "description" in value && typeof value.description === "string" &&
    "integration_type" in value && ["fastapi", "express", "manual"].includes(String(value.integration_type)) &&
    "connection_status" in value &&
    ["Not Connected", "Connected", "Receiving Events", "Disconnected", "Error"].includes(String(value.connection_status)) &&
    "credential_active" in value && typeof value.credential_active === "boolean" &&
    "last_event_at" in value && (value.last_event_at === null || typeof value.last_event_at === "string") &&
    "created_at" in value && typeof value.created_at === "string" &&
    "updated_at" in value && typeof value.updated_at === "string"
  );
}

export async function getWebsites(signal?: AbortSignal): Promise<WebsiteRecord[]> {
  const value = await readJson(await apiFetch(API_ENDPOINTS.websites, {
    signal,
    headers: { Accept: "application/json" },
  }));
  if (!Array.isArray(value) || !value.every(isWebsiteRecord)) {
    throw new Error("Backend returned an unexpected websites response.");
  }
  return value;
}

function isMonitoringEventItem(value: unknown): value is MonitoringEventItem {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return (
    "id" in value && typeof value.id === "string" &&
    "event_id" in value && (value.event_id === null || typeof value.event_id === "string") &&
    "website_id" in value && typeof value.website_id === "string" &&
    "website_name" in value && typeof value.website_name === "string" &&
    "received_at" in value && typeof value.received_at === "string" &&
    "event_timestamp" in value && typeof value.event_timestamp === "string" &&
    "method" in value && typeof value.method === "string" &&
    "endpoint" in value && typeof value.endpoint === "string" &&
    "response_status" in value && typeof value.response_status === "number" &&
    "request_duration_ms" in value && typeof value.request_duration_ms === "number" &&
    "request_size_bytes" in value && typeof value.request_size_bytes === "number" &&
    "scoring_status" in value && typeof value.scoring_status === "string" &&
    "prediction_label" in value && (value.prediction_label === null || typeof value.prediction_label === "string") &&
    "model_score" in value &&
    (value.model_score === null || (typeof value.model_score === "number" && Number.isFinite(value.model_score))) &&
    "model_identifier" in value &&
    (value.model_identifier === null || typeof value.model_identifier === "string")
  );
}

export async function getMonitoringEvents(
  options: { limit?: number; offset?: number; websiteId?: string } = {},
  signal?: AbortSignal,
): Promise<MonitoringEventListResponse> {
  const query = new URLSearchParams();
  if (options.limit !== undefined) query.set("limit", String(options.limit));
  if (options.offset !== undefined) query.set("offset", String(options.offset));
  if (options.websiteId) query.set("website_id", options.websiteId);
  const value = await readJson(await apiFetch(
    `${API_ENDPOINTS.monitoringEvents}?${query.toString()}`,
    { signal, headers: { Accept: "application/json" } },
  ));
  if (
    !value ||
    typeof value !== "object" ||
    !("items" in value) ||
    !Array.isArray(value.items) ||
    !value.items.every(isMonitoringEventItem) ||
    !("total" in value) ||
    typeof value.total !== "number" ||
    !("limit" in value) ||
    typeof value.limit !== "number" ||
    !("offset" in value) ||
    typeof value.offset !== "number"
  ) {
    throw new Error("Backend returned an unexpected monitoring events response.");
  }
  return value as MonitoringEventListResponse;
}

export async function createWebsite(data: {
  name: string;
  base_url: string;
  description: string;
  integration_type: WebsiteIntegrationType;
}, signal?: AbortSignal): Promise<WebsiteRecord> {
  const value = await readJson(await apiFetch(API_ENDPOINTS.websites, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  }));
  if (!isWebsiteRecord(value)) throw new Error("Backend returned an unexpected website response.");
  return value;
}

export async function updateWebsite(
  websiteId: string,
  data: Partial<Pick<WebsiteRecord, "name" | "base_url" | "description" | "integration_type">>,
  signal?: AbortSignal,
): Promise<WebsiteRecord> {
  const value = await readJson(await apiFetch(`${API_ENDPOINTS.websites}/${encodeURIComponent(websiteId)}`, {
    method: "PATCH",
    signal,
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(data),
  }));
  if (!isWebsiteRecord(value)) throw new Error("Backend returned an unexpected website response.");
  return value;
}

export async function removeWebsite(websiteId: string, signal?: AbortSignal): Promise<void> {
  const value = await readJson(await apiFetch(`${API_ENDPOINTS.websites}/${encodeURIComponent(websiteId)}`, {
    method: "DELETE",
    signal,
    headers: { Accept: "application/json" },
  }));
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
    throw new Error("Backend returned an unexpected website removal response.");
  }
}

async function changeWebsiteCredential(
  websiteId: string,
  operation: "credentials" | "credentials/rotate" | "credentials/revoke",
): Promise<IntegrationCredentialResponse | void> {
  const value = await readJson(await apiFetch(
    `${API_ENDPOINTS.websites}/${encodeURIComponent(websiteId)}/integration/${operation}`,
    {
      method: "POST",
      headers: { Accept: "application/json" },
    },
  ));
  if (operation === "credentials/revoke") {
    if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true) {
      throw new Error("Backend returned an unexpected credential revocation response.");
    }
    return;
  }
  if (
    !value ||
    typeof value !== "object" ||
    !("credential" in value) ||
    typeof value.credential !== "string" ||
    !("created_at" in value) ||
    typeof value.created_at !== "string"
  ) {
    throw new Error("Backend returned an unexpected integration credential response.");
  }
  return value as IntegrationCredentialResponse;
}

export async function createWebsiteCredential(websiteId: string) {
  return await changeWebsiteCredential(websiteId, "credentials") as IntegrationCredentialResponse;
}

export async function rotateWebsiteCredential(websiteId: string) {
  return await changeWebsiteCredential(websiteId, "credentials/rotate") as IntegrationCredentialResponse;
}

export async function revokeWebsiteCredential(websiteId: string) {
  await changeWebsiteCredential(websiteId, "credentials/revoke");
}

export function isPredictionResult(value: unknown): value is PredictionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value;
  const probabilities =
    "probabilities" in result && result.probabilities && typeof result.probabilities === "object"
      ? Object.values(result.probabilities)
      : null;
  const features =
    "features" in result && result.features && typeof result.features === "object"
      ? Object.values(result.features)
      : null;
  return (
    "prediction" in result &&
    typeof result.prediction === "string" &&
    "class_id" in result &&
    typeof result.class_id === "number" &&
    "confidence" in result &&
    typeof result.confidence === "number" &&
    Number.isFinite(result.confidence) &&
    result.confidence >= 0 &&
    result.confidence <= 1 &&
    "probabilities" in result &&
    !!probabilities &&
    probabilities.length > 0 &&
    probabilities.every((score) => typeof score === "number" && Number.isFinite(score)) &&
    "features" in result &&
    !!features &&
    features.length === 8 &&
    features.every((feature) => typeof feature === "number" && Number.isFinite(feature))
  );
}
