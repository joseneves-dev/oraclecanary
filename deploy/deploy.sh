#!/bin/sh
# Updates the server to the latest main branch and restarts what changed.
# Run from the repository root on the server: ./deploy/deploy.sh
set -e
cd "$(dirname "$0")/.."

git pull --ff-only
docker compose -f deploy/compose.yaml --env-file deploy/.env up -d --build --remove-orphans
docker image prune -f >/dev/null
docker compose -f deploy/compose.yaml --env-file deploy/.env ps
