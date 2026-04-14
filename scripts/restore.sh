#!/bin/bash
# =============================================================
# Malak Bekleidung — PostgreSQL Restore Script
# Verwendung: ./scripts/restore.sh [backup-datei]
#
# ACHTUNG: Überschreibt die aktuelle Datenbank!
# Nur auf Staging testen, bevor auf Production ausgeführt.
# =============================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/malak}"
DB_URL="${DATABASE_URL:-}"

if [ -z "$DB_URL" ]; then
  echo "❌ DATABASE_URL nicht gesetzt. Abbruch."
  exit 1
fi

# ── Backup-Datei bestimmen ────────────────────────────────
if [ $# -eq 1 ]; then
  BACKUP_FILE="$1"
else
  # Neuestes Backup finden
  BACKUP_FILE=$(ls -t "${BACKUP_DIR}"/malak_*.sql.gz 2>/dev/null | head -1)
  if [ -z "$BACKUP_FILE" ]; then
    echo "❌ Kein Backup gefunden in ${BACKUP_DIR}"
    exit 1
  fi
fi

if [ ! -f "$BACKUP_FILE" ]; then
  echo "❌ Backup-Datei nicht gefunden: ${BACKUP_FILE}"
  exit 1
fi

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "🔄 Restore von: ${BACKUP_FILE} (${FILESIZE})"
echo ""

# ── Sicherheitsabfrage ───────────────────────────────────
echo "⚠️  WARNUNG: Dies überschreibt die aktuelle Datenbank!"
echo "   Ziel-DB: $(echo $DB_URL | sed 's/:[^:]*@/@/g')"
echo ""
read -p "Fortfahren? (ja/nein): " CONFIRM
if [ "$CONFIRM" != "ja" ]; then
  echo "❌ Abgebrochen."
  exit 0
fi

# ── Restore ──────────────────────────────────────────────
echo ""
echo "📥 Starte Restore..."

pg_restore \
  --dbname="$DB_URL" \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  "$BACKUP_FILE"

echo "✅ Restore abgeschlossen!"

# ── Verifizierung ────────────────────────────────────────
echo ""
echo "🔍 Verifiziere Datenbank..."

# Tabellen zählen
TABLE_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'" 2>/dev/null | xargs)
echo "   Tabellen: ${TABLE_COUNT}"

# Bestellungen zählen
ORDER_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM orders" 2>/dev/null | xargs)
echo "   Bestellungen: ${ORDER_COUNT}"

# User zählen
USER_COUNT=$(psql "$DB_URL" -t -c "SELECT count(*) FROM users" 2>/dev/null | xargs)
echo "   Benutzer: ${USER_COUNT}"

echo ""
echo "✅ Datenbank wiederhergestellt und verifiziert."
echo ""
echo "Nächster Schritt: API neustarten und testen."
