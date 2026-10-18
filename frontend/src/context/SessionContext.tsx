import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  getAlerts,
  getAnalyticsSummary,
  getHistory,
  patchAlert,
  type AlertResponse,
  type AnalyticsSummary,
  type PredictionRecordResponse,
  type PredictionResult,
  type RequestScan,
  type ReviewStatus,
} from "../api";

export type AnalystDecision = "Confirmed anomaly" | "False positive" | "Uncertain";

export interface RequestRecord {
  id: string;
  alertId?: string;
  analyzedAt: string;
  request: Pick<Required<RequestScan>, "method" | "url">;
  result: PredictionResult;
  reviewStatus: ReviewStatus;
  notes: string;
  feedback?: {
    decision: AnalystDecision;
    notes: string;
    reviewedAt: string;
  };
}

interface RefreshResult {
  summary: AnalyticsSummary | null;
  errors: {
    history: string | null;
    alerts: string | null;
    summary: string | null;
  };
}

interface SessionContextValue {
  requests: RequestRecord[];
  alerts: RequestRecord[];
  summary: AnalyticsSummary | null;
  historyTotal: number;
  alertsTotal: number;
  historyLoading: boolean;
  alertsLoading: boolean;
  summaryLoading: boolean;
  historyError: string | null;
  alertsError: string | null;
  summaryError: string | null;
  refreshAll: () => Promise<RefreshResult>;
  refreshHistory: (offset?: number) => Promise<boolean>;
  refreshAlerts: (offset?: number) => Promise<boolean>;
  updateRequest: (
    id: string,
    updates: Partial<Pick<RequestRecord, "reviewStatus" | "notes" | "feedback">>,
  ) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
const PAGE_SIZE = 100;

function asPredictionResult(record: PredictionRecordResponse): PredictionResult {
  const probabilities: Record<string, number> = {};
  if (record.normal_score !== null) probabilities.normal = record.normal_score;
  if (record.anomalous_score !== null) probabilities.anomalous = record.anomalous_score;
  return {
    prediction: record.prediction,
    class_id: record.class_id,
    confidence: record.confidence,
    probabilities,
    features: record.features,
    method: record.method,
    url: record.url,
  };
}

function fromHistory(record: PredictionRecordResponse, alert?: AlertResponse): RequestRecord {
  return {
    id: record.id,
    alertId: alert?.id,
    analyzedAt: record.timestamp,
    request: { method: record.method, url: record.url },
    result: asPredictionResult(record),
    reviewStatus: alert?.review_status ?? "Resolved",
    notes: alert?.analyst_notes ?? "",
  };
}

function fromAlert(alert: AlertResponse): RequestRecord {
  return {
    id: alert.prediction_id,
    alertId: alert.id,
    analyzedAt: alert.prediction.timestamp,
    request: { method: alert.prediction.method, url: alert.prediction.url },
    result: asPredictionResult(alert.prediction),
    reviewStatus: alert.review_status,
    notes: alert.analyst_notes,
  };
}

function errorMessage(cause: unknown, fallback: string) {
  return cause instanceof Error ? cause.message : fallback;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [requests, setRequests] = useState<RequestRecord[]>([]);
  const [alerts, setAlerts] = useState<RequestRecord[]>([]);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [alertsTotal, setAlertsTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const refreshHistory = useCallback(async (offset = 0) => {
    setHistoryLoading(true);
    try {
      const response = await getHistory({ limit: PAGE_SIZE, offset });
      const alertsByPrediction = new Map(alerts.map((alert) => [alert.id, alert]));
      const page = response.items.map((record) => {
        const request = fromHistory(record);
        const alert = alertsByPrediction.get(record.id);
        return alert
          ? {
              ...request,
              alertId: alert.alertId,
              reviewStatus: alert.reviewStatus,
              notes: alert.notes,
              feedback: alert.feedback,
            }
          : request;
      });
      setRequests((previous) =>
        offset === 0
          ? page
          : [...previous.filter((record) => !page.some((item) => item.id === record.id)), ...page],
      );
      setHistoryTotal(response.total);
      setHistoryError(null);
      return true;
    } catch (cause) {
      setHistoryError(errorMessage(cause, "Could not load request history."));
      if (offset === 0) setRequests([]);
      return false;
    } finally {
      setHistoryLoading(false);
    }
  }, [alerts]);

  const refreshAll = useCallback(async (): Promise<RefreshResult> => {
    setHistoryLoading(true);
    setAlertsLoading(true);
    setSummaryLoading(true);
    const [historyResult, alertsResult, summaryResult] = await Promise.allSettled([
      getHistory({ limit: PAGE_SIZE, offset: 0 }),
      getAlerts({ limit: PAGE_SIZE, offset: 0 }),
      getAnalyticsSummary(),
    ]);

    const nextErrors = {
      history: null as string | null,
      alerts: null as string | null,
      summary: null as string | null,
    };
    if (historyResult.status === "fulfilled") {
      const alertsByPrediction = new Map(
        (alertsResult.status === "fulfilled" ? alertsResult.value.items : []).map((alert) => [
          alert.prediction_id,
          alert,
        ]),
      );
      setRequests(
        historyResult.value.items.map((record) =>
          fromHistory(record, alertsByPrediction.get(record.id)),
        ),
      );
      setHistoryTotal(historyResult.value.total);
    } else {
      nextErrors.history = errorMessage(historyResult.reason, "Could not load request history.");
      setRequests([]);
      setHistoryTotal(0);
    }
    if (alertsResult.status === "fulfilled") {
      setAlerts(alertsResult.value.items.map(fromAlert));
      setAlertsTotal(alertsResult.value.total);
    } else {
      nextErrors.alerts = errorMessage(alertsResult.reason, "Could not load security alerts.");
      setAlerts([]);
      setAlertsTotal(0);
    }
    if (summaryResult.status === "fulfilled") {
      setSummary(summaryResult.value);
    } else {
      nextErrors.summary = errorMessage(summaryResult.reason, "Could not load analytics summary.");
      setSummary(null);
    }
    setHistoryError(nextErrors.history);
    setAlertsError(nextErrors.alerts);
    setSummaryError(nextErrors.summary);
    setHistoryLoading(false);
    setAlertsLoading(false);
    setSummaryLoading(false);
    return { summary: summaryResult.status === "fulfilled" ? summaryResult.value : null, errors: nextErrors };
  }, []);

  const refreshAlerts = useCallback(async (offset = 0) => {
    setAlertsLoading(true);
    try {
      const response = await getAlerts({ limit: PAGE_SIZE, offset });
      const page = response.items.map(fromAlert);
      setAlerts((previous) =>
        offset === 0
          ? page
          : [...previous.filter((record) => !page.some((item) => item.id === record.id)), ...page],
      );
      setAlertsTotal(response.total);
      setAlertsError(null);
      return true;
    } catch (cause) {
      setAlertsError(errorMessage(cause, "Could not load security alerts."));
      if (offset === 0) setAlerts([]);
      return false;
    } finally {
      setAlertsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const updateRequest = useCallback<SessionContextValue["updateRequest"]>(
    async (id, updates) => {
      const alert = alerts.find((item) => item.id === id);
      if (alert?.alertId && (updates.reviewStatus !== undefined || updates.notes !== undefined)) {
        try {
          const saved = await patchAlert(alert.alertId, {
            ...(updates.reviewStatus !== undefined ? { review_status: updates.reviewStatus } : {}),
            ...(updates.notes !== undefined ? { analyst_notes: updates.notes } : {}),
          });
          setAlerts((previous) => previous.map((item) => item.id === id ? fromAlert(saved) : item));
          setRequests((previous) => previous.map((item) => item.id === id ? fromHistory(saved.prediction, saved) : item));
          setAlertsError(null);
        } catch (cause) {
          setAlertsError(errorMessage(cause, "Could not save alert review changes."));
        }
      }
      if (updates.feedback) {
        setRequests((previous) => previous.map((item) => item.id === id ? { ...item, feedback: updates.feedback } : item));
      }
    },
    [alerts],
  );

  const value = useMemo(
    () => ({
      requests,
      alerts,
      summary,
      historyTotal,
      alertsTotal,
      historyLoading,
      alertsLoading,
      summaryLoading,
      historyError,
      alertsError,
      summaryError,
      refreshAll,
      refreshHistory,
      refreshAlerts,
      updateRequest,
    }),
    [
      requests,
      alerts,
      summary,
      historyTotal,
      alertsTotal,
      historyLoading,
      alertsLoading,
      summaryLoading,
      historyError,
      alertsError,
      summaryError,
      refreshAll,
      refreshHistory,
      refreshAlerts,
      updateRequest,
    ],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used within SessionProvider.");
  return context;
}
