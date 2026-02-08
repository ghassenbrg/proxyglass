export type Config = {
  proxyPort: number;
  mgmtPort: number;
  maxEvents: number;
  logFormat: "json";
  requireToken: boolean;
  token?: string;
  defaultClientId: string;
  sampleRate: number;
  allowHostRegex?: RegExp;
  denyHostRegex?: RegExp;
  captureHttpHeaders: boolean;
  captureHttpBodyBytes: number;
  captureHttpBodyText: boolean;
};

function envBool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v == null) return def;
  return ["1", "true", "yes", "y", "on"].includes(String(v).toLowerCase());
}

function envNum(name: string, def: number): number {
  const v = process.env[name];
  if (v == null || v === "") return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function envStr(name: string, def: string): string {
  const v = process.env[name];
  return v == null || v === "" ? def : String(v);
}

function envRegex(name: string): RegExp | undefined {
  const v = process.env[name];
  if (!v) return undefined;
  return new RegExp(v);
}

export function loadConfig(): Config {
  const proxyPort = envNum("PROXY_PORT", 3128);
  const mgmtPort = envNum("MGMT_PORT", 9090);
  const maxEvents = Math.max(1, Math.floor(envNum("MAX_EVENTS", 5000)));
  const logFormat = "json";
  const requireToken = envBool("REQUIRE_TOKEN", false);
  const token = process.env.TOKEN ? String(process.env.TOKEN) : undefined;
  const defaultClientId = envStr("DEFAULT_CLIENT_ID", "unknown");
  const sampleRateRaw = envNum("SAMPLE_RATE", 1.0);
  const sampleRate = Math.min(1, Math.max(0, sampleRateRaw));
  const allowHostRegex = envRegex("ALLOW_HOST_REGEX");
  const denyHostRegex = envRegex("DENY_HOST_REGEX");
  const captureHttpHeaders = envBool("CAPTURE_HTTP_HEADERS", false);
  const captureHttpBodyBytesRaw = envNum("CAPTURE_HTTP_BODY_BYTES", 0);
  const captureHttpBodyBytes = Math.max(0, Math.min(64 * 1024, Math.floor(captureHttpBodyBytesRaw)));
  const captureHttpBodyText = envBool("CAPTURE_HTTP_BODY_TEXT", true);

  if (requireToken && !token) {
    // Keep running, but endpoints will effectively be locked down.
    // This is intentional to avoid exposing mgmt UI/API accidentally.
    // (Documented in README.)
    // eslint-disable-next-line no-console
    console.error("proxyglass: REQUIRE_TOKEN is set but TOKEN is empty; mgmt endpoints will reject all requests.");
  }

  return {
    proxyPort,
    mgmtPort,
    maxEvents,
    logFormat,
    requireToken,
    token,
    defaultClientId,
    sampleRate,
    allowHostRegex,
    denyHostRegex,
    captureHttpHeaders,
    captureHttpBodyBytes,
    captureHttpBodyText,
  };
}

export function hostAllowed(cfg: Config, host: string): { ok: boolean; reason?: string } {
  if (cfg.denyHostRegex && cfg.denyHostRegex.test(host)) return { ok: false, reason: "DENY_HOST_REGEX" };
  if (cfg.allowHostRegex && !cfg.allowHostRegex.test(host)) return { ok: false, reason: "ALLOW_HOST_REGEX" };
  return { ok: true };
}
