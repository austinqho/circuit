#!/bin/sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
STATE="$ROOT/.m1-live"
SOURCE=${PRODUCTTRACE_M1_SOURCE:-/Users/austinho/dev/trace-consolidated/.live-demo/librechat-m1}
WORKTREE=${PRODUCTTRACE_M1_WORKTREE:-/tmp/producttrace-librechat-m1-live}
BASELINE=${PRODUCTTRACE_M1_BASELINE:-/tmp/producttrace-librechat-m1-live-baseline}
CONFIG="$STATE/librechat.json"
# G1 frontend-only mode: PRODUCTTRACE_BACKEND_TELEMETRY=0 starts the backend
# without the OpenTelemetry preload or span endpoint (the viewer is told the
# same, so its frontier reads "backend not instrumented", never inferred).
BACKEND_TELEMETRY=${PRODUCTTRACE_BACKEND_TELEMETRY:-1}
# PRODUCTTRACE_OPENAI_FIXTURE=1 answers chat with the deterministic local
# OpenAI-compatible fixture on 8999 instead of the key in the fixture .env.
OPENAI_FIXTURE=${PRODUCTTRACE_OPENAI_FIXTURE:-0}
export PRODUCTTRACE_BACKEND_TELEMETRY="$BACKEND_TELEMETRY"
MANIFEST="$CONFIG.attribution.json"
mkdir -p "$STATE"

alive() {
  name=$1
  test -f "$STATE/$name.pid" || return 1
  pid=$(sed -n '1p' "$STATE/$name.pid")
  test -n "$pid" && kill -0 "$pid" 2>/dev/null
}

stop_one() {
  name=$1
  if alive "$name"; then
    pid=$(sed -n '1p' "$STATE/$name.pid")
    kill "$pid" 2>/dev/null || true
    i=0
    while kill -0 "$pid" 2>/dev/null && test "$i" -lt 40; do sleep 0.1; i=$((i + 1)); done
    kill -9 "$pid" 2>/dev/null || true
  fi
  rm -f "$STATE/$name.pid"
}

stop_all() {
  stop_one frontend
  stop_one backend
  stop_one viewer
  stop_one collector
  stop_one openai
  printf '%s\n' 'M1 live services stopped.'
}

if test "${1:-start}" = stop; then
  stop_all
  exit 0
fi
if test "${1:-start}" != start; then
  printf '%s\n' 'usage: scripts/m1-live.sh [start|stop]' >&2
  exit 2
fi

if alive backend && alive frontend && alive viewer && alive collector \
  && curl -fsS http://localhost:3080/health >/dev/null \
  && curl -fsS http://127.0.0.1:3081/ >/dev/null \
  && curl -fsS http://127.0.0.1:8123/fiber-demo >/dev/null \
  && curl -fsS http://127.0.0.1:8787/health >/dev/null \
  && test "$(cat "$STATE/mode" 2>/dev/null)" = "telemetry=$BACKEND_TELEMETRY fixture=$OPENAI_FIXTURE"; then
  printf '%s\n' 'M1 live services are already running.'
  exit 0
fi
stop_all >/dev/null
startup_complete=0
cleanup_failed_start() {
  if test "$startup_complete" -eq 0; then
    printf '%s\n' 'M1 live startup failed; stopping partial services.' >&2
    stop_all >&2
  fi
}
trap cleanup_failed_start EXIT INT TERM

start_process() {
  name=$1
  directory=$2
  shift 2
  # Node's detached spawn creates a new POSIX session (setsid semantics on
  # macOS); nohup protects the short-lived helper itself from shell teardown.
  nohup node "$ROOT/scripts/m1-live-detach.mjs" "$STATE/$name.pid" "$STATE/$name.log" "$directory" "$@" >/dev/null 2>&1 </dev/null
}

wait_url() {
  label=$1
  url=$2
  count=0
  until curl -fsS "$url" >/dev/null 2>&1; do
    count=$((count + 1))
    if test "$count" -ge 240; then
      printf '%s\n' "$label did not become ready: $url" >&2
      exit 1
    fi
    sleep 0.25
  done
}

if ! test -d "$BASELINE/client/dist"; then
  PRODUCTTRACE_DISABLE_PLUGIN=1 node "$ROOT/test/browser/build-librechat-autonomous.mjs" "$SOURCE" "$BASELINE" "$STATE/baseline.json" >"$STATE/baseline-build.log" 2>&1
fi

# The parity gate needs the fixture API while it opens both built clients.
start_process backend "$SOURCE" env HOST=localhost PORT=3080 node api/server/index.js
wait_url backend http://localhost:3080/health

reuse=''
if test -d "$WORKTREE/.git" || test -f "$WORKTREE/.git"; then reuse=1; fi
PRODUCTTRACE_REUSE_WORKTREE="$reuse" \
PRODUCTTRACE_PARITY_DISABLED_ROOT="$BASELINE" \
PRODUCTTRACE_PARITY_OUTPUT="$STATE/parity.json" \
node "$ROOT/test/browser/build-librechat-autonomous.mjs" "$SOURCE" "$WORKTREE" "$CONFIG" >"$STATE/build.log" 2>&1

stop_one backend
if ! test -e "$WORKTREE/.env"; then ln -s "$SOURCE/.env" "$WORKTREE/.env"; fi
start_process viewer "$ROOT" env PRODUCTTRACE_BRIDGE_CONFIG="$CONFIG" PRODUCTTRACE_ATTRIBUTION_MANIFEST="$MANIFEST" PRODUCTTRACE_LIVE_RECORDS="$STATE/runtime-records.jsonl" PRODUCTTRACE_BACKEND_SPANS="$STATE/backend-spans.jsonl" node test/browser/server.mjs 8123
wait_url viewer http://127.0.0.1:8123/fiber-demo
start_process collector "$ROOT" node collector/cli.mjs 8787 "$STATE/collector.jsonl"
wait_url collector http://127.0.0.1:8787/health
fixture_env=''
if test "$OPENAI_FIXTURE" = 1; then
  start_process openai "$ROOT" env PRODUCTTRACE_OPENAI_FIXTURE_PORT=8999 node test/browser/openai-compatible-fixture.mjs
  wait_url openai http://127.0.0.1:8999/v1/models
  # dotenv does not override variables already present in the environment.
  fixture_env='OPENAI_API_KEY=producttrace-fixture OPENAI_REVERSE_PROXY=http://127.0.0.1:8999/v1'
fi
if test "$BACKEND_TELEMETRY" = 0; then
  # shellcheck disable=SC2086
  start_process backend "$WORKTREE" env HOST=localhost PORT=3080 $fixture_env node api/server/index.js
else
  # shellcheck disable=SC2086
  start_process backend "$WORKTREE" env HOST=localhost PORT=3080 $fixture_env PRODUCTTRACE_BACKEND_SPAN_ENDPOINT=http://127.0.0.1:8123/api/demo/runtime-attribution NODE_OPTIONS="--import=$ROOT/test/browser/librechat-backend-telemetry.mjs" node api/server/index.js
fi
wait_url backend http://localhost:3080/health
start_process frontend "$ROOT" env PRODUCTTRACE_BACKEND_ORIGIN=http://localhost:3080 PRODUCTTRACE_VIEWER_ORIGIN=http://127.0.0.1:8123 node scripts/m1-live-frontend.mjs "$WORKTREE/client/dist" 3081
wait_url frontend http://127.0.0.1:3081/

printf '%s\n' "telemetry=$BACKEND_TELEMETRY fixture=$OPENAI_FIXTURE" >"$STATE/mode"
startup_complete=1
trap - EXIT INT TERM
printf '%s\n' \
  'M1 live is running:' \
  '  LibreChat: http://127.0.0.1:3081/' \
  '  Tracer:    http://127.0.0.1:8123/fiber-demo?productPort=3081' \
  '  Collector: http://127.0.0.1:8787/health' \
  "  Backend telemetry: $BACKEND_TELEMETRY; OpenAI fixture: $OPENAI_FIXTURE"
