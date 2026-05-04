#!/usr/bin/env bash
# Enforces that `positions` and `orders` tables are only queried through the
# mode-aware helpers in src/lib/db/queries/positions.ts and orders.ts.
#
# Per STRATEGY.md §13.3, this is a critical safety rule: a direct query
# without mode filtering can silently return mixed paper+live rows, corrupting
# P&L computation and reconciliation logic.
#
# To intentionally bypass for analytics/diagnostics, use the
# `positionsAllModes()` / `ordersAllModes()` helpers in those query files —
# they are the only sanctioned cross-mode access pattern.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VIOLATIONS=0

# Allowed importer files (the only places that may reference the schema tables directly).
ALLOWED=(
  "src/lib/db/schema.ts"
  "src/lib/db/index.ts"
  "src/lib/db/utils.ts"
  "src/lib/db/queries/positions.ts"
  "src/lib/db/queries/orders.ts"
)

# Build a regex that matches lines like "src/lib/db/schema.ts:..." for the allowed files.
# Forward slashes are not metacharacters in ERE so no escaping is needed.
ALLOWED_RX="$(printf '%s\n' "${ALLOWED[@]}" | paste -sd '|' -)"

# Search src/ for forbidden patterns. Returns matching "file:line" entries excluding allowed files.
search() {
  local pattern="$1"
  grep -rEn --include='*.ts' --include='*.tsx' "$pattern" src 2>/dev/null \
    | grep -Ev "^($ALLOWED_RX):" \
    || true
}

# Pattern 1: imports that pull `positions` or `orders` from the schema module.
echo "Checking for direct schema imports of positions/orders..."
IMPORT_VIOLATORS="$(search '(import|from)[^;]*\b(positions|orders)\b[^;]*db/schema')"
if [ -n "$IMPORT_VIOLATORS" ]; then
  echo "ERROR: Direct schema import of positions/orders detected outside allowed files:"
  echo "$IMPORT_VIOLATORS" | sed 's/^/  - /'
  echo ""
  echo "Use mode-aware helpers from src/lib/db/queries/positions.ts or orders.ts instead."
  echo "If this is a legitimate cross-mode analytics query, add it to the queries file"
  echo "and use positionsAllModes() / ordersAllModes() (intentionally rare and grep-able)."
  VIOLATIONS=$((VIOLATIONS+1))
fi

# Pattern 2: Drizzle query usage `from(positions)` or `from(orders)`.
echo "Checking for direct from(positions) / from(orders) usage..."
USAGE_VIOLATORS="$(search '\.from\(\s*(positions|orders)\b')"
if [ -n "$USAGE_VIOLATORS" ]; then
  echo "ERROR: Direct from(positions) or from(orders) usage outside allowed files:"
  echo "$USAGE_VIOLATORS" | sed 's/^/  - /'
  VIOLATIONS=$((VIOLATIONS+1))
fi

# Pattern 3: db.update(positions) / db.insert(orders) / db.delete(...).
echo "Checking for direct db.update/insert/delete on positions/orders..."
MUTATE_VIOLATORS="$(search '\b(update|insert|delete)\(\s*(positions|orders)\b')"
if [ -n "$MUTATE_VIOLATORS" ]; then
  echo "ERROR: Direct db.update/insert/delete on positions/orders outside allowed files:"
  echo "$MUTATE_VIOLATORS" | sed 's/^/  - /'
  VIOLATIONS=$((VIOLATIONS+1))
fi

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "OK — no direct positions/orders access outside allowed files."
  exit 0
fi

echo ""
echo "Total violations: $VIOLATIONS"
exit 1
