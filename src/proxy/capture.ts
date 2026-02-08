import type http from "node:http";

const SENSITIVE = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
]);

function normalizeHeaderValue(v: string | string[] | undefined): string {
  if (v == null) return "";
  if (Array.isArray(v)) return v.join(", ");
  return String(v);
}

export function captureHeaders(headers: http.IncomingHttpHeaders | http.OutgoingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers as any)) {
    const lk = k.toLowerCase();
    const val = normalizeHeaderValue(v as any);
    if (val === "") continue;
    out[lk] = SENSITIVE.has(lk) ? "<redacted>" : val;
  }
  return out;
}

export type BodyCapture = {
  size_bytes: number;
  captured_bytes: number;
  truncated: boolean;
  preview_b64?: string;
  preview_text?: string;
};

export type BodyAccumulator = {
  totalBytes: number;
  capturedBytes: number;
  bufs: Buffer[];
  limit: number;
};

export function newBodyAccumulator(limit: number): BodyAccumulator {
  return { totalBytes: 0, capturedBytes: 0, bufs: [], limit: Math.max(0, limit) };
}

export function ingestBodyChunk(acc: BodyAccumulator, chunk: Buffer | string): void {
  const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
  acc.totalBytes += buf.length;
  if (acc.limit <= 0) return;
  const remaining = acc.limit - acc.capturedBytes;
  if (remaining <= 0) return;
  if (buf.length <= remaining) {
    acc.bufs.push(buf);
    acc.capturedBytes += buf.length;
    return;
  }
  acc.bufs.push(buf.subarray(0, remaining));
  acc.capturedBytes += remaining;
}

function isTextyContentType(ct: string | undefined): boolean {
  if (!ct) return false;
  const v = ct.toLowerCase();
  if (v.startsWith("text/")) return true;
  if (v.includes("application/json")) return true;
  if (v.includes("application/xml")) return true;
  if (v.includes("application/x-www-form-urlencoded")) return true;
  return false;
}

export function finalizeBodyCapture(acc: BodyAccumulator, opts?: { contentType?: string; includeText?: boolean }): BodyCapture | undefined {
  if (acc.limit <= 0) return undefined;
  const data = Buffer.concat(acc.bufs);
  const out: BodyCapture = {
    size_bytes: acc.totalBytes,
    captured_bytes: acc.capturedBytes,
    truncated: acc.totalBytes > acc.capturedBytes,
    preview_b64: data.length ? data.toString("base64") : undefined,
  };
  if (opts?.includeText && isTextyContentType(opts.contentType)) {
    out.preview_text = data.length ? data.toString("utf8") : undefined;
  }
  return out;
}

