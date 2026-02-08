import { describe, it, expect } from "vitest";
import { buildHttpEvent, buildConnectEvent } from "../src/proxy/eventbuild.ts";

describe("event builders", () => {
  it("buildHttpEvent includes path and status", () => {
    const ev = buildHttpEvent({
      clientIp: "10.0.0.1",
      clientPort: 1234,
      clientId: "c1",
      host: "example.com",
      port: 80,
      method: "GET",
      path: "/x",
      status: 200,
      startedMs: Date.now() - 10,
      bytesIn: 7,
      bytesOut: 3,
    });
    expect(ev.http.scheme).toBe("http");
    expect(ev.http.path).toBe("/x");
    expect(ev.obs.status).toBe(200);
  });

  it("buildConnectEvent omits path/status", () => {
    const ev = buildConnectEvent({
      clientIp: "10.0.0.1",
      clientPort: 1234,
      clientId: "c1",
      host: "example.com",
      port: 443,
      startedMs: Date.now() - 10,
      bytesIn: 7,
      bytesOut: 3,
    });
    expect(ev.http.method).toBe("CONNECT");
    expect(ev.http.path).toBe(undefined);
    expect(ev.obs.status).toBe(undefined);
  });
});
