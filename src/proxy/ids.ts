import { Buffer } from "node:buffer";

function parseBasicUser(proxyAuth: string | undefined): string | undefined {
  if (!proxyAuth) return undefined;
  const m = /^Basic\s+(.+)$/i.exec(proxyAuth.trim());
  if (!m) return undefined;
  try {
    const decoded = Buffer.from(m[1], "base64").toString("utf8");
    const idx = decoded.indexOf(":");
    const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
    const u = user.trim();
    return u ? u : undefined;
  } catch {
    return undefined;
  }
}

export function resolveClientId(headers: Record<string, unknown>, defaultId: string): string {
  const hdr = (headers["x-proxyglass-id"] ?? headers["X-Proxyglass-Id"]) as string | undefined;
  if (hdr && String(hdr).trim()) return String(hdr).trim();
  const proxyAuth = headers["proxy-authorization"] as string | undefined;
  const u = parseBasicUser(proxyAuth);
  if (u) return u;
  return defaultId;
}

