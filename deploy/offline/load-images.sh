#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE_DIR="${1:-$ROOT_DIR/docker-images}"

images=(
  "hltg-accounting-backend-amd64.tar"
  "hltg-accounting-frontend-amd64.tar"
)

for image in "${images[@]}"; do
  path="$IMAGE_DIR/$image"
  if [[ ! -f "$path" ]]; then
    echo "Missing image file: $path" >&2
    exit 1
  fi
  echo "Loading $image ..."
  docker load -i "$path"
done

echo
echo "Loaded images:"
docker image ls hltg-accounting-backend:amd64 hltg-accounting-frontend:amd64
