import http from "node:http";
import { loadConfig } from "./config.ts";
import { EventStore } from "./events/store.ts";
import { createMetrics } from "./metrics/metrics.ts";
import { createProxyServer } from "./proxy/httpProxy.ts";
import { createMgmtServer } from "./api/mgmt.ts";

const cfg = loadConfig();
const store = new EventStore(cfg.maxEvents);
const metrics = createMetrics();

let proxyReady = false;
let mgmtReady = false;
const ready = () => proxyReady && mgmtReady;

const proxy = createProxyServer(cfg, store, metrics);
const mgmt = createMgmtServer(cfg, store, metrics, ready);

proxy.listen(cfg.proxyPort, "0.0.0.0", () => {
  proxyReady = true;
  // eslint-disable-next-line no-console
  console.error(`proxyglass: proxy listening on :${cfg.proxyPort}`);
});

mgmt.listen(cfg.mgmtPort, "0.0.0.0", () => {
  mgmtReady = true;
  // eslint-disable-next-line no-console
  console.error(`proxyglass: mgmt listening on :${cfg.mgmtPort}`);
});

function shutdown(server: http.Server, name: string): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
    setTimeout(() => {
      // eslint-disable-next-line no-console
      console.error(`proxyglass: force exit waiting for ${name} close`);
      resolve();
    }, 5000).unref();
  });
}

process.on("SIGTERM", async () => {
  // eslint-disable-next-line no-console
  console.error("proxyglass: SIGTERM received, shutting down");
  await Promise.all([shutdown(proxy, "proxy"), shutdown(mgmt, "mgmt")]);
  process.exit(0);
});
