#!/usr/bin/env bash
# Deploy v3 to DigitalOcean App Platform.
#
# This script:
#   1. Verifies prerequisites (.env.local, .nibbles-secrets, the DO app exists)
#   2. Switches the DO app's deploy branch to `main` (idempotent — no-op if
#      already pointed there)
#   3. Forces a build + deploy
#   4. Polls deployment phase and prints progress
#   5. Tails the most recent run logs once active
#
# DB schema migration runs inside the DO app's run_command:
#   `npx drizzle-kit push --force && npm start`
#
# This is the only place the v3 schema gets pushed — the DO Postgres
# firewall blocks direct connections from the operator's machine.
#
# Usage:
#   bash scripts/deploy.sh
#
# Operator is expected to have already:
#   - Pushed any pending commits to origin/main
#   - Read the README "Deployment runbook" section

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APP_ID="e3f67164-bc0f-481e-a17d-cb1a33c3c440"
SECRETS="/home/davidr/Desktop/.nibbles-secrets"

# ── Prerequisites ─────────────────────────────────────────────────────────────

if [ ! -f "$SECRETS" ]; then
  echo "ERROR: secrets file missing: $SECRETS" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$SECRETS"
set +a

if [ -z "${DO_API_KEY_WRITE:-}" ] || [ -z "${DO_API_KEY_READONLY:-}" ]; then
  echo "ERROR: DO_API_KEY_WRITE / DO_API_KEY_READONLY not set in secrets file" >&2
  exit 1
fi

# ── Switch deploy branch to main ──────────────────────────────────────────────

echo "[deploy] Setting DO app deploy branch to 'main'..."
python3 <<EOF
import json, urllib.request, os
APP_ID = "$APP_ID"
RO = os.environ["DO_API_KEY_READONLY"]
WR = os.environ["DO_API_KEY_WRITE"]
req = urllib.request.Request(f"https://api.digitalocean.com/v2/apps/{APP_ID}", headers={"Authorization": f"Bearer {RO}"})
spec = json.loads(urllib.request.urlopen(req).read())["app"]["spec"]
current = spec["services"][0]["git"]["branch"]
if current == "main":
    print(f"  branch already 'main' — no-op")
else:
    spec["services"][0]["git"]["branch"] = "main"
    req = urllib.request.Request(
        f"https://api.digitalocean.com/v2/apps/{APP_ID}",
        data=json.dumps({"spec": spec}).encode(),
        method="PUT",
        headers={"Authorization": f"Bearer {WR}", "Content-Type": "application/json"},
    )
    urllib.request.urlopen(req)
    print(f"  branch updated: {current} -> main")
EOF

# ── Force a build + deploy ────────────────────────────────────────────────────

echo "[deploy] Forcing a build + deploy..."
DEPLOY_RESPONSE=$(curl -s -X POST "https://api.digitalocean.com/v2/apps/$APP_ID/deployments" \
  -H "Authorization: Bearer $DO_API_KEY_WRITE" \
  -H "Content-Type: application/json" \
  -d '{"force_build": true}')

DEPLOY_ID=$(echo "$DEPLOY_RESPONSE" | python3 -c "import sys,json; print(json.load(sys.stdin)['deployment']['id'])")
echo "  deployment id: $DEPLOY_ID"

# ── Poll deployment phase ─────────────────────────────────────────────────────

echo "[deploy] Polling deployment phase..."
last_phase=""
attempts=0
max_attempts=60  # 60 * 30s = 30 minutes
while [ "$attempts" -lt "$max_attempts" ]; do
  PHASE=$(curl -s -H "Authorization: Bearer $DO_API_KEY_READONLY" \
    "https://api.digitalocean.com/v2/apps/$APP_ID/deployments/$DEPLOY_ID" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['deployment']['phase'])")

  if [ "$PHASE" != "$last_phase" ]; then
    echo "  $(date +%H:%M:%S) phase: $PHASE"
    last_phase="$PHASE"
  fi

  case "$PHASE" in
    ACTIVE)
      echo "[deploy] Deployment ACTIVE."
      break
      ;;
    ERROR|CANCELED|FAILED)
      echo "[deploy] Deployment $PHASE — see DO console for details" >&2
      exit 1
      ;;
  esac

  attempts=$((attempts + 1))
  sleep 30
done

if [ "$PHASE" != "ACTIVE" ]; then
  echo "[deploy] Timed out waiting for deployment to go ACTIVE (last phase: $PHASE)" >&2
  exit 1
fi

# ── Tail most recent run logs ────────────────────────────────────────────────

echo "[deploy] Tailing last 50 run-log lines..."
echo "================================================================================"
curl -s "https://api.digitalocean.com/v2/apps/$APP_ID/logs?type=RUN&component_name=web&follow=false" \
  -H "Authorization: Bearer $DO_API_KEY_READONLY" \
  | python3 -c "
import sys, json, urllib.request, gzip
d = json.load(sys.stdin)
url = d.get('live_url') or (d.get('historic_urls') or [''])[0]
if not url:
    print('(no log URL returned)')
    sys.exit(0)
data = urllib.request.urlopen(url).read()
text = gzip.decompress(data).decode('utf-8', 'replace') if data[:2] == b'\\x1f\\x8b' else data.decode('utf-8', 'replace')
for line in text.strip().split('\n')[-50:]:
    print(line)
"
echo "================================================================================"
echo "[deploy] Live at: https://huny-money-mfiyo.ondigitalocean.app"
