import http from "node:http";
import net from "node:net";
import { URL } from "node:url";
import type { Config } from "../config.ts";
import { hostAllowed } from "../config.ts";
import type { EventStore } from "../events/store.ts";
import type { ProxyglassEvent } from "../events/types.ts";
import { resolveClientId } from "./ids.ts";
import { pipeWithCount } from "./bytecount.ts";
import type { Metrics } from "../metrics/metrics.ts";
import { statusClass } from "../metrics/metrics.ts";
import { buildConnectEvent, buildHttpEvent } from "./eventbuild.ts";
import { captureHeaders, finalizeBodyCapture, ingestBodyChunk, newBodyAccumulator } from "./capture.ts";

const HOP_BY_HOP = new Set([
  "connection",
  "proxy-connection",
  "keep-alive",
  "transfer-encoding",
  "upgrade",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
]);

function sanitizeHeaders(h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const out: http.OutgoingHttpHeaders = {};
  for (const [k, v] of Object.entries(h)) {
    const lk = k.toLowerCase();
    if (HOP_BY_HOP.has(lk)) continue;
    if (lk === "host") continue;
    out[k] = v as any;
  }
  return out;
}

function shouldSample(cfg: Config): boolean {
  if (cfg.sampleRate >= 1) return true;
  if (cfg.sampleRate <= 0) return false;
  return Math.random() < cfg.sampleRate;
}

export function createProxyServer(cfg: Config, store: EventStore, metrics: Metrics): http.Server {
  const server = http.createServer((req, res) => {
    const started = Date.now();
    const clientIp = req.socket.remoteAddress ?? "unknown";
    const clientPort = req.socket.remotePort ?? 0;
    const clientId = resolveClientId(req.headers as any, cfg.defaultClientId);

    const rawUrl = req.url ?? "";
    const method = (req.method ?? "GET").toUpperCase();
    let target: URL;
    try {
      if (/^https?:\/\//i.test(rawUrl)) {
        target = new URL(rawUrl);
      } else {
        const host = req.headers.host;
        if (!host) throw new Error("missing Host");
        target = new URL(`http://${host}${rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`}`);
      }
    } catch {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("bad request");
      return;
    }

    if (target.protocol !== "http:") {
      res.writeHead(400, { "content-type": "text/plain" });
      res.end("only http proxying is supported; use CONNECT for https");
      return;
    }

    const host = target.hostname;
    const port = target.port ? Number(target.port) : 80;
    const allow = hostAllowed(cfg, host);
    if (!allow.ok) {
      res.writeHead(403, { "content-type": "text/plain" });
      res.end(`blocked by ${allow.reason}`);
      return;
    }

    let bytesOut = 0;
    let bytesIn = 0;
    const reqBodyAcc = newBodyAccumulator(cfg.captureHttpBodyBytes);
    req.on("data", (chunk) => {
      bytesOut += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
      if (cfg.captureHttpBodyBytes > 0) ingestBodyChunk(reqBodyAcc, chunk as any);
    });

    const proxyReq = http.request(
      {
        protocol: "http:",
        hostname: host,
        port,
        method,
        path: `${target.pathname}${target.search}`,
        headers: {
          ...sanitizeHeaders(req.headers),
          host: target.host,
        },
      },
      (proxyRes) => {
        res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers as any);
        const resBodyAcc = newBodyAccumulator(cfg.captureHttpBodyBytes);
        proxyRes.on("data", (chunk) => {
          bytesIn += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(String(chunk));
          if (cfg.captureHttpBodyBytes > 0) ingestBodyChunk(resBodyAcc, chunk as any);
        });
        proxyRes.pipe(res);
        proxyRes.on("end", () => {
          const status = proxyRes.statusCode ?? 0;
          const sc = statusClass(status);
          metrics.httpRequestsTotal.inc({ client_id: clientId, host, method, status_class: sc }, 1);
          metrics.httpRequestDurationSeconds.observe(
            { client_id: clientId, host, method, status_class: sc },
            (Date.now() - started) / 1000
          );
          metrics.bytesTotal.inc({ client_id: clientId, direction: "out" }, bytesOut);
          metrics.bytesTotal.inc({ client_id: clientId, direction: "in" }, bytesIn);

          const ev: ProxyglassEvent = buildHttpEvent({
            clientIp,
            clientPort,
            clientId,
            host,
            port,
            method,
            path: `${target.pathname}${target.search}`,
            status,
            startedMs: started,
            bytesIn,
            bytesOut,
          });

          if (cfg.captureHttpHeaders) {
            ev.http.req = ev.http.req ?? {};
            ev.http.res = ev.http.res ?? {};
            ev.http.req.headers = captureHeaders(req.headers);
            ev.http.res.headers = captureHeaders(proxyRes.headers as any);
          }
          if (cfg.captureHttpBodyBytes > 0) {
            const reqCt = (req.headers["content-type"] as string | undefined) ?? undefined;
            const resCt = (proxyRes.headers["content-type"] as string | undefined) ?? undefined;
            ev.http.req = ev.http.req ?? {};
            ev.http.res = ev.http.res ?? {};
            ev.http.req.body = finalizeBodyCapture(reqBodyAcc, { contentType: reqCt, includeText: cfg.captureHttpBodyText });
            ev.http.res.body = finalizeBodyCapture(resBodyAcc, { contentType: resCt, includeText: cfg.captureHttpBodyText });
          }

          if (shouldSample(cfg)) {
            const stored = store.add(ev);
            if (cfg.logFormat === "json") process.stdout.write(`${JSON.stringify(stored)}\n`);
          }
          // dropped events metric (ring overwrite) is updated by polling store (below), not per-request.
        });
      }
    );

    proxyReq.on("error", () => {
      res.writeHead(502, { "content-type": "text/plain" });
      res.end("bad gateway");
    });

    req.pipe(proxyReq);
  });

  server.on("connect", (req, clientSocket, head) => {
    const started = Date.now();
    const clientIp = clientSocket.remoteAddress ?? "unknown";
    const clientPort = clientSocket.remotePort ?? 0;
    const clientId = resolveClientId(req.headers as any, cfg.defaultClientId);

    const authority = req.url ?? "";
    const [hostRaw, portRaw] = authority.split(":");
    const host = (hostRaw ?? "").trim();
    const port = portRaw ? Number(portRaw) : 443;
    if (!host || !Number.isFinite(port) || port <= 0) {
      clientSocket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const allow = hostAllowed(cfg, host);
    if (!allow.ok) {
      clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    let outBytes = 0;
    let inBytes = 0;

    const serverSocket = net.connect(port, host, () => {
      clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head && head.length) serverSocket.write(head);

      pipeWithCount(clientSocket, serverSocket, (n) => { outBytes += n; });
      pipeWithCount(serverSocket, clientSocket, (n) => { inBytes += n; });
    });

    const finish = () => {
      const latency = Date.now() - started;
      metrics.httpsConnectTotal.inc({ client_id: clientId, host, port: String(port) }, 1);
      metrics.bytesTotal.inc({ client_id: clientId, direction: "out" }, outBytes);
      metrics.bytesTotal.inc({ client_id: clientId, direction: "in" }, inBytes);

      const ev: ProxyglassEvent = buildConnectEvent({
        clientIp,
        clientPort,
        clientId,
        host,
        port,
        startedMs: started,
        bytesIn: inBytes,
        bytesOut: outBytes,
      });
      if (shouldSample(cfg)) {
        const stored = store.add(ev);
        if (cfg.logFormat === "json") process.stdout.write(`${JSON.stringify(stored)}\n`);
      }
    };

    let finished = false;
    const finishOnce = () => {
      if (finished) return;
      finished = true;
      finish();
    };

    serverSocket.on("error", () => {
      try { clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n"); } catch {}
      clientSocket.destroy();
      finishOnce();
    });

    clientSocket.on("error", () => {
      serverSocket.destroy();
      finishOnce();
    });

    clientSocket.on("close", () => {
      serverSocket.destroy();
      finishOnce();
    });

    serverSocket.on("close", () => {
      clientSocket.destroy();
      finishOnce();
    });
  });

  // Periodically reconcile ring overwrites into the dropped_events metric.
  let lastDropped = 0;
  const t = setInterval(() => {
    const cur = store.droppedTotal();
    const delta = cur - lastDropped;
    if (delta > 0) metrics.droppedEventsTotal.inc({}, delta);
    lastDropped = cur;
  }, 2000);
  t.unref();

  return server;
}
