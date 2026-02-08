import { describe, it, expect } from "vitest";
import { captureHeaders, finalizeBodyCapture, ingestBodyChunk, newBodyAccumulator } from "../src/proxy/capture.ts";

describe("capture", () => {
  it("redacts sensitive headers", () => {
    const h = captureHeaders({
      authorization: "Bearer secret",
      cookie: "a=b",
      "x-api-key": "k",
      "content-type": "application/json",
    } as any);
    expect(h["authorization"]).toBe("<redacted>");
    expect(h["cookie"]).toBe("<redacted>");
    expect(h["x-api-key"]).toBe("<redacted>");
    expect(h["content-type"]).toBe("application/json");
  });

  it("truncates body capture", () => {
    const acc = newBodyAccumulator(3);
    ingestBodyChunk(acc, Buffer.from("hello"));
    const out = finalizeBodyCapture(acc, { contentType: "text/plain", includeText: true });
    expect(out?.size_bytes).toBe(5);
    expect(out?.captured_bytes).toBe(3);
    expect(out?.truncated).toBe(true);
    expect(out?.preview_text).toBe("hel");
  });
});

