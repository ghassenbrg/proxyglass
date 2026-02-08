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

Note: this repo intentionally avoids `npm install` at build/runtime; the image runs TypeScript directly via `node --experimental-strip-types`.

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
