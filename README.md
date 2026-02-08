# proxyglass

`proxyglass` is a Kubernetes-friendly monitoring forward proxy that observes outbound **HTTP** requests and **HTTPS CONNECT** tunnels from application pods, without privileged access and without decrypting TLS.

It works by having the workloads you want to observe set:

- `HTTP_PROXY` / `HTTPS_PROXY` to point at the `proxyglass` Service
- `NO_PROXY` for in-cluster destinations
- optional `PROXYGLASS_ID` (for labeling, see below)

## What It Can and Can’t See

- HTTP (proxying): method + path + status + timing + bytes.
- HTTP (optional capture): request/response headers and truncated body previews (off by default).
- HTTPS (CONNECT): destination `host:port`, tunnel lifetime, bytes each direction.
- No TLS MITM: for HTTPS traffic `proxyglass` cannot see URL paths, headers, or HTTP status codes.

## Architecture

```
demo namespace pod(s)
  |  HTTP_PROXY/HTTPS_PROXY
  v
proxyglass Service (monitor namespace)
  :3128  forward proxy (HTTP + CONNECT)
  :9090  health/metrics/UI/API + in-pod CLI
  |
  v
Internet / external services
```

## Quickstart (End-to-End)

1. Create namespaces:
```bash
kubectl apply -f examples/00-namespaces.yaml
```

2. Deploy proxyglass (in `monitor` namespace):
```bash
kubectl -n monitor apply -f deploy/proxyglass.yaml
kubectl -n monitor rollout status deploy/proxyglass
```

3. Deploy the curl demo with proxy enabled (in `demo` namespace):
```bash
kubectl -n demo apply -f examples/curl-demo/demo-curl-proxy.yaml
kubectl -n demo rollout status deploy/demo-curl
```

4. Watch JSON events in stdout:
```bash
kubectl -n monitor logs -f deploy/proxyglass
```

5. Tail events using the in-pod CLI (no external access needed):
```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --q "scheme=https host=httpbin.org"
```

6. Port-forward UI (optional):
```bash
kubectl -n monitor port-forward svc/proxyglass 9090:9090
open http://127.0.0.1:9090/ui
```

For build/push/deploy details and operational usage, see `GUIDE.md`.

## Add This To Another Pod

Set these env vars on the workload you want to observe:

- `HTTP_PROXY=http://proxyglass.<monitor-namespace>.svc.cluster.local:3128`
- `HTTPS_PROXY=http://proxyglass.<monitor-namespace>.svc.cluster.local:3128`
- `NO_PROXY=localhost,127.0.0.1,.svc,.cluster.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16`
- optional `PROXYGLASS_ID=payments-api`

Cross-namespace works as long as the workload points at the Service FQDN:
`proxyglass.monitor.svc.cluster.local:3128`.

### Workload Identification (Client ID)

Because proxyglass is a network proxy (not a sidecar), it cannot read pod env vars directly.

proxyglass supports:

- `X-Proxyglass-Id` request header (works for HTTP requests and CONNECT)
- proxy username via `Proxy-Authorization: Basic ...` (when clients use a proxy URL like `http://<id>@proxy:3128`)

For demos we use `PROXYGLASS_ID` to populate `X-Proxyglass-Id` in the client command.

## In-Pod CLI (`proxyglassctl`)

Runs inside the proxyglass container and queries `http://127.0.0.1:9090`.

Examples:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --since 10m --q "scheme=https host=httpbin.org"
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl stats --since 30m
```

Filter expression language (AND, space-separated):

- `host=example.com`
- `method=GET`
- `scheme=https`
- `path_contains=/api`
- `client=payments-api`
- `status=200`
- `status_class=2xx`

## API Endpoints

Served on `:9090`:

- `GET /healthz`
- `GET /readyz`
- `GET /metrics`
- `GET /ui`
- `GET /api/events?since=<cursor|duration>&limit=<n>&q=<filter>&from=<iso>&to=<iso>`
- `GET /api/stats?since=<cursor|duration>&q=<filter>&from=<iso>&to=<iso>`
- `GET /api/stream` (SSE)

## Configuration (Env Vars)

- `PROXY_PORT` (default `3128`)
- `MGMT_PORT` (default `9090`)
- `MAX_EVENTS` (default `5000`) bounded in-memory ring buffer
- `LOG_FORMAT` (only `json` supported)
- `DEFAULT_CLIENT_ID` (default `unknown`)
- `SAMPLE_RATE` (default `1.0`) sampling for events stored/logged (metrics are not sampled)
- `CAPTURE_HTTP_HEADERS` (default `false`) include request/response headers in events (HTTP only)
- `CAPTURE_HTTP_BODY_BYTES` (default `0`) capture up to N bytes of request/response bodies as previews (HTTP only; base64 always, text only for text-like content-types)
- `CAPTURE_HTTP_BODY_TEXT` (default `true`) include `preview_text` when content-type looks text-like (HTTP only)
- `ALLOW_HOST_REGEX` / `DENY_HOST_REGEX` for destination host filtering
- `REQUIRE_TOKEN` + `TOKEN` (optional bearer auth for `/ui`, `/api/*`, `/metrics`)

Auth supports:
- `Authorization: Bearer $TOKEN`
- query param `?token=$TOKEN` (for SSE/UI convenience)

## Troubleshooting

- `NO_PROXY` is wrong: in-cluster calls may get proxied (and possibly fail). Ensure `.svc,.cluster.local` are in `NO_PROXY`.
- App ignores proxy env vars: some runtimes don’t honor `HTTP_PROXY`/`HTTPS_PROXY`. Verify by temporarily running a curl pod in the same namespace.
- DNS: from the workload namespace, confirm `proxyglass.monitor.svc.cluster.local` resolves.

## Security Notes

- The proxy port `3128` is intentionally open inside the cluster; use `NetworkPolicy` if needed.
- Consider enabling `REQUIRE_TOKEN` for `/ui` and `/api/*` if you expose `:9090` via port-forward/ingress.

Example NetworkPolicy: `deploy/networkpolicy-example.yaml`.

## Development

Local run:
```bash
node --experimental-strip-types src/server.ts
```

Tests:
```bash
npm test
```
