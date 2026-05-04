#!/usr/bin/env bash
# Enforces critical-path safety rules:
#
# 1. `positions` and `orders` schema tables: only the mode-aware helpers in
#    src/lib/db/queries/positions.ts and orders.ts may query them. Per
#    STRATEGY.md §13.3 — a direct query without mode filtering can silently
#    return mixed paper+live rows, corrupting P&L and reconciliation.
#
# 2. `coinbase/orders` (low-level order placement methods): only
#    src/lib/execution/live-executor.ts may import. Per STRATEGY.md §13.2 —
#    the file-level isolation between live and paper executors is what makes
#    paper-mode safety provable rather than just "we tested it".
#
# To intentionally bypass for analytics/diagnostics, use the
# `positionsAllModes()` / `ordersAllModes()` helpers in those query files —
# they are the only sanctioned cross-mode access pattern.

set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

VIOLATIONS=0

# ---------------------------------------------------------------------------
# Rule 1: positions/orders DB queries
# ---------------------------------------------------------------------------

DB_ALLOWED=(
  "src/lib/db/schema.ts"
  "src/lib/db/index.ts"
  "src/lib/db/utils.ts"
  "src/lib/db/queries/positions.ts"
  "src/lib/db/queries/orders.ts"
)

DB_ALLOWED_RX="$(printf '%s\n' "${DB_ALLOWED[@]}" | paste -sd '|' -)"

search_db() {
  grep -rEn --include='*.ts' --include='*.tsx' "$1" src 2>/dev/null \
    | grep -Ev "^($DB_ALLOWED_RX):" \
    || true
}

echo "Checking for direct schema imports of positions/orders..."
IMPORT_VIOLATORS="$(search_db '(import|from)[^;]*\b(positions|orders)\b[^;]*db/schema')"
if [ -n "$IMPORT_VIOLATORS" ]; then
  echo "ERROR: Direct schema import of positions/orders detected outside allowed files:"
  echo "$IMPORT_VIOLATORS" | sed 's/^/  - /'
  echo ""
  echo "Use mode-aware helpers from src/lib/db/queries/positions.ts or orders.ts instead."
  echo "If this is a legitimate cross-mode analytics query, add it to the queries file"
  echo "and use positionsAllModes() / ordersAllModes() (intentionally rare and grep-able)."
  VIOLATIONS=$((VIOLATIONS+1))
fi

echo "Checking for direct from(positions) / from(orders) usage..."
USAGE_VIOLATORS="$(search_db '\.from\(\s*(positions|orders)\b')"
if [ -n "$USAGE_VIOLATORS" ]; then
  echo "ERROR: Direct from(positions) or from(orders) usage outside allowed files:"
  echo "$USAGE_VIOLATORS" | sed 's/^/  - /'
  VIOLATIONS=$((VIOLATIONS+1))
fi

echo "Checking for direct db.update/insert/delete on positions/orders..."
MUTATE_VIOLATORS="$(search_db '\b(update|insert|delete)\(\s*(positions|orders)\b')"
if [ -n "$MUTATE_VIOLATORS" ]; then
  echo "ERROR: Direct db.update/insert/delete on positions/orders outside allowed files:"
  echo "$MUTATE_VIOLATORS" | sed 's/^/  - /'
  VIOLATIONS=$((VIOLATIONS+1))
fi

# ---------------------------------------------------------------------------
# Rule 2: coinbase/orders (order placement methods)
# ---------------------------------------------------------------------------

ORDERS_ALLOWED=(
  "src/lib/execution/live-executor.ts"
  "src/lib/coinbase/orders.ts"
)

ORDERS_ALLOWED_RX="$(printf '%s\n' "${ORDERS_ALLOWED[@]}" | paste -sd '|' -)"

search_orders() {
  grep -rEn --include='*.ts' --include='*.tsx' "$1" src 2>/dev/null \
    | grep -Ev "^($ORDERS_ALLOWED_RX):" \
    || true
}

echo "Checking that coinbase/orders is only imported by live-executor.ts..."
ORDER_IMPORT_VIOLATORS="$(search_orders 'from\s+["'\''"][^"'\''"]*coinbase/orders["'\''"]')"
if [ -n "$ORDER_IMPORT_VIOLATORS" ]; then
  echo "ERROR: coinbase/orders imported outside allowed files:"
  echo "$ORDER_IMPORT_VIOLATORS" | sed 's/^/  - /'
  echo ""
  echo "Per STRATEGY.md §13.2, only src/lib/execution/live-executor.ts may import"
  echo "the low-level Coinbase order placement methods. Paper mode safety depends on"
  echo "this isolation being enforced at the file level — not just at runtime."
  VIOLATIONS=$((VIOLATIONS+1))
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

if [ "$VIOLATIONS" -eq 0 ]; then
  echo "OK — no direct positions/orders access or coinbase/orders imports outside allowed files."
  exit 0
fi

echo ""
echo "Total violations: $VIOLATIONS"
exit 1
