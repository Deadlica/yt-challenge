#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | grep -v '^\s*$' | xargs)
fi

if [ -z "$DOCKER_IMAGE" ]; then
  echo "Error: DOCKER_IMAGE not set in .env"
  exit 1
fi

TAG=$(date +%Y-%m-%d)

docker build -t "$DOCKER_IMAGE:latest" -t "$DOCKER_IMAGE:$TAG" "$SCRIPT_DIR/.."
docker push "$DOCKER_IMAGE:latest"
docker push "$DOCKER_IMAGE:$TAG"

echo "Pushed $DOCKER_IMAGE:latest and $DOCKER_IMAGE:$TAG"
