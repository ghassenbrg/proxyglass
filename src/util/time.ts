export function nowIso(): string {
  return new Date().toISOString();
}

export function parseDurationMs(s: string): number | undefined {
  const m = /^(\d+)(ms|s|m|h|d)$/.exec(s.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  const unit = m[2];
  const mul =
    unit === "ms" ? 1 :
    unit === "s" ? 1000 :
    unit === "m" ? 60_000 :
    unit === "h" ? 3_600_000 :
    86_400_000;
  return n * mul;
}

export function msSince(startMs: number): number {
  return Date.now() - startMs;
}

