#!/usr/bin/env bash
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/srv/qiaichemy-backend}"
SERVICE_NAME="${SERVICE_NAME:-qiaichemy-backend}"
SYSTEMD_SCOPE="${SYSTEMD_SCOPE:-system}"

if [[ "${DEPLOY_PATH}" == "/" ]]; then
  echo "[deploy] DEPLOY_PATH must not be /" >&2
  exit 1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "[deploy] rsync is required on the runner host" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[deploy] npm is required on the runner host" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "[deploy] syncing repository to ${DEPLOY_PATH}"
mkdir -p "${DEPLOY_PATH}"
rsync -a --delete \
  --exclude ".env" \
  --exclude ".git/" \
  --exclude ".github/" \
  --exclude ".idea/" \
  --exclude "dist/" \
  --exclude "node_modules/" \
  --exclude "reports/" \
  "${REPO_ROOT}/" "${DEPLOY_PATH}/"

cd "${DEPLOY_PATH}"

if [[ ! -f ".env" ]]; then
  echo "[deploy] missing ${DEPLOY_PATH}/.env" >&2
  exit 1
fi

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] building application"
npm run build

if [[ "${SYSTEMD_SCOPE}" == "none" ]]; then
  echo "[deploy] build complete; skipping service restart because SYSTEMD_SCOPE=none"
  exit 0
fi

SYSTEMD_ARGS=()
if [[ "${SYSTEMD_SCOPE}" == "user" ]]; then
  SYSTEMD_ARGS+=(--user)
  echo "[deploy] restarting user service ${SERVICE_NAME}.service"
  systemctl "${SYSTEMD_ARGS[@]}" restart "${SERVICE_NAME}.service"
  systemctl "${SYSTEMD_ARGS[@]}" status "${SERVICE_NAME}.service" --no-pager
  exit 0
fi

if [[ "${SYSTEMD_SCOPE}" != "system" ]]; then
  echo "[deploy] unsupported SYSTEMD_SCOPE=${SYSTEMD_SCOPE}; use system, user, or none" >&2
  exit 1
fi

echo "[deploy] restarting system service ${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"
sudo systemctl status "${SERVICE_NAME}.service" --no-pager
