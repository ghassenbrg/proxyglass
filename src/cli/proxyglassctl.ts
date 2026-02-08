import { compileFilter } from "../filter.ts";

type Args = Record<string, string | boolean | undefined>;

function parseArgs(argv: string[]): { cmd: string; args: Args; rest: string[] } {
  const cmd = argv[0] ?? "help";
  const args: Args = {};
  const rest: string[] = [];
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      rest.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i++;
  }
  return { cmd, args, rest };
}

function baseUrl(): string {
  const port = process.env.MGMT_PORT ? Number(process.env.MGMT_PORT) : 9090;
  return `http://127.0.0.1:${Number.isFinite(port) ? port : 9090}`;
}

function authHeaders(): Record<string, string> {
  const token = process.env.PROXYGLASS_TOKEN || process.env.TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function qs(params: Record<string, string | number | undefined>): string {
  const u = new URL("http://x/");
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === "") continue;
    u.searchParams.set(k, String(v));
  }
  return u.searchParams.toString();
}

function pretty(ev: any): string {
  const ts = ev.ts;
  const cid = ev.client?.id ?? "unknown";
  const c = `${cid}@${ev.client?.ip ?? "?"}`;
  const d = `${ev.dst?.host ?? "?"}:${ev.dst?.port ?? "?"}`;
  const m = ev.http?.method ?? "?";
  const sch = ev.http?.scheme ?? "?";
  const p = ev.http?.path ? ` ${ev.http.path}` : "";
  const st = ev.obs?.status != null ? ` ${ev.obs.status}` : "";
  const lat = ev.obs?.latency_ms != null ? ` ${ev.obs.latency_ms}ms` : "";
  const bi = ev.obs?.bytes_in ?? 0;
  const bo = ev.obs?.bytes_out ?? 0;
  return `${ts} ${c} -> ${sch} ${m} ${d}${p}${st}${lat} in=${bi} out=${bo}`;
}

async function fetchJson(path: string): Promise<any> {
  const r = await fetch(`${baseUrl()}${path}`, { headers: authHeaders() });
  if (!r.ok) throw new Error(`http ${r.status}`);
  return r.json();
}

async function tail(args: Args) {
  const q = typeof args.q === "string" ? args.q : "";
  if (q) compileFilter(q, { strict: true }); // fail fast in CLI

  const since = typeof args.since === "string" ? args.since : undefined;
  const limit = typeof args.limit === "string" ? Number(args.limit) : 200;
  let jsonMode = args.pretty ? false : true;
  if (args.json) jsonMode = true;

  const first = await fetchJson(`/api/events?${qs({ q, since, limit })}`);
  for (const ev of first.events ?? []) {
    process.stdout.write(jsonMode ? `${JSON.stringify(ev)}\n` : `${pretty(ev)}\n`);
  }
  let cursor = first.next_cursor ?? undefined;

  const streamUrl = `${baseUrl()}/api/stream?${qs({ q, since: cursor })}`;
  const r = await fetch(streamUrl, { headers: authHeaders() });
  if (!r.ok || !r.body) throw new Error(`stream http ${r.status}`);

  const reader = r.body.getReader();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += Buffer.from(value).toString("utf8");
    while (true) {
      const idx = buf.indexOf("\n\n");
      if (idx < 0) break;
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const lines = chunk.split("\n");
      let data = "";
      for (const line of lines) {
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const ev = JSON.parse(data);
        process.stdout.write(jsonMode ? `${JSON.stringify(ev)}\n` : `${pretty(ev)}\n`);
      } catch {
        // ignore
      }
    }
  }
}

async function search(args: Args) {
  const q = typeof args.q === "string" ? args.q : "";
  if (q) compileFilter(q, { strict: true });

  const limit = typeof args.limit === "string" ? Number(args.limit) : 2000;
  const since = typeof args.since === "string" ? args.since : undefined;
  const from = typeof args.from === "string" ? args.from : undefined;
  const to = typeof args.to === "string" ? args.to : undefined;
  let jsonMode = args.pretty ? false : true;
  if (args.json) jsonMode = true;

  const res = await fetchJson(`/api/events?${qs({ q, since, from, to, limit })}`);
  for (const ev of res.events ?? []) {
    process.stdout.write(jsonMode ? `${JSON.stringify(ev)}\n` : `${pretty(ev)}\n`);
  }
}

async function stats(args: Args) {
  const q = typeof args.q === "string" ? args.q : "";
  if (q) compileFilter(q, { strict: true });

  const since = typeof args.since === "string" ? args.since : undefined;
  const from = typeof args.from === "string" ? args.from : undefined;
  const to = typeof args.to === "string" ? args.to : undefined;

  const s = await fetchJson(`/api/stats?${qs({ q, since, from, to })}`);
  process.stdout.write(`total: ${s.total}\n`);
  process.stdout.write(`dropped_total: ${s.dropped_total}\n`);
  process.stdout.write("\nTop hosts:\n");
  for (const h of s.top_hosts ?? []) process.stdout.write(`  ${h.count}\t${h.host}\n`);
  process.stdout.write("\nTop clients:\n");
  for (const c of s.top_clients ?? []) process.stdout.write(`  ${c.count}\t${c.client_id}\n`);
  process.stdout.write("\nStatus distribution:\n");
  for (const [k, v] of Object.entries(s.status_distribution ?? {})) process.stdout.write(`  ${v}\t${k}\n`);
}

function help() {
  process.stdout.write(
    `proxyglassctl

Usage:
  proxyglassctl tail [--q "<expr>"] [--since <cursor|duration>] [--limit <n>] [--pretty]
  proxyglassctl search [--q "<expr>"] [--since <cursor|duration>] [--from <iso>] [--to <iso>] [--limit <n>] [--pretty]
  proxyglassctl stats [--q "<expr>"] [--since <cursor|duration>] [--from <iso>] [--to <iso>]

Filter expression (AND, space-separated):
  host=example.com
  method=GET
  scheme=https
  path_contains=/api
  client=payments-api
  status=200
  status_class=2xx

Notes:
  - CLI talks to http://127.0.0.1:$MGMT_PORT (default 9090) inside the proxyglass pod.
  - If REQUIRE_TOKEN is enabled, set PROXYGLASS_TOKEN (or TOKEN) for the CLI.
`
  );
}

async function main() {
  const { cmd, args } = parseArgs(process.argv.slice(2));
  try {
    if (cmd === "tail") return await tail(args);
    if (cmd === "search") return await search(args);
    if (cmd === "stats") return await stats(args);
    return help();
  } catch (e: any) {
    process.stderr.write(`proxyglassctl: ${e?.message ?? String(e)}\n`);
    process.exit(1);
  }
}

main();
