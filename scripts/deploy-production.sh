#!/usr/bin/env bash
set -euo pipefail

APP_PATH="${APP_PATH:-/srv/qiaichemy-backend}"
SERVICE_NAME="${SERVICE_NAME:-qiaichemy-backend}"
NODE_VERSION="${NODE_VERSION:-22.13.0}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

if [[ "${APP_PATH}" == "/" ]]; then
  echo "[deploy] APP_PATH must not be /" >&2
  exit 1
fi

cd "${APP_PATH}"

if [[ ! -f ".env" ]]; then
  echo "[deploy] missing ${APP_PATH}/.env" >&2
  exit 1
fi

if [[ -s "${NVM_DIR}/nvm.sh" ]]; then
  # shellcheck disable=SC1090
  source "${NVM_DIR}/nvm.sh"
  nvm install "${NODE_VERSION}" >/dev/null
  nvm use "${NODE_VERSION}" >/dev/null
fi

if ! command -v node >/dev/null 2>&1; then
  echo "[deploy] node is required on the server" >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "[deploy] npm is required on the server" >&2
  exit 1
fi

echo "[deploy] installing dependencies"
npm ci

echo "[deploy] building application"
npm run build

echo "[deploy] restarting system service ${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"
sudo systemctl status "${SERVICE_NAME}.service" --no-pager
