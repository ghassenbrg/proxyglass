import { EventEmitter } from "node:events";
import type { ProxyglassEvent, StoredEvent } from "./types.ts";

export type Query = {
  sinceCursor?: number;
  fromTsMs?: number;
  toTsMs?: number;
  limit: number;
  matches: (ev: ProxyglassEvent) => boolean;
};

export type QueryResult = {
  events: StoredEvent[];
  nextCursor: number;
  droppedTotal: number;
};

export class EventStore {
  private readonly max: number;
  private buf: Array<StoredEvent | undefined>;
  private start = 0;
  private size = 0;
  private nextCursor = 1;
  private dropped = 0;
  private bus = new EventEmitter();

  constructor(maxEvents: number) {
    this.max = Math.max(1, maxEvents);
    this.buf = Array(this.max);
  }

  droppedTotal(): number {
    return this.dropped;
  }

  add(ev: ProxyglassEvent): StoredEvent {
    const stored: StoredEvent = { ...ev, cursor: this.nextCursor++ };
    if (this.size < this.max) {
      const idx = (this.start + this.size) % this.max;
      this.buf[idx] = stored;
      this.size += 1;
    } else {
      // Overwrite oldest.
      this.buf[this.start] = stored;
      this.start = (this.start + 1) % this.max;
      this.dropped += 1;
    }
    this.bus.emit("event", stored);
    return stored;
  }

  onEvent(fn: (ev: StoredEvent) => void): () => void {
    this.bus.on("event", fn);
    return () => this.bus.off("event", fn);
  }

  query(q: Query): QueryResult {
    const limit = Math.max(0, Math.min(50_000, q.limit));
    const out: StoredEvent[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.start + i) % this.max;
      const ev = this.buf[idx];
      if (!ev) continue;
      if (q.sinceCursor != null && ev.cursor < q.sinceCursor) continue;
      const tsMs = Date.parse(ev.ts);
      if (Number.isFinite(tsMs)) {
        if (q.fromTsMs != null && tsMs < q.fromTsMs) continue;
        if (q.toTsMs != null && tsMs > q.toTsMs) continue;
      }
      if (!q.matches(ev)) continue;
      out.push(ev);
      if (out.length >= limit) break;
    }
    const nextCursor = out.length ? out[out.length - 1].cursor + 1 : q.sinceCursor ?? this.nextCursor;
    return { events: out, nextCursor, droppedTotal: this.dropped };
  }

  // Snapshot all events currently in memory (oldest->newest).
  all(): StoredEvent[] {
    const out: StoredEvent[] = [];
    for (let i = 0; i < this.size; i++) {
      const idx = (this.start + i) % this.max;
      const ev = this.buf[idx];
      if (ev) out.push(ev);
    }
    return out;
  }
}
