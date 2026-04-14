#!/bin/bash
# =============================================================
# Malak Bekleidung — Backup + Recovery Test (NUR AUF STAGING!)
#
# Testet den kompletten Zyklus:
# 1. Backup erstellen
# 2. Datenbank löschen
# 3. Backup wiederherstellen
# 4. Daten verifizieren
# =============================================================

set -euo pipefail

STAGING_DB="postgresql://malak_staging:malak_staging_pw@localhost:5434/malak_staging"
BACKUP_DIR="/tmp/malak-backup-test"

echo "============================================"
echo "  BACKUP + RECOVERY TEST (Staging)"
echo "============================================"
echo ""

# ── Schritt 1: Backup erstellen ──────────────────────────
echo "📦 Schritt 1: Backup erstellen..."
mkdir -p "$BACKUP_DIR"

BACKUP_FILE="${BACKUP_DIR}/test_backup.sql.gz"
pg_dump "$STAGING_DB" --format=custom --compress=9 --file="$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "   ✅ Backup: ${BACKUP_FILE} (${FILESIZE})"

# Daten VOR dem Löschen zählen
ORDERS_BEFORE=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM orders" | xargs)
USERS_BEFORE=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM users" | xargs)
PRODUCTS_BEFORE=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM products" | xargs)
echo "   Daten vorher: ${ORDERS_BEFORE} Orders, ${USERS_BEFORE} Users, ${PRODUCTS_BEFORE} Products"
echo ""

# ── Schritt 2: Datenbank löschen ─────────────────────────
echo "🗑️  Schritt 2: Datenbank löschen..."
psql "$STAGING_DB" -c "
  DO \$\$ DECLARE r RECORD;
  BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
      EXECUTE 'DROP TABLE IF EXISTS ' || quote_ident(r.tablename) || ' CASCADE';
    END LOOP;
  END \$\$;
"
echo "   ✅ Alle Tabellen gelöscht."

# Verifizieren dass wirklich leer
TABLES_AFTER=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" | xargs)
echo "   Tabellen nach Löschung: ${TABLES_AFTER}"
echo ""

# ── Schritt 3: Backup wiederherstellen ───────────────────
echo "📥 Schritt 3: Backup wiederherstellen..."
pg_restore --dbname="$STAGING_DB" --no-owner --no-privileges "$BACKUP_FILE"
echo "   ✅ Restore abgeschlossen."
echo ""

# ── Schritt 4: Verifizierung ────────────────────────────
echo "🔍 Schritt 4: Verifizierung..."

ORDERS_AFTER=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM orders" | xargs)
USERS_AFTER=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM users" | xargs)
PRODUCTS_AFTER=$(psql "$STAGING_DB" -t -c "SELECT count(*) FROM products" | xargs)

echo "   Orders:   vorher=${ORDERS_BEFORE} → nachher=${ORDERS_AFTER}"
echo "   Users:    vorher=${USERS_BEFORE} → nachher=${USERS_AFTER}"
echo "   Products: vorher=${PRODUCTS_BEFORE} → nachher=${PRODUCTS_AFTER}"
echo ""

# Prüfe ob Daten identisch
PASS=true
if [ "$ORDERS_BEFORE" != "$ORDERS_AFTER" ]; then
  echo "   ❌ FEHLER: Orders stimmen nicht überein!"
  PASS=false
fi
if [ "$USERS_BEFORE" != "$USERS_AFTER" ]; then
  echo "   ❌ FEHLER: Users stimmen nicht überein!"
  PASS=false
fi
if [ "$PRODUCTS_BEFORE" != "$PRODUCTS_AFTER" ]; then
  echo "   ❌ FEHLER: Products stimmen nicht überein!"
  PASS=false
fi

echo ""
if [ "$PASS" = true ]; then
  echo "============================================"
  echo "  ✅ BACKUP + RECOVERY TEST BESTANDEN"
  echo "============================================"
else
  echo "============================================"
  echo "  ❌ BACKUP + RECOVERY TEST FEHLGESCHLAGEN"
  echo "============================================"
  exit 1
fi

# Aufräumen
rm -rf "$BACKUP_DIR"
echo ""
echo "Nächster Schritt: API neustarten und Shop testen."
