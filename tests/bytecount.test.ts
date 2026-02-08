import { describe, it, expect } from "vitest";
import { PassThrough } from "node:stream";
import { once } from "node:events";
import { pipeWithCount } from "../src/proxy/bytecount.ts";

describe("pipeWithCount", () => {
  it("counts bytes passing through a pipe", async () => {
    const src = new PassThrough();
    const dst = new PassThrough();
    let n = 0;
    pipeWithCount(src, dst, (b) => { n += b; });
    src.end(Buffer.from("hello"));
    const chunks: Buffer[] = [];
    dst.on("data", (c) => chunks.push(Buffer.from(c)));
    await once(dst, "end");
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello");
    expect(n).toBe(5);
  });
});
