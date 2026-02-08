# proxyglass: Build, Push, Deploy, Use

This guide assumes:

- You can build container images (Docker/BuildKit).
- You can push to a registry your cluster can pull from (or you load images into the cluster).
- You have namespace-scoped access (no cluster-admin required).

## 0) Push The Repo (Git)

Example (GitHub):

```bash
git add -A
git commit -m "proxyglass: initial implementation"
git branch -M main
git remote add origin git@github.com:<org-or-user>/proxyglass.git
git push -u origin main
```

## 1) Build The Image

Local build:

```bash
docker build -t proxyglass:local .
```

Note: the image installs runtime deps (`prom-client`) during `docker build`. The container runs TypeScript directly via `node --experimental-strip-types` (no separate TS build step).

If you are doing local development (not Docker), install deps once:

```bash
npm install
```

Tag for a registry (examples):

```bash
# GHCR
docker tag proxyglass:local ghcr.io/<org-or-user>/proxyglass:v0.1.0

# ECR / GCR / ACR, etc.
docker tag proxyglass:local <registry>/<repo>/proxyglass:v0.1.0
```

## 2) Push The Image

```bash
docker push ghcr.io/<org-or-user>/proxyglass:v0.1.0
```

If your cluster can’t pull from a remote registry, load the image into your local cluster runtime instead (examples):

```bash
# kind
kind load docker-image proxyglass:local

# minikube
minikube image load proxyglass:local
```

## 3) Deploy To Kubernetes

Create namespaces:

```bash
kubectl apply -f examples/00-namespaces.yaml
```

Deploy proxyglass (defaults to `image: proxyglass:local`):

```bash
kubectl -n monitor apply -f deploy/proxyglass.yaml
kubectl -n monitor rollout status deploy/proxyglass
```

If you pushed to a registry, point the Deployment at your image:

```bash
kubectl -n monitor set image deploy/proxyglass proxyglass=ghcr.io/<org-or-user>/proxyglass:v0.1.0
kubectl -n monitor rollout status deploy/proxyglass
```

Verify it’s healthy:

```bash
kubectl -n monitor get pods -l app=proxyglass
kubectl -n monitor logs deploy/proxyglass
```

## 4) Observe Traffic

proxyglass listens on:

- proxy: `:3128`
- mgmt/UI/API/metrics: `:9090`

Clients in any namespace can reach it via:

`proxyglass.monitor.svc.cluster.local:3128`

### Option A: Deploy The Curl Demo

```bash
kubectl -n demo apply -f examples/curl-demo/demo-curl-proxy.yaml
kubectl -n demo rollout status deploy/demo-curl
kubectl -n monitor logs -f deploy/proxyglass
```

### Option B: Enable Proxy On An Existing Deployment (1 command)

```bash
./scripts/enable-proxy-on-deploy.sh <namespace> <deployment> <client_id>
```

Disable:

```bash
./scripts/disable-proxy-on-deploy.sh <namespace> <deployment>
```

## 5) Use The UI (Optional)

Port-forward:

```bash
kubectl -n monitor port-forward svc/proxyglass 9090:9090
```

Open:

`http://127.0.0.1:9090/ui`

If you enable `REQUIRE_TOKEN=true` + `TOKEN=...`, pass it as:

`http://127.0.0.1:9090/ui?token=<TOKEN>`

## 6) Use The In-Pod CLI (Works Even If UI/API Is Not Externally Reachable)

### CLI Overview

`proxyglassctl` is shipped inside the proxyglass container image (available on `PATH`). It talks to the local mgmt API at `http://127.0.0.1:$MGMT_PORT` (default `9090`), so it works reliably via:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl <command> [flags...]
```

If you changed `MGMT_PORT`, the CLI will pick it up from the container environment. You can also override it per-invocation:

```bash
kubectl -n monitor exec deploy/proxyglass -- env MGMT_PORT=9090 proxyglassctl stats
```

### Authentication (If Enabled)

If `REQUIRE_TOKEN=true` is set on proxyglass, you must provide the bearer token to the CLI. Use either `PROXYGLASS_TOKEN` or `TOKEN`:

```bash
kubectl -n monitor exec deploy/proxyglass -- env PROXYGLASS_TOKEN=<TOKEN> proxyglassctl tail
```

If the token is missing or wrong, you’ll see `proxyglassctl: http 401`.

### Commands

`proxyglassctl` supports:

- `tail`: stream events continuously (SSE) with an optional initial backfill
- `search`: one-shot query (no streaming)
- `stats`: top hosts/clients and status distribution
- `help`

### tail (Streaming)

`tail` is the fastest way to “live watch” what a workload is doing.

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail
```

Common flags:

- `--q "<filter expr>"`: filter events (AND, space-separated)
- `--since <cursor|duration>`:
  - cursor: a numeric event cursor (monotonic)
  - duration: `10m`, `30s`, `1h`, `500ms` (relative to now)
- `--limit <n>`: initial backfill size before streaming (default `200`)
- `--pretty`: human-readable output (default is JSON lines)
- `--json`: force JSON lines even if you normally use `--pretty`

Examples:

```bash
# Tail only HTTPS CONNECT to httpbin.org
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --q "scheme=https host=httpbin.org"

# Backfill last 10 minutes then stream
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --since 10m --limit 1000

# Pretty output
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --pretty
```

How cursors work:

- Every stored event has a `cursor` (monotonic increasing integer).
- `/api/events` returns `next_cursor` you can use as a resume point.
- When `tail` starts, it fetches a batch from `/api/events` and then switches to `/api/stream`.

### search (One-Shot)

`search` fetches a finite set of events and exits.

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --since 10m --q "scheme=http method=GET"
```

Time range flags:

- `--since <cursor|duration>`: same semantics as `tail`
- `--from <iso>`: ISO timestamp, e.g. `2026-02-08T12:34:56.789Z`
- `--to <iso>`: ISO timestamp
- `--limit <n>`: max number of returned events (default `2000`)

Examples:

```bash
# HTTPS CONNECTs only (no paths/status, by design)
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --since 30m --q "scheme=https"

# Find all HTTP 5xx for a client over the last hour
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --since 1h --q "scheme=http client=payments-api status_class=5xx"

# Exact ISO window
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --from 2026-02-08T00:00:00.000Z --to 2026-02-08T01:00:00.000Z
```

### stats

`stats` summarizes the in-memory event buffer (respecting the same time range and filter flags).

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl stats --since 30m
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl stats --since 30m --q "client=app-demo"
```

The output includes:

- total matching events
- dropped events (ring-buffer overwrites due to `MAX_EVENTS`)
- top hosts
- top clients
- status distribution (HTTP) and `connect` for CONNECT events

### Filter Expression Reference

Filters are ANDed (space-separated tokens). Quotes are supported for values with spaces:

```bash
--q 'host=httpbin.org method=GET path_contains=/get'
```

Supported tokens:

- `host=example.com`
- `method=GET`
- `scheme=http` or `scheme=https`
- `path_contains=/api` (HTTP only; CONNECT has no path)
- `client=payments-api`
- `status=200` (HTTP only)
- `status_class=2xx` (HTTP only)

Notes:

- `scheme=https` corresponds to `CONNECT` events in proxyglass (no TLS MITM).
- `status` and `status_class` will never match CONNECT events.

### Output Formats

Default output is JSON lines (one full event per line). This is best for piping into tools:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --q "host=httpbin.org" | head
```

Pretty output is intended for humans:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --pretty
```

### Troubleshooting The CLI

- `proxyglassctl: http 401`: token auth enabled; pass `PROXYGLASS_TOKEN`.
- `proxyglassctl: http 503`: proxyglass is not ready yet; check `kubectl -n monitor get pods` and `kubectl -n monitor logs`.
- `proxyglassctl: stream http 401/404/...`: mgmt server not reachable at `127.0.0.1:$MGMT_PORT` inside the container; confirm `MGMT_PORT` and probes.
- Empty results: either the workload isn’t using the proxy, or your filter is too strict. Start with `proxyglassctl tail` with no `--q`.

Tail:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl tail --q "scheme=https host=httpbin.org"
```

Search:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl search --since 10m --q "scheme=http method=GET"
```

Stats:

```bash
kubectl -n monitor exec deploy/proxyglass -- proxyglassctl stats --since 30m
```

If mgmt auth is enabled, set a token for the CLI:

```bash
kubectl -n monitor exec deploy/proxyglass -- env PROXYGLASS_TOKEN=<TOKEN> proxyglassctl tail
```

## 7) Getting Client IDs To Show Up Correctly

Because proxyglass is a network proxy (not a sidecar), it cannot read client pod env vars directly.

Supported ways to label traffic:

1. `X-Proxyglass-Id: <id>` header (recommended if you can add it).
2. Proxy username via `Proxy-Authorization: Basic ...` (many HTTP stacks emit this if the proxy URL includes a username).

Examples:

```bash
# curl: send header
curl -fsS --proxy http://proxyglass.monitor.svc.cluster.local:3128 \
  --proxy-header "X-Proxyglass-Id: payments-api" \
  http://httpbin.org/get

# curl: use proxy user (sets Proxy-Authorization)
curl -fsS --proxy http://proxyglass.monitor.svc.cluster.local:3128 \
  --proxy-user "payments-api:" \
  http://httpbin.org/get
```

## 8) Optional: Capture HTTP Request/Response Details

By default proxyglass logs metadata only.

For **HTTP only** (not HTTPS CONNECT), you can enable capture in `deploy/proxyglass.yaml` ConfigMap:

- `CAPTURE_HTTP_HEADERS=true` (redacts common sensitive headers)
- `CAPTURE_HTTP_BODY_BYTES=4096` (captures truncated body previews)
- `CAPTURE_HTTP_BODY_TEXT=true` (adds `preview_text` for text-like content-types)

This data appears in:

- stdout JSON logs
- `/api/events`
- `/ui` (expand “raw event”)
- `proxyglassctl tail/search`

## 9) Security / NetworkPolicy

- If you expose `:9090` beyond a port-forward, enable `REQUIRE_TOKEN=true` + `TOKEN=...`.
- Restrict ingress to `:3128` with NetworkPolicy if needed: `deploy/networkpolicy-example.yaml`.
