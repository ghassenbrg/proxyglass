import { Writable, Readable } from "node:stream";

export type ByteCount = { inBytes: number; outBytes: number };

export function pipeWithCount(src: Readable, dst: Writable, onBytes: (n: number) => void): void {
  src.on("data", (chunk) => {
    if (Buffer.isBuffer(chunk)) onBytes(chunk.length);
    else onBytes(Buffer.byteLength(String(chunk)));
  });
  src.pipe(dst);
}

