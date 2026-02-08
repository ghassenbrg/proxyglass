export type ProxyglassEvent = {
  ts: string;
  client: {
    ip: string;
    port: number;
    id: string;
  };
  dst: {
    host: string;
    port: number;
  };
  http: {
    scheme: "http" | "https";
    method: string;
    path?: string;
    req?: {
      headers?: Record<string, string>;
      body?: {
        size_bytes: number;
        captured_bytes: number;
        truncated: boolean;
        preview_b64?: string;
        preview_text?: string;
      };
    };
    res?: {
      headers?: Record<string, string>;
      body?: {
        size_bytes: number;
        captured_bytes: number;
        truncated: boolean;
        preview_b64?: string;
        preview_text?: string;
      };
    };
  };
  obs: {
    status?: number;
    latency_ms: number;
    bytes_in: number;
    bytes_out: number;
  };
};

export type StoredEvent = ProxyglassEvent & { cursor: number };
