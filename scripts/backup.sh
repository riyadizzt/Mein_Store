#!/bin/bash
# =============================================================
# Malak Bekleidung — PostgreSQL Backup Script
# Täglicher Cron: 0 3 * * * /path/to/scripts/backup.sh
# Aufbewahrung: 30 Tage
# =============================================================

set -euo pipefail

# ── Config ────────────────────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/var/backups/malak}"
RETENTION_DAYS=30
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/malak_${TIMESTAMP}.sql.gz"

# DB-Verbindung aus .env oder Umgebungsvariablen
DB_URL="${DATABASE_URL:-}"

if [ -z "$DB_URL" ]; then
  echo "❌ DATABASE_URL nicht gesetzt. Abbruch."
  exit 1
fi

# ── Backup-Verzeichnis erstellen ──────────────────────────
mkdir -p "$BACKUP_DIR"

# ── Backup erstellen ─────────────────────────────────────
echo "📦 Starte Backup: ${BACKUP_FILE}"
echo "   Zeitstempel: ${TIMESTAMP}"

pg_dump "$DB_URL" \
  --format=custom \
  --no-owner \
  --no-privileges \
  --compress=9 \
  --file="$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Backup erstellt: ${BACKUP_FILE} (${FILESIZE})"

# ── Alte Backups löschen (> 30 Tage) ─────────────────────
echo "🗑️  Lösche Backups älter als ${RETENTION_DAYS} Tage..."
DELETED=$(find "$BACKUP_DIR" -name "malak_*.sql.gz" -type f -mtime +${RETENTION_DAYS} -delete -print | wc -l)
echo "   ${DELETED} alte Backup(s) gelöscht."

# ── Backup-Integrität prüfen ─────────────────────────────
echo "🔍 Prüfe Backup-Integrität..."
pg_restore --list "$BACKUP_FILE" > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✅ Backup-Integrität OK"
else
  echo "⚠️  Backup möglicherweise beschädigt!"
  exit 1
fi

# ── Zusammenfassung ──────────────────────────────────────
TOTAL_BACKUPS=$(find "$BACKUP_DIR" -name "malak_*.sql.gz" -type f | wc -l)
TOTAL_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
echo ""
echo "📊 Backup-Übersicht:"
echo "   Aktuelle Backups: ${TOTAL_BACKUPS}"
echo "   Gesamtgröße:      ${TOTAL_SIZE}"
echo "   Aufbewahrung:     ${RETENTION_DAYS} Tage"
echo ""
echo "✅ Backup abgeschlossen."
