#!/usr/bin/env bash
set -euo pipefail

ns="${1:-}"
deploy="${2:-}"

if [[ -z "${ns}" || -z "${deploy}" ]]; then
  echo "usage: $0 <namespace> <deployment>" >&2
  exit 2
fi

kubectl -n "${ns}" set env "deploy/${deploy}" \
  HTTP_PROXY- HTTPS_PROXY- NO_PROXY- PROXYGLASS_ID-

echo "disabled proxy env vars on deploy/${deploy} in ns ${ns}"

