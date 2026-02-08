import http from "node:http";
import { URL } from "node:url";
import type { Config } from "../config.ts";
import type { EventStore } from "../events/store.ts";
import { compileFilter } from "../filter.ts";
import { parseDurationMs } from "../util/time.ts";
import type { Metrics } from "../metrics/metrics.ts";
import { loadUiHtml } from "../ui/ui.ts";

function send(res: http.ServerResponse, status: number, body: string, headers?: Record<string, string>) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8", ...headers });
  res.end(body);
}

function sendJson(res: http.ServerResponse, status: number, obj: unknown) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function getBearerToken(req: http.IncomingMessage, url: URL): string | undefined {
  const h = req.headers.authorization;
  if (h && /^Bearer\s+/i.test(h)) return h.replace(/^Bearer\s+/i, "").trim();
  const q = url.searchParams.get("token") ?? url.searchParams.get("access_token");
  return q ? String(q) : undefined;
}

function authed(cfg: Config, req: http.IncomingMessage, url: URL): boolean {
  if (!cfg.requireToken) return true;
  const token = cfg.token;
  if (!token) return false;
  const got = getBearerToken(req, url);
  return got === token;
}

function parseSinceCursorOrDuration(since: string | null): { sinceCursor?: number; fromTsMs?: number } {
  if (!since) return {};
  const n = Number(since);
  if (Number.isFinite(n) && String(Math.floor(n)) === since.trim()) return { sinceCursor: Math.max(1, Math.floor(n)) };
  const dur = parseDurationMs(since);
  if (dur != null) return { fromTsMs: Date.now() - dur };
  return {};
}

function parseTsParam(v: string | null): number | undefined {
  if (!v) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function sse(res: http.ServerResponse) {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(":ok\n\n");
}

const UI_HTML = loadUiHtml();

export function createMgmtServer(cfg: Config, store: EventStore, metrics: Metrics, ready: () => boolean): http.Server {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const path = url.pathname;

    if (path === "/healthz") return send(res, 200, "ok\n");
    if (path === "/readyz") return send(res, ready() ? 200 : 503, ready() ? "ready\n" : "not ready\n");

    const needsAuth = path.startsWith("/api/") || path === "/ui" || path === "/metrics";
    if (needsAuth && !authed(cfg, req, url)) return send(res, 401, "unauthorized\n", { "www-authenticate": "Bearer" });

    if (path === "/metrics") {
      res.writeHead(200, { "content-type": metrics.registry.contentType });
      res.end(metrics.registry.metrics());
      return;
    }

    if (path === "/ui") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(UI_HTML);
      return;
    }

    if (path === "/api/events") {
      const limit = Math.max(0, Math.min(50_000, Number(url.searchParams.get("limit") ?? "200")));
      const q = url.searchParams.get("q") ?? "";
      const compiled = compileFilter(q);
      const since = parseSinceCursorOrDuration(url.searchParams.get("since"));
      const from = parseTsParam(url.searchParams.get("from"));
      const to = parseTsParam(url.searchParams.get("to"));
      const result = store.query({
        sinceCursor: since.sinceCursor,
        fromTsMs: from ?? since.fromTsMs,
        toTsMs: to,
        limit,
        matches: compiled.matches,
      });
      return sendJson(res, 200, {
        events: result.events,
        next_cursor: result.nextCursor,
        dropped_total: result.droppedTotal,
      });
    }

    if (path === "/api/stats") {
      const q = url.searchParams.get("q") ?? "";
      const compiled = compileFilter(q);
      const since = parseSinceCursorOrDuration(url.searchParams.get("since"));
      const from = parseTsParam(url.searchParams.get("from"));
      const to = parseTsParam(url.searchParams.get("to"));
      const all = store.all().filter((ev) => {
        if (since.sinceCursor != null && ev.cursor < since.sinceCursor) return false;
        const tsMs = Date.parse(ev.ts);
        if (Number.isFinite(tsMs)) {
          const fromMs = from ?? since.fromTsMs;
          if (fromMs != null && tsMs < fromMs) return false;
          if (to != null && tsMs > to) return false;
        }
        return compiled.matches(ev);
      });
      const topHosts = new Map<string, { host: string; count: number }>();
      const topClients = new Map<string, { client_id: string; count: number }>();
      const statusDist = new Map<string, number>();
      for (const ev of all) {
        topHosts.set(ev.dst.host, { host: ev.dst.host, count: (topHosts.get(ev.dst.host)?.count ?? 0) + 1 });
        topClients.set(ev.client.id, { client_id: ev.client.id, count: (topClients.get(ev.client.id)?.count ?? 0) + 1 });
        const sc = ev.obs.status != null ? `${Math.floor(ev.obs.status / 100)}xx` : "connect";
        statusDist.set(sc, (statusDist.get(sc) ?? 0) + 1);
      }
      const sortTop = <T extends { count: number }>(m: Map<string, T>) =>
        [...m.values()].sort((a, b) => b.count - a.count).slice(0, 20);
      return sendJson(res, 200, {
        total: all.length,
        top_hosts: sortTop(topHosts),
        top_clients: sortTop(topClients),
        status_distribution: Object.fromEntries([...statusDist.entries()].sort((a, b) => b[1] - a[1])),
        dropped_total: store.droppedTotal(),
      });
    }

    if (path === "/api/stream") {
      const q = url.searchParams.get("q") ?? "";
      const compiled = compileFilter(q);
      const since = url.searchParams.get("since");
      let cursor = since ? Number(since) : undefined;
      if (!Number.isFinite(cursor as any)) cursor = undefined;
      if (req.headers["last-event-id"]) {
        const le = Number(String(req.headers["last-event-id"]));
        if (Number.isFinite(le)) cursor = le + 1;
      }

      sse(res);

      // Replay from cursor if provided.
      if (cursor != null) {
        const replay = store.query({ sinceCursor: Math.max(1, cursor), limit: 50_000, matches: compiled.matches });
        for (const ev of replay.events) {
          res.write(`id: ${ev.cursor}\n`);
          res.write(`data: ${JSON.stringify(ev)}\n\n`);
        }
      }

      const off = store.onEvent((ev) => {
        if (cursor != null && ev.cursor < cursor) return;
        if (!compiled.matches(ev)) return;
        res.write(`id: ${ev.cursor}\n`);
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      });

      req.on("close", () => off());
      return;
    }

    send(res, 404, "not found\n");
  });

  return server;
}
