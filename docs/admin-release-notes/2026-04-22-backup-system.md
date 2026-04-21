# Backup-System — Änderungen ab 22.04.2026

**Wichtig für den Tagesbetrieb:**

- **Tägliche Datenbank-Backups laufen ab jetzt automatisch um 03:00 UTC** und werden in einem separaten Cloudflare-R2-Bucket (`malak-backups`) verschlüsselt gespeichert. Retention: 30 tägliche + 12 monatliche (1. des Monats wird automatisch promoted) + 14 Tage manuelle Snapshots — ältere Backups werden automatisch gelöscht.
- **Neue Admin-Seite `/admin/backups`** (nur für `super_admin` sichtbar): Liste aller Backups mit Datum, Typ, Status, Größe und SHA256-Hash. Pro erfolgreichen Backup gibt es einen Download-Button (signierter R2-Link, 15 Min gültig). Manuelle Backups auf Knopfdruck jederzeit möglich.
- **Fehlermeldungen bei Backup-Fehler gehen per E-Mail (nur Deutsch) an `BACKUP_ALERT_EMAIL`** mit Details zum Fehler und Link zum Dashboard. Plus Sentry-Alert. Erfolgreiche Backups erzeugen keine E-Mails (kein Spam).
- **Restore erfolgt bewusst manuell per SSH** — kein Button in der UI. Anleitung unter `docs/admin-runbook/backup-wiederherstellung.md` (Download → entpacken → `psql < dump.sql` in neue Supabase-Instanz).

**Deploy-Voraussetzung (einmalig):**

- Railway-Runtime-Image muss `postgresql-client` installiert haben. In `apps/api/Dockerfile` (Runner-Stage) steht dafür `RUN apk add --no-cache postgresql-client gzip`. Ohne `pg_dump` schlägt jeder Backup fehl.
- Env-Variablen setzen: `R2_BACKUP_ENDPOINT`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET` (default: `malak-backups`), `BACKUP_ALERT_EMAIL`.

Für den normalen Tagesbetrieb ist nichts zu tun — das System läuft eigenständig. Admin öffnet `/admin/backups` nur im Notfall oder zum Stichproben-Download.
