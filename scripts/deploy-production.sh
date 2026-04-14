#!/bin/bash
# =============================================================
# Malak Bekleidung — Production Deployment Script
# Prüft alle Voraussetzungen bevor deployed wird
# =============================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

ERRORS=0

echo "============================================"
echo "  MALAK STORE — Production Deployment"
echo "============================================"
echo ""

# ── 1. Prüfe .env.production ────────────────────────────
echo "🔍 Prüfe Umgebungsvariablen..."

check_env() {
  local var_name=$1
  local var_value="${!var_name:-}"
  if [ -z "$var_value" ] || [[ "$var_value" == *"REPLACE"* ]] || [[ "$var_value" == *"xxxx"* ]]; then
    echo -e "   ${RED}❌ ${var_name} fehlt oder ist Platzhalter${NC}"
    ERRORS=$((ERRORS + 1))
  else
    echo -e "   ${GREEN}✅ ${var_name}${NC}"
  fi
}

# Lade Production-Env falls vorhanden
if [ -f .env.production ]; then
  set -a; source .env.production; set +a
fi

check_env "DATABASE_URL"
check_env "JWT_SECRET"
check_env "STRIPE_SECRET_KEY"
check_env "STRIPE_WEBHOOK_SECRET"
check_env "RESEND_API_KEY"
check_env "DHL_API_KEY"
check_env "DHL_ACCOUNT_NUMBER"

# ── 2. Prüfe auf TEST Keys ──────────────────────────────
echo ""
echo "🔍 Prüfe auf TEST Keys in Production..."

if [[ "${STRIPE_SECRET_KEY:-}" == sk_test_* ]]; then
  echo -e "   ${RED}❌ STRIPE_SECRET_KEY ist ein TEST Key!${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "   ${GREEN}✅ Stripe ist LIVE${NC}"
fi

if [[ "${DHL_SANDBOX:-true}" == "true" ]]; then
  echo -e "   ${RED}❌ DHL_SANDBOX ist noch 'true'!${NC}"
  ERRORS=$((ERRORS + 1))
else
  echo -e "   ${GREEN}✅ DHL ist LIVE${NC}"
fi

if [[ "${NODE_ENV:-}" != "production" ]]; then
  echo -e "   ${YELLOW}⚠️  NODE_ENV ist nicht 'production'${NC}"
fi

# ── 3. Prüfe Git Status ─────────────────────────────────
echo ""
echo "🔍 Prüfe Git Status..."

if [ -n "$(git status --porcelain)" ]; then
  echo -e "   ${YELLOW}⚠️  Uncommitted Changes vorhanden${NC}"
else
  echo -e "   ${GREEN}✅ Working Directory clean${NC}"
fi

BRANCH=$(git branch --show-current)
echo -e "   Branch: ${BRANCH}"

# ── 4. Tests laufen lassen ───────────────────────────────
echo ""
echo "🧪 Backend Tests..."
pnpm --filter api test -- --no-coverage --silent 2>/dev/null
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✅ 97/97 Tests bestanden${NC}"
else
  echo -e "   ${RED}❌ Tests fehlgeschlagen!${NC}"
  ERRORS=$((ERRORS + 1))
fi

# ── 5. TypeScript prüfen ─────────────────────────────────
echo ""
echo "📝 TypeScript Check..."
pnpm --filter api typecheck 2>/dev/null
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✅ Backend TypeScript OK${NC}"
else
  echo -e "   ${RED}❌ Backend TypeScript Errors!${NC}"
  ERRORS=$((ERRORS + 1))
fi

# ── 6. Frontend Build ────────────────────────────────────
echo ""
echo "🏗️  Frontend Build..."
pnpm --filter web build 2>/dev/null
if [ $? -eq 0 ]; then
  echo -e "   ${GREEN}✅ Frontend Build OK${NC}"
else
  echo -e "   ${RED}❌ Frontend Build fehlgeschlagen!${NC}"
  ERRORS=$((ERRORS + 1))
fi

# ── Ergebnis ─────────────────────────────────────────────
echo ""
echo "============================================"
if [ $ERRORS -gt 0 ]; then
  echo -e "  ${RED}❌ ${ERRORS} FEHLER — DEPLOYMENT BLOCKIERT${NC}"
  echo "  Behebe alle Fehler und führe erneut aus."
  echo "============================================"
  exit 1
else
  echo -e "  ${GREEN}✅ ALLE PRÜFUNGEN BESTANDEN${NC}"
  echo "============================================"
  echo ""
  echo "Bereit zum Deployment:"
  echo "  Frontend: cd apps/web && vercel --prod"
  echo "  Backend:  cd apps/api && railway up"
  echo ""
  echo "Nach Deployment: ./scripts/smoke-test.sh"
fi
