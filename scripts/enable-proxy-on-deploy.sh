#!/usr/bin/env bash
set -euo pipefail

ns="${1:-}"
deploy="${2:-}"
client_id="${3:-}"

if [[ -z "${ns}" || -z "${deploy}" || -z "${client_id}" ]]; then
  echo "usage: $0 <namespace> <deployment> <client_id>" >&2
  exit 2
fi

proxy_host="${PROXYGLASS_PROXY_FQDN:-proxyglass.monitor.svc.cluster.local:3128}"
no_proxy="${PROXYGLASS_NO_PROXY:-localhost,127.0.0.1,.svc,.cluster.local,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16}"

kubectl -n "${ns}" set env "deploy/${deploy}" \
  "HTTP_PROXY=http://${proxy_host}" \
  "HTTPS_PROXY=http://${proxy_host}" \
  "NO_PROXY=${no_proxy}" \
  "PROXYGLASS_ID=${client_id}"

echo "enabled proxy env vars on deploy/${deploy} in ns ${ns} (client_id=${client_id})"

