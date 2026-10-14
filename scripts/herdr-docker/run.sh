#!/usr/bin/env bash
# Run with the checkout mounted read-only at /src. All installs live in /tmp.
set -euo pipefail
cd /src
go test ./cmd/pairfob ./internal/runtime ./internal/daemon ./internal/mux ./internal/phone
go test -race ./cmd/pairfob ./internal/runtime -run 'Herdr|Setup|Install' -count=1
go build -o /tmp/pairfob-candidate ./cmd/pairfob
# Installation and upgrades must work as a regular user, without sudo.
id pairfob-test >/dev/null 2>&1 || useradd --create-home --uid 1000 pairfob-test
runuser -u pairfob-test -- python3 scripts/herdr-docker/scenarios.py
export HERDR_BIN=/tmp/pairfob-docker-home/.local/bin/herdr
export PATH="/tmp/pairfob-docker-home/.local/bin:$PATH"
PAIRFOB_TEST_REAL_HERDR_BOOTSTRAP=1 go test ./internal/runtime -run TestRealHerdrBootstrapWhenRequested -v -count=1
PAIRFOB_TEST_HERDR_DOWNLOAD=1 go test ./cmd/pairfob -run TestLatestHerdrDownloadWhenRequested -v -count=1
