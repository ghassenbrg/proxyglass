FROM node:24-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* /app/
# Prefer lockfile if present; fall back to npm install for first-time setup.
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi

FROM node:24-slim AS runtime
WORKDIR /app
COPY --from=deps /app/node_modules /app/node_modules
COPY . /app

# Provide proxyglassctl on PATH (used via kubectl exec).
RUN chmod +x /app/bin/proxyglassctl && ln -sf /app/bin/proxyglassctl /usr/local/bin/proxyglassctl

RUN useradd -u 10001 -m proxyglass && chown -R proxyglass:proxyglass /app
USER proxyglass

EXPOSE 3128 9090
ENV PROXY_PORT=3128 MGMT_PORT=9090 MAX_EVENTS=5000 LOG_FORMAT=json DEFAULT_CLIENT_ID=unknown SAMPLE_RATE=1.0

CMD ["node","--experimental-strip-types","/app/src/server.ts"]
