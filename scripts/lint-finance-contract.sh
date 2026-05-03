#!/usr/bin/env bash
#
# Finance contract lint — forbids local `gross - net` derivation in the
# admin finance UI. Codifies the architectural contract introduced for
# the tax-phantom bug fix:
#
#   "The backend is the single authority for every tax figure.
#    Frontend MUST consume cur.tax / d.tax / today.tax directly.
#    Local derivation `gross - net` is FORBIDDEN — it only holds
#    pre-refund and silently breaks once refunds are applied."
#
# Background:
#   The May 2026 phantom-tax bug had the right backend math but wrong
#   frontend display because monthly-tab.tsx local-derived
#   totalTax = totalGross - totalNet. After the backend started refund-
#   adjusting net, that derivation produced 24.99 € phantom Finanzamt
#   liability instead of the correct 0.00 €.
#
# Scope:
#   apps/web/src/components/admin/finance/
#   apps/web/src/app/[locale]/admin/finance/
#
# Allowlist (legitimate patterns NOT flagged):
#   - `gross - refunds` (gross-level netRevenue, different semantic)
#   - `totalGross - refunds` (same)
#   - Any use of `deriveMonthlyDisplayValues` / `deriveDailyVatPerRow`
#     from @/lib/finance-display (the contract-compliant helper).
#
# Exit codes:
#   0 — no forbidden patterns found
#   1 — at least one forbidden pattern (CI should block merge)
#   2 — script invocation error (e.g. missing scope dirs)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE_DIRS=(
  "$REPO_ROOT/apps/web/src/components/admin/finance"
  "$REPO_ROOT/apps/web/src/app/[locale]/admin/finance"
)

# Forbidden patterns. Each entry: <regex>|<human-readable description>
FORBIDDEN=(
  '\.gross[[:space:]]*[-][[:space:]]*[a-zA-Z_]*\.net|gross-net derivation (use cur.tax / d.tax instead)'
  '\.net[[:space:]]*[-][[:space:]]*[a-zA-Z_]*\.gross|net-gross derivation (use cur.tax / d.tax instead)'
  'totalGross[[:space:]]*[-][[:space:]]*totalNet|totalGross - totalNet derivation (use display.totalTax instead)'
  'totalNet[[:space:]]*[-][[:space:]]*totalGross|totalNet - totalGross derivation (use display.totalTax instead)'
  '[gG]ross[[:space:]]*[-][[:space:]]*[nN]et|generic gross - net derivation (use backend tax field)'
)

# Verify scope dirs exist
for dir in "${SCOPE_DIRS[@]}"; do
  if [ ! -d "$dir" ]; then
    echo "[lint-finance-contract] ERROR: scope directory not found: $dir" >&2
    exit 2
  fi
done

VIOLATIONS=0
echo "[lint-finance-contract] Scanning for forbidden gross-net derivation patterns..."

for entry in "${FORBIDDEN[@]}"; do
  pattern="${entry%%|*}"
  description="${entry##*|}"

  # Use grep -rEn across all scope dirs. Filter out the helper file
  # itself (which legitimately documents the forbidden pattern in
  # JSDoc comments) and any allowlist patterns.
  if matches=$(
    grep -rEn "$pattern" "${SCOPE_DIRS[@]}" \
      --include='*.ts' --include='*.tsx' \
    2>/dev/null \
    | grep -v 'gross[[:space:]]*-[[:space:]]*refunds' \
    | grep -v 'totalGross[[:space:]]*-[[:space:]]*refunds' \
    | grep -v 'finance-display' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*//' \
    | grep -vE '^[^:]+:[0-9]+:[[:space:]]*\*'
  ); then
    if [ -n "$matches" ]; then
      echo ""
      echo "[lint-finance-contract] ❌ FORBIDDEN PATTERN: $description"
      echo "$matches" | sed 's/^/    /'
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  fi
done

echo ""
if [ "$VIOLATIONS" -eq 0 ]; then
  echo "[lint-finance-contract] ✅ No forbidden patterns. Contract upheld."
  exit 0
else
  echo "[lint-finance-contract] ❌ $VIOLATIONS forbidden pattern(s) found."
  echo ""
  echo "Architectural contract: backend is single authority for tax/net."
  echo "Use deriveMonthlyDisplayValues / deriveDailyVatPerRow from"
  echo "@/lib/finance-display instead of computing tax via gross - net."
  exit 1
fi
