#!/usr/bin/env bash
set -euo pipefail

SECRETS_FILE="${HOME}/Desktop/.nibbles-secrets"
if [[ ! -r "$SECRETS_FILE" ]]; then
  echo "missing or unreadable: $SECRETS_FILE" >&2
  exit 1
fi
set -a; . "$SECRETS_FILE"; set +a

API="https://api.digitalocean.com/v2"
WRITE_HDR=(-H "Authorization: Bearer ${DO_API_KEY_WRITE}")
READ_HDR=(-H "Authorization: Bearer ${DO_API_KEY_READONLY}")

# Check if app already exists
existing=$(
  curl -fsS "${READ_HDR[@]}" "${API}/apps?per_page=200" \
  | python3 -c '
import json, sys
d = json.load(sys.stdin)
for a in d.get("apps", []):
    if a["spec"]["name"] == "huny-money":
        print(a["id"])
        break
'
)
if [[ -n "${existing:-}" ]]; then
  echo "huny-money app already exists: $existing" >&2
  echo "$existing"
  exit 0
fi

CRON_SECRET=$(openssl rand -base64 32)
ANTHROPIC_KEY="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"

SPEC_JSON=$(jq -n \
  --arg cron_secret "$CRON_SECRET" \
  --arg anthropic_key "$ANTHROPIC_KEY" \
  '{
    spec: {
      name: "huny-money",
      region: "nyc",
      services: [{
        name: "web",
        git: {
          repo_clone_url: "https://github.com/masonrogers/huny-money.git",
          branch: "main"
        },
        build_command: "npm run build",
        run_command: "npm start",
        environment_slug: "node-js",
        instance_count: 1,
        instance_size_slug: "basic-xxs",
        http_port: 3000,
        health_check: {
          http_path: "/api/healthz",
          initial_delay_seconds: 60,
          period_seconds: 10,
          timeout_seconds: 5,
          success_threshold: 1,
          failure_threshold: 3
        },
        envs: [
          { key: "NODE_ENV", value: "production", scope: "RUN_AND_BUILD_TIME" },
          { key: "DATABASE_URL", value: "${db.DATABASE_URL}", scope: "RUN_AND_BUILD_TIME" },
          { key: "COINBASE_API_KEY", value: "placeholder", scope: "RUN_TIME", type: "SECRET" },
          { key: "COINBASE_API_SECRET", value: "placeholder", scope: "RUN_TIME", type: "SECRET" },
          { key: "ANTHROPIC_API_KEY", value: $anthropic_key, scope: "RUN_TIME", type: "SECRET" },
          { key: "CRON_SECRET", value: $cron_secret, scope: "RUN_TIME", type: "SECRET" },
          { key: "NPM_CONFIG_PRODUCTION", value: "false", scope: "BUILD_TIME" }
        ]
      }],
      databases: [{
        name: "db",
        engine: "PG",
        cluster_name: "db-postgresql-nyc3-00644",
        db_name: "huny_money",
        db_user: "doadmin",
        production: true
      }]
    }
  }')

resp=$(curl -fsS -X POST "${API}/apps" \
  "${WRITE_HDR[@]}" \
  -H "Content-Type: application/json" \
  -d "$SPEC_JSON")

app_id=$(echo "$resp" | jq -r '.app.id')
echo "created app id=$app_id"
echo "CRON_SECRET=$CRON_SECRET"
echo "$app_id"
