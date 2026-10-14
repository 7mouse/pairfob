#!/usr/bin/env bash
# A local Wrangler Worker must already be running, with local D1 migrations.
# Set an HTTP origin reachable at the SAME address from Docker and this host.
set -euo pipefail
: "${PAIRFOB_TEST_ORIGIN:?set the local Worker origin reachable from Docker and the host}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$(mktemp -d)"
NAME="pairfob-herdr-live-$$"
cleanup() {
  local result=$?
  if [[ $result != 0 ]]; then cat "$WORK/daemon.log" >&2; fi
  docker rm -f "$NAME" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
cd "$ROOT"
docker run --rm --name "$NAME" -e PAIRFOB_TEST_ORIGIN \
  -v "$ROOT:/src:ro" -v pairfob-herdr-gomod:/go/pkg/mod \
  -v pairfob-herdr-gocache:/root/.cache/go-build pairfob-herdr-test \
  python3 scripts/herdr-docker/live.py > "$WORK/daemon.log" 2>&1 &
container_pid=$!
ready=0
for ((i=0; i<150; i++)); do
  if docker exec "$NAME" cat /tmp/pairfob-live-offer.json > "$WORK/offer.json" 2>/dev/null; then ready=1; break; fi
  if ! kill -0 "$container_pid" 2>/dev/null; then cat "$WORK/daemon.log"; exit 1; fi
  sleep 1
done
if [[ $ready != 1 ]]; then cat "$WORK/daemon.log"; echo 'Docker pairing offer timed out' >&2; exit 1; fi
PAIRFOB_TEST_OFFER="$WORK/offer.json" PAIRFOB_TEST_RELAY="${PAIRFOB_TEST_ORIGIN/http/ws}/v2/ws?role=client" \
  bun scripts/herdr-docker/live-client.ts
docker exec "$NAME" touch /tmp/pairfob-live-done
wait "$container_pid"
echo 'PASS: full local Worker v2 / Docker Herdr chain'
