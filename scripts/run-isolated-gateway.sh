#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SANDBOX="$ROOT/.sandbox"
STATE_DIR="$SANDBOX/state"
CONFIG_PATH="$SANDBOX/openclaw.json"
PORT="${1:-19001}"

mkdir -p "$STATE_DIR" "$SANDBOX"

cat > "$CONFIG_PATH" <<JSON
{
  "plugins": {
    "allow": ["memory-context"],
    "slots": { "memory": "memory-context" },
    "entries": {
      "memory-context": {
        "enabled": true,
        "config": {
          "targetUtilization": 1,
          "zeroShiftEnabled": true,
          "quantumAnchorsEnabled": true,
          "persistenceEnabled": true,
          "predictiveAssemblyEnabled": true,
          "statePath": "$STATE_DIR/plugin-state.db"
        }
      }
    }
  },
  "agents": {
    "defaults": { "model": "openai-codex/gpt-5.4" }
  }
}
JSON

echo "[memory-context isolated gateway]"
echo "config: $CONFIG_PATH"
echo "state:  $STATE_DIR"
echo "port:   $PORT"

env \
  OPENCLAW_CONFIG_PATH="$CONFIG_PATH" \
  OPENCLAW_STATE_DIR="$STATE_DIR" \
  openclaw gateway --port "$PORT"
