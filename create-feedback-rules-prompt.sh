#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MYSQL_HOST="${MYSQL_HOST:-127.0.0.1}"
MYSQL_PORT="${MYSQL_PORT:-3307}"
MYSQL_USER="${MYSQL_USER:-thomas}"
MYSQL_DATABASE="${MYSQL_DATABASE:-prod}"
MYSQL_CONNECT_TIMEOUT="${MYSQL_CONNECT_TIMEOUT:-2}"
CODEX_MCP_PACKAGE="${CODEX_MCP_PACKAGE:-chrome-devtools-mcp@latest}"
JUMP_HOST="${JUMP_HOST:-ec2-user@devweb.vpng.io}"
JUMP_HOST_KEY="${JUMP_HOST_KEY:-}"
RULES_FILE="${RULES_FILE:-src/data/rules.js}"
CODEX_BIN=""

CHECK_CHROME_MCPS=1
FETCH_ONLY=0
RUN_CODEX=0
START_TUNNEL=1
LIMIT=""
URLS_FILE="$(mktemp "${TMPDIR:-/tmp}/isdcac-feedback-urls.XXXXXX")"

usage() {
  cat <<'EOF'
Usage: ./create-feedback-rules-prompt.sh [options]

Create a Codex prompt from recent popup feedback URLs.

Options:
  --fetch-only         Only print fetched URLs; do not print the Codex prompt
  --no-chrome-mcp      Skip installing/checking chrome-devtools-a/b/c/d
  --no-start-tunnel    Do not start the SSH tunnel if 127.0.0.1:3307 is closed
  --run-codex          Run codex exec with the generated prompt instead of printing it
  --jump-key PATH      SSH private key for the jump host
  --rules-file PATH    Rules file to update, default: src/data/rules.js
  --limit NUMBER       Limit rows, useful while testing
  -h, --help           Show this help

Environment:
  MYSQL_HOST           MySQL host, default: 127.0.0.1
  MYSQL_PORT           MySQL port, default: 3307
  MYSQL_USER           MySQL user, default: thomas
  MYSQL_DATABASE       MySQL database, default: prod
  CODEX_MCP_PACKAGE    Chrome MCP npm package, default: chrome-devtools-mcp@latest
  JUMP_HOST            SSH jump host, default: ec2-user@devweb.vpng.io
  JUMP_HOST_KEY        SSH private key path; optional if ~/.ssh/config or agent works
  RULES_FILE           Rules file to update, default: src/data/rules.js
  PROD_DB_PASSWORD     Production MySQL password for this script
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fetch-only)
      FETCH_ONLY=1
      shift
      ;;
    --no-chrome-mcp)
      CHECK_CHROME_MCPS=0
      shift
      ;;
    --no-start-tunnel)
      START_TUNNEL=0
      shift
      ;;
    --run-codex)
      RUN_CODEX=1
      shift
      ;;
    --jump-key)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "--jump-key must be followed by a path" >&2
        exit 1
      fi
      JUMP_HOST_KEY="$2"
      shift 2
      ;;
    --rules-file)
      if [[ $# -lt 2 || -z "$2" ]]; then
        echo "--rules-file must be followed by a path" >&2
        exit 1
      fi
      RULES_FILE="$2"
      shift 2
      ;;
    --limit)
      if [[ $# -lt 2 || ! "$2" =~ ^[0-9]+$ || "$2" -lt 1 ]]; then
        echo "--limit must be followed by a positive integer" >&2
        exit 1
      fi
      LIMIT="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

ensure_chrome_mcp_worker() {
  local name="$1"

  if "$CODEX_BIN" mcp get "$name" >/dev/null 2>&1; then
    return
  fi

  echo "Adding missing Codex MCP worker: ${name}" >&2
  "$CODEX_BIN" mcp add "$name" -- npx "$CODEX_MCP_PACKAGE" --headless=true --isolated=true >/dev/null
}

ensure_codex_cli() {
  if command -v codex >/dev/null 2>&1; then
    CODEX_BIN="$(command -v codex)"
    return
  fi

  if [[ -x "$SCRIPT_DIR/node_modules/.bin/codex" ]]; then
    CODEX_BIN="$SCRIPT_DIR/node_modules/.bin/codex"
    return
  fi

  echo "codex CLI is not installed. Run npm install, then rerun this command." >&2
  exit 1
}

ensure_chrome_mcps() {
  ensure_codex_cli

  ensure_chrome_mcp_worker "chrome-devtools-a"
  ensure_chrome_mcp_worker "chrome-devtools-b"
  ensure_chrome_mcp_worker "chrome-devtools-c"
  ensure_chrome_mcp_worker "chrome-devtools-d"
}

port_is_open() {
  nc -z -w "$MYSQL_CONNECT_TIMEOUT" "$MYSQL_HOST" "$MYSQL_PORT" >/dev/null 2>&1
}

expand_home_path() {
  case "$1" in
    "~") echo "$HOME" ;;
    "~/"*) echo "$HOME/${1#~/}" ;;
    *) echo "$1" ;;
  esac
}

default_jump_key() {
  local default_key="$HOME/.ssh/jump_host_key"
  if [[ -f "$default_key" ]]; then
    echo "$default_key"
  fi
}

start_tunnel() {
  local ssh_args=("-f" "-N" "-L" "${MYSQL_PORT}:readonly.rds.vpng.io:3306")
  local key_path=""

  if [[ -n "$JUMP_HOST_KEY" ]]; then
    key_path="$(expand_home_path "$JUMP_HOST_KEY")"
    if [[ ! -f "$key_path" ]]; then
      echo "Jump host key not found: ${key_path}" >&2
      exit 1
    fi
  else
    key_path="$(default_jump_key)"
  fi

  if [[ -n "$key_path" ]]; then
    echo "Starting SSH tunnel using key: ${key_path}" >&2
    ssh_args=("-i" "$key_path" "${ssh_args[@]}")
  else
    echo "Starting SSH tunnel using ssh config, ssh-agent, or default ~/.ssh keys." >&2
  fi

  ssh "${ssh_args[@]}" "$JUMP_HOST"
}

if [[ "$CHECK_CHROME_MCPS" -eq 1 ]]; then
  ensure_chrome_mcps
fi

if ! port_is_open; then
  if [[ "$START_TUNNEL" -ne 1 ]]; then
    echo "Could not connect to MySQL at ${MYSQL_HOST}:${MYSQL_PORT}." >&2
    echo "Start the SSH tunnel first, or rerun without --no-start-tunnel." >&2
    exit 1
  fi

  start_tunnel

  if ! port_is_open; then
    echo "Started the tunnel, but MySQL is still not reachable at ${MYSQL_HOST}:${MYSQL_PORT}." >&2
    exit 1
  fi
fi

if [[ -z "${PROD_DB_PASSWORD:-}" && -f "$HOME/.zshrc" ]]; then
  PROD_DB_PASSWORD="$(zsh -lc 'source ~/.zshrc >/dev/null 2>&1; printf "%s" "${PROD_DB_PASSWORD:-}"')"
  export PROD_DB_PASSWORD
fi

if [[ -z "${PROD_DB_PASSWORD:-}" ]]; then
  echo "PROD_DB_PASSWORD is not set. Export it or add it to ~/.zshrc." >&2
  exit 1
fi

QUERY="
SELECT DISTINCT j.url
FROM feedback AS f
JOIN jobs AS j ON f.job_id = j.id
JOIN prod.process AS p ON p.id = f.process_id
WHERE f.reason LIKE '%popup%'
  AND p.created > NOW() - INTERVAL 1 WEEK
  AND f.created > NOW() - INTERVAL 1 WEEK
"

if [[ -n "$LIMIT" ]]; then
  QUERY="${QUERY}
LIMIT ${LIMIT}"
fi

MYSQL_PWD="$PROD_DB_PASSWORD" mysql \
  -u "$MYSQL_USER" \
  -h "$MYSQL_HOST" \
  -P "$MYSQL_PORT" \
  --batch \
  --raw \
  --skip-column-names \
  "$MYSQL_DATABASE" \
  --execute "${QUERY};" > "$URLS_FILE"

if [[ ! -s "$URLS_FILE" ]]; then
  echo "No popup feedback URLs found." >&2
  exit 0
fi

if [[ "$FETCH_ONLY" -eq 1 ]]; then
  cat "$URLS_FILE"
  exit 0
fi

PROMPT_FILE="$(mktemp "${TMPDIR:-/tmp}/isdcac-feedback-rules-prompt.XXXXXX")"

{
  cat <<EOF
Use \$cookie-popup-rule-prover-cdp with rules-file ${RULES_FILE} and urls:
EOF
  cat "$URLS_FILE"
  cat <<'EOF'

These URLs came from recent production feedback mentioning popups. Deduplicate and group domains using the skill workflow. Generate and verify rules with before/after screenshots, only upsert passing actionable domains, and report any blocked, challenged, or failed URLs.
EOF
} > "$PROMPT_FILE"

URL_COUNT="$(wc -l < "$URLS_FILE" | tr -d ' ')"
echo "Fetched ${URL_COUNT} feedback URL(s)." >&2
echo "Generated Codex prompt: ${PROMPT_FILE}" >&2

if [[ "$RUN_CODEX" -eq 1 ]]; then
  ensure_codex_cli
  echo "Running Codex rule prover with generated prompt." >&2
  "$CODEX_BIN" exec --full-auto -C "$SCRIPT_DIR" - < "$PROMPT_FILE"
  exit
fi

cat <<EOF

========== COPY THIS PROMPT INTO CODEX ==========
$(cat "$PROMPT_FILE")
========== END CODEX PROMPT ==========

EOF
