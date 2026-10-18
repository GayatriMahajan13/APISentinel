import type { RequestRecord } from "../context/SessionContext";

export function modelScore(record: RequestRecord) {
  const value = record.result.confidence;
  return Number.isFinite(value) ? value : 0;
}

export function endpointOf(url: string) {
  try {
    const parsed = new URL(url, "http://apisentinel.local");
    parsed.username = "";
    parsed.password = "";
    parsed.hash = "";
    return parsed.pathname || "/";
  } catch {
    return url.split("?")[0] || "/";
  }
}

export function exportCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (value: string) => {
    const safeValue = /^[\t\r ]*[=+\-@]/.test(value) ? `'${value}` : value;
    return `"${safeValue.replace(/"/g, '""')}"`;
  };
  const content = [headers, ...rows].map((row) => row.map(escape).join(",")).join("\r\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function redactSensitiveUrl(url: string) {
  try {
    const parsed = new URL(url, "http://apisentinel.local");
    for (const key of [...parsed.searchParams.keys()]) {
      if (/(username|email|login|password|passwd|token|secret|api[_-]?key|authorization|session)/i.test(key)) {
        parsed.searchParams.set(key, "[REDACTED]");
      }
    }
    if (parsed.origin === "http://apisentinel.local") {
      return `${parsed.pathname}${parsed.search}`;
    }
    return parsed.toString();
  } catch {
    return url;
  }
}

export function summarizeRequests(requests: RequestRecord[]) {
  const normal = requests.filter((record) => record.result.prediction.toLowerCase() === "normal").length;
  const anomalous = requests.filter((record) => record.result.prediction.toLowerCase() === "anomalous").length;
  return {
    total: requests.length,
    normal,
    anomalous,
    anomalyRate: requests.length ? anomalous / requests.length : 0,
  };
}

export function trendData(requests: RequestRecord[]) {
  const counts = new Map<number, { time: string; requests: number }>();
  for (const request of requests) {
    const minute = new Date(request.analyzedAt);
    minute.setSeconds(0, 0);
    const timestamp = minute.getTime();
    const bucket = counts.get(timestamp) ?? {
      time: minute.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      requests: 0,
    };
    bucket.requests += 1;
    counts.set(timestamp, bucket);
  }
  return [...counts.entries()].sort(([left], [right]) => left - right).map(([, bucket]) => bucket);
}

export function classificationData(requests: RequestRecord[]) {
  const summary = summarizeRequests(requests);
  return [
    { label: "Normal", value: summary.normal },
    { label: "Anomalous", value: summary.anomalous },
  ];
}

export function confidenceDistribution(requests: RequestRecord[]) {
  const ranges = [
    { label: "0–50%", minimum: 0, maximum: 0.5, value: 0 },
    { label: "50–70%", minimum: 0.5, maximum: 0.7, value: 0 },
    { label: "70–90%", minimum: 0.7, maximum: 0.9, value: 0 },
    { label: "90–100%", minimum: 0.9, maximum: 1.000001, value: 0 },
  ];
  for (const request of requests) {
    const band = ranges.find((range) => modelScore(request) >= range.minimum && modelScore(request) < range.maximum);
    if (band) band.value += 1;
  }
  return ranges.map(({ label, value }) => ({ label, value }));
}

export function methodData(requests: RequestRecord[]) {
  const counts = new Map<string, number>();
  for (const request of requests) {
    counts.set(request.request.method, (counts.get(request.request.method) ?? 0) + 1);
  }
  return [...counts].map(([label, value]) => ({ label, value }));
}

export function endpointData(requests: RequestRecord[]) {
  const endpoints = new Map<string, RequestRecord[]>();
  for (const record of requests) {
    const endpoint = endpointOf(record.request.url);
    const records = endpoints.get(endpoint) ?? [];
    records.push(record);
    endpoints.set(endpoint, records);
  }
  return [...endpoints].map(([endpoint, records]) => {
    const anomalousCount = records.filter((record) => record.result.prediction.toLowerCase() === "anomalous").length;
    return {
      endpoint,
      count: records.length,
      anomalous: anomalousCount,
      anomalyRate: records.length ? anomalousCount / records.length : 0,
      averageScore: records.reduce((total, record) => total + modelScore(record), 0) / records.length,
      lastAnalyzed: records.reduce(
        (latest, record) => (record.analyzedAt > latest ? record.analyzedAt : latest),
        records[0].analyzedAt,
      ),
    };
  });
}
