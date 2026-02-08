import { describe, it, expect } from "vitest";
import { compileFilter } from "../src/filter.ts";
import type { ProxyglassEvent } from "../src/events/types.ts";

describe("compileFilter", () => {
  it("matches AND tokens", () => {
    const f = compileFilter("scheme=https host=httpbin.org method=CONNECT client=app status_class=2xx");
    const ev: ProxyglassEvent = {
      ts: new Date().toISOString(),
      client: { ip: "10.0.0.1", port: 1234, id: "app" },
      dst: { host: "httpbin.org", port: 443 },
      http: { scheme: "https", method: "CONNECT" },
      obs: { latency_ms: 10, bytes_in: 1, bytes_out: 2, status: 200 },
    };
    expect(f.matches(ev)).toBe(true);
    expect(f.matches({ ...ev, dst: { ...ev.dst, host: "example.com" } })).toBe(false);
  });

  it("supports path_contains for http", () => {
    const f = compileFilter("path_contains=/api method=GET");
    const ev: ProxyglassEvent = {
      ts: new Date().toISOString(),
      client: { ip: "10.0.0.1", port: 1234, id: "c" },
      dst: { host: "x", port: 80 },
      http: { scheme: "http", method: "GET", path: "/v1/api/ping" },
      obs: { latency_ms: 10, bytes_in: 1, bytes_out: 2, status: 200 },
    };
    expect(f.matches(ev)).toBe(true);
  });
});
