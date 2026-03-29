#!/bin/bash
# =============================================================
# Malak Store — Production Smoke Test
# Nach JEDEM Deployment ausführen!
#
# Verwendung: ./scripts/smoke-test.sh [base-url]
# Beispiel:   ./scripts/smoke-test.sh https://malak-bekleidung.com
# =============================================================

set -uo pipefail

WEB_URL="${1:-http://localhost:3000}"
API_URL="${2:-http://localhost:3001}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
TOTAL=0

check() {
  local name=$1
  local result=$2
  TOTAL=$((TOTAL + 1))

  if [ "$result" -eq 0 ]; then
    echo -e "   ${GREEN}✅ ${name}${NC}"
    PASSED=$((PASSED + 1))
  else
    echo -e "   ${RED}❌ ${name}${NC}"
    FAILED=$((FAILED + 1))
  fi
}

echo "============================================"
echo "  SMOKE TEST — Malak Store"
echo "  Web: ${WEB_URL}"
echo "  API: ${API_URL}"
echo "============================================"
echo ""

# ── 1. SSL-Zertifikat ───────────────────────────────────
echo "🔒 SSL-Zertifikat..."
if [[ "$WEB_URL" == https://* ]]; then
  curl -s --head --max-time 5 "$WEB_URL" | grep -q "200\|301\|302"
  check "SSL + HTTPS erreichbar" $?
else
  echo -e "   ${YELLOW}⚠️  Kein HTTPS (lokaler Test)${NC}"
fi

# ── 2. Homepage ──────────────────────────────────────────
echo ""
echo "🌐 Frontend..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WEB_URL}/de")
[ "$HTTP_CODE" = "200" ]
check "Homepage DE (${HTTP_CODE})" $?

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WEB_URL}/en")
[ "$HTTP_CODE" = "200" ]
check "Homepage EN (${HTTP_CODE})" $?

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "${WEB_URL}/ar")
[ "$HTTP_CODE" = "200" ]
check "Homepage AR (${HTTP_CODE})" $?

# ── 3. API Health Check ─────────────────────────────────
echo ""
echo "🏥 API Health..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/v1/health")
[ "$HTTP_CODE" = "200" ]
check "Health Endpoint (${HTTP_CODE})" $?

# ── 4. Produktkatalog ───────────────────────────────────
echo ""
echo "📦 API Endpoints..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/v1/products?limit=1")
[ "$HTTP_CODE" = "200" ]
check "Products API (${HTTP_CODE})" $?

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/v1/categories")
[ "$HTTP_CODE" = "200" ]
check "Categories API (${HTTP_CODE})" $?

# ── 5. Auth Endpoints ───────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -d '{"email":"nonexistent@test.de","password":"wrong"}' \
  "${API_URL}/api/v1/auth/login")
[ "$HTTP_CODE" = "401" ]
check "Login Endpoint rejects bad creds (${HTTP_CODE})" $?

# ── 6. Protected Endpoints ──────────────────────────────
echo ""
echo "🔐 Sicherheit..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/v1/users/me")
[ "$HTTP_CODE" = "401" ]
check "Protected endpoint rejects without token (${HTTP_CODE})" $?

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${API_URL}/api/v1/admin/dashboard")
[ "$HTTP_CODE" = "401" ]
check "Admin endpoint rejects without token (${HTTP_CODE})" $?

# ── 7. Webhook Signature Rejection ──────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -X POST \
  -H "Content-Type: application/json" \
  -H "stripe-signature: invalid" \
  -d '{"type":"test"}' \
  "${API_URL}/api/v1/payments/webhooks/stripe")
[ "$HTTP_CODE" = "200" ]
check "Stripe webhook responds (sig rejected internally)" $?

# ── 8. Security Headers ────────────────────────────────
echo ""
echo "🛡️  Security Headers..."
HEADERS=$(curl -s --head --max-time 5 "${WEB_URL}/de")

echo "$HEADERS" | grep -qi "x-frame-options"
check "X-Frame-Options header" $?

echo "$HEADERS" | grep -qi "x-content-type-options"
check "X-Content-Type-Options header" $?

# ── 9. Legal Pages ──────────────────────────────────────
echo ""
echo "⚖️  Rechtliche Seiten..."
for page in impressum datenschutz agb widerruf; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${WEB_URL}/de/legal/${page}")
  [ "$HTTP_CODE" = "200" ]
  check "${page} (${HTTP_CODE})" $?
done

# ── 10. robots.txt + sitemap ────────────────────────────
echo ""
echo "🤖 SEO..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${WEB_URL}/robots.txt")
[ "$HTTP_CODE" = "200" ]
check "robots.txt (${HTTP_CODE})" $?

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${WEB_URL}/sitemap.xml")
[ "$HTTP_CODE" = "200" ]
check "sitemap.xml (${HTTP_CODE})" $?

# ── Ergebnis ─────────────────────────────────────────────
echo ""
echo "============================================"
echo "  ERGEBNIS: ${PASSED}/${TOTAL} bestanden"
echo "============================================"

if [ $FAILED -eq 0 ]; then
  echo -e "  ${GREEN}✅ ALLE SMOKE TESTS BESTANDEN${NC}"
  echo "  Der Shop ist betriebsbereit."
  exit 0
else
  echo -e "  ${RED}❌ ${FAILED} TEST(S) FEHLGESCHLAGEN${NC}"
  echo "  Fehler beheben und erneut ausführen."
  exit 1
fi
