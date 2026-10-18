#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "--pwa-only" && $# == 2 ]]; then
  bun "$ROOT/scripts/pwa-release-scope.ts" "$2"
  exec bash "$ROOT/scripts/verify-web.sh"
elif [[ $# != 0 ]]; then
  echo "usage: $0 [--pwa-only <previously-verified-commit>]" >&2
  exit 2
fi

unformatted="$(gofmt -l ./cmd ./internal)"
if [[ -n "$unformatted" ]]; then
  echo "gofmt required:" >&2
  echo "$unformatted" >&2
  exit 1
fi

bash -n "$ROOT/scripts/install.sh"
bash -n "$ROOT/scripts/release.sh"
bash -n "$ROOT/scripts/pack-origin-assets.sh"
bash -n "$ROOT/scripts/ship-guard.sh"
bash -n "$ROOT/scripts/verify-web.sh"
bash -n "$ROOT/scripts/dev-acme.sh"
bash -n "$ROOT/scripts/dev-up.sh"
bash -n "$ROOT/scripts/dev-down.sh"
bash -n "$ROOT/plugin/herdr/open-pane.sh"
bash -n "$ROOT/plugin/herdr/pairfob.sh"

jq empty proto/pairfob-vectors.json proto/pgp-words.json proto/rpc.schema.json
go vet ./...

# An android GOOS build links pion's interface fallback, which aliases a net
# symbol whose definition changed; the deferred path never touches it and the
# flag only relaxes the link check. Termux tests otherwise fail to build.
test_flags=()
if [[ "$(go env GOOS)" == "android" ]]; then
  test_flags+=("-ldflags=-checklinkname=0")
fi
go test "${test_flags[@]}" ./...
if [[ "$(go env GOOS)" == "android" ]]; then
  echo "verify: skipping go test -race; the race detector has no android/arm64 runtime" >&2
else
  go test -race "${test_flags[@]}" ./...
fi
go run golang.org/x/vuln/cmd/govulncheck@v1.7.0 ./...
bun test scripts/load-mux.test.ts
bun test scripts/dev-acme.test.ts
bun test scripts/ship-guard.test.ts
bun test scripts/pwa-release-scope.test.ts
bun test plugin/herdr/plugin.test.ts
(cd "$ROOT/site/doc" && bun test)

bash "$ROOT/scripts/verify-web.sh"
