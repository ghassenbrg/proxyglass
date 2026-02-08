import type { ProxyglassEvent } from "../events/types.ts";
import { nowIso } from "../util/time.ts";

export function buildHttpEvent(input: {
  clientIp: string;
  clientPort: number;
  clientId: string;
  host: string;
  port: number;
  method: string;
  path: string;
  status: number;
  startedMs: number;
  bytesIn: number;
  bytesOut: number;
}): ProxyglassEvent {
  return {
    ts: nowIso(),
    client: { ip: input.clientIp, port: input.clientPort, id: input.clientId },
    dst: { host: input.host, port: input.port },
    http: { scheme: "http", method: input.method, path: input.path },
    obs: {
      status: input.status,
      latency_ms: Date.now() - input.startedMs,
      bytes_in: input.bytesIn,
      bytes_out: input.bytesOut,
    },
  };
}

export function buildConnectEvent(input: {
  clientIp: string;
  clientPort: number;
  clientId: string;
  host: string;
  port: number;
  startedMs: number;
  bytesIn: number;
  bytesOut: number;
}): ProxyglassEvent {
  return {
    ts: nowIso(),
    client: { ip: input.clientIp, port: input.clientPort, id: input.clientId },
    dst: { host: input.host, port: input.port },
    http: { scheme: "https", method: "CONNECT" },
    obs: {
      latency_ms: Date.now() - input.startedMs,
      bytes_in: input.bytesIn,
      bytes_out: input.bytesOut,
    },
  };
}
