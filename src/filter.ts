import type { ProxyglassEvent } from "./events/types.ts";

export type FilterToken =
  | { k: "host"; v: string }
  | { k: "method"; v: string }
  | { k: "scheme"; v: "http" | "https" }
  | { k: "path_contains"; v: string }
  | { k: "client"; v: string }
  | { k: "status"; v: number }
  | { k: "status_class"; v: string };

export type CompiledFilter = {
  tokens: FilterToken[];
  matches: (ev: ProxyglassEvent) => boolean;
};

function splitTokens(q: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: "\"" | "'" | null = null;
  for (let i = 0; i < q.length; i++) {
    const ch = q[i];
    if (quote) {
      if (ch === quote) {
        quote = null;
      } else {
        cur += ch;
      }
      continue;
    }
    if (ch === "'" || ch === "\"") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

function statusClassOf(status: number): string {
  const c = Math.floor(status / 100);
  return `${c}xx`;
}

export function compileFilter(q: string | undefined, opts?: { strict?: boolean }): CompiledFilter {
  const strict = !!opts?.strict;
  const tokens: FilterToken[] = [];
  const raw = (q ?? "").trim();
  if (!raw) return { tokens, matches: () => true };

  for (const t of splitTokens(raw)) {
    const idx = t.indexOf("=");
    if (idx <= 0) {
      if (strict) throw new Error(`invalid token (expected k=v): ${t}`);
      continue;
    }
    const k = t.slice(0, idx);
    const v = t.slice(idx + 1);
    if (k === "host") tokens.push({ k: "host", v });
    else if (k === "method") tokens.push({ k: "method", v: v.toUpperCase() });
    else if (k === "scheme") {
      if (v !== "http" && v !== "https") {
        if (strict) throw new Error(`invalid scheme: ${v}`);
        continue;
      }
      tokens.push({ k: "scheme", v });
    } else if (k === "path_contains") tokens.push({ k: "path_contains", v });
    else if (k === "client") tokens.push({ k: "client", v });
    else if (k === "status") {
      const n = Number(v);
      if (!Number.isFinite(n)) {
        if (strict) throw new Error(`invalid status: ${v}`);
        continue;
      }
      tokens.push({ k: "status", v: Math.floor(n) });
    } else if (k === "status_class") {
      if (!/^[1-5]xx$/.test(v)) {
        if (strict) throw new Error(`invalid status_class (expected 2xx): ${v}`);
        continue;
      }
      tokens.push({ k: "status_class", v });
    } else {
      if (strict) throw new Error(`unknown filter key: ${k}`);
    }
  }

  const matches = (ev: ProxyglassEvent): boolean => {
    for (const tok of tokens) {
      if (tok.k === "host") {
        if (ev.dst.host !== tok.v) return false;
      } else if (tok.k === "method") {
        if (ev.http.method.toUpperCase() !== tok.v) return false;
      } else if (tok.k === "scheme") {
        if (ev.http.scheme !== tok.v) return false;
      } else if (tok.k === "path_contains") {
        const p = ev.http.path ?? "";
        if (!p.includes(tok.v)) return false;
      } else if (tok.k === "client") {
        if (ev.client.id !== tok.v) return false;
      } else if (tok.k === "status") {
        if ((ev.obs.status ?? -1) !== tok.v) return false;
      } else if (tok.k === "status_class") {
        const st = ev.obs.status;
        if (st == null) return false;
        if (statusClassOf(st) !== tok.v) return false;
      }
    }
    return true;
  };

  return { tokens, matches };
}
