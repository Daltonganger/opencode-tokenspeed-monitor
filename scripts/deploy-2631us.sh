#!/usr/bin/env bash
set -euo pipefail

TARGET_HOST="${TARGET_HOST:-2631US}"
TARGET_DIR="${TARGET_DIR:-/opt/stacks/tokenspeed-hub}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.dockge.yml}"
REPO_URL="${REPO_URL:-https://github.com/Daltonganger/opencode-tokenspeed-monitor.git}"
BRANCH="${BRANCH:-main}"
SKIP_BUILD="${SKIP_BUILD:-0}"

usage() {
  cat <<'EOF'
Usage: scripts/deploy-2631us.sh [--host HOST] [--dir PATH] [--branch BRANCH] [--skip-build]

Deploys TokenSpeed hub to the remote Docker host (default SSH alias: 2631US).

Environment overrides:
  TARGET_HOST   SSH host/alias (default: 2631US)
  TARGET_DIR    Remote stack directory (default: /opt/stacks/tokenspeed-hub)
  REPO_URL      Git repository URL
  BRANCH        Git branch to deploy (default: main)
  COMPOSE_FILE  Compose file name (default: docker-compose.dockge.yml)
  SKIP_BUILD    1 to run docker compose up without --build

Required remote env file:
  ${TARGET_DIR}/.env (must contain at least TS_HUB_ADMIN_TOKEN)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host)
      TARGET_HOST="$2"
      shift 2
      ;;
    --dir)
      TARGET_DIR="$2"
      shift 2
      ;;
    --branch)
      BRANCH="$2"
      shift 2
      ;;
    --skip-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

echo "[deploy] target host: ${TARGET_HOST}"
echo "[deploy] target dir: ${TARGET_DIR}"
echo "[deploy] branch: ${BRANCH}"

remote_script='set -euo pipefail
TARGET_DIR="$1"
REPO_URL="$2"
BRANCH="$3"
COMPOSE_FILE="$4"
SKIP_BUILD="$5"

if [ ! -d "$TARGET_DIR/.git" ]; then
  mkdir -p "$TARGET_DIR"
  git clone "$REPO_URL" "$TARGET_DIR"
fi

cd "$TARGET_DIR"
git fetch --all --prune
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

if [ ! -f .env ]; then
  echo "[deploy] Missing $TARGET_DIR/.env (copy from .env.dockge.example first)" >&2
  exit 1
fi

if ! grep -q "^TS_HUB_ADMIN_TOKEN=" .env; then
  echo "[deploy] Missing TS_HUB_ADMIN_TOKEN in $TARGET_DIR/.env" >&2
  exit 1
fi

if [ "$SKIP_BUILD" = "1" ]; then
  docker compose -f "$COMPOSE_FILE" up -d
else
  docker compose -f "$COMPOSE_FILE" up -d --build
fi

docker compose -f "$COMPOSE_FILE" ps
curl -fsS "http://127.0.0.1:3476/v1/health"'

ssh "$TARGET_HOST" bash -s -- "$TARGET_DIR" "$REPO_URL" "$BRANCH" "$COMPOSE_FILE" "$SKIP_BUILD" <<< "$remote_script"

echo "[deploy] completed successfully"
