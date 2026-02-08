import { Counter, Histogram, Registry, collectDefaultMetrics } from "prom-client";

export type Metrics = {
  registry: Registry;
  httpRequestsTotal: Counter;
  httpRequestDurationSeconds: Histogram;
  httpsConnectTotal: Counter;
  bytesTotal: Counter;
  droppedEventsTotal: Counter;
};

export function createMetrics(): Metrics {
  const registry = new Registry();
  collectDefaultMetrics({ register: registry });

  const httpRequestsTotal = new Counter({
    name: "proxyglass_http_requests_total",
    help: "Total proxied HTTP requests (absolute-form) observed by proxyglass.",
    labelNames: ["client_id", "host", "method", "status_class"],
    registers: [registry],
  });

  const httpRequestDurationSeconds = new Histogram({
    name: "proxyglass_http_request_duration_seconds",
    help: "Observed HTTP request duration in seconds.",
    labelNames: ["client_id", "host", "method", "status_class"],
    registers: [registry],
  });

  const httpsConnectTotal = new Counter({
    name: "proxyglass_https_connect_total",
    help: "Total HTTPS CONNECT tunnels observed by proxyglass.",
    labelNames: ["client_id", "host", "port"],
    registers: [registry],
  });

  const bytesTotal = new Counter({
    name: "proxyglass_bytes_total",
    help: "Observed bytes by direction (in=dst->client, out=client->dst).",
    labelNames: ["client_id", "direction"],
    registers: [registry],
  });

  const droppedEventsTotal = new Counter({
    name: "proxyglass_dropped_events_total",
    help: "Events dropped from in-memory store due to MAX_EVENTS ring buffer overwrite.",
    labelNames: [],
    registers: [registry],
  });

  return {
    registry,
    httpRequestsTotal,
    httpRequestDurationSeconds,
    httpsConnectTotal,
    bytesTotal,
    droppedEventsTotal,
  };
}

export function statusClass(status: number | undefined): string {
  if (!status || !Number.isFinite(status)) return "0xx";
  const c = Math.floor(status / 100);
  return `${c}xx`;
}

