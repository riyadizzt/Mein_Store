# Backup & Recovery — Malak Bekleidung

## Automatisches Backup (Cron)

### Einrichten (auf dem Server)
```bash
# Tägliches Backup um 03:00 Uhr
crontab -e

# Folgende Zeile einfügen:
0 3 * * * DATABASE_URL="postgresql://..." BACKUP_DIR="/var/backups/malak" /path/to/scripts/backup.sh >> /var/log/malak-backup.log 2>&1
```

### Was wird gesichert?
- Komplette PostgreSQL-Datenbank (alle Tabellen, Indizes, Daten)
- Format: pg_dump custom + gzip (komprimiert)
- Aufbewahrung: 30 Tage (ältere werden automatisch gelöscht)

### Was wird NICHT gesichert?
- Redis (Session-Daten, Rate-Limits — werden automatisch neu aufgebaut)
- Cloudinary Bilder (eigenes Backup bei Cloudinary)
- Umgebungsvariablen (.env Dateien — separat sichern!)

---

## Manuelles Backup

```bash
# Sofort-Backup
DATABASE_URL="postgresql://..." ./scripts/backup.sh

# Backup-Verzeichnis prüfen
ls -la /var/backups/malak/
```

---

## Recovery (Wiederherstellung)

### Schritt 1: Neuestes Backup finden
```bash
ls -lt /var/backups/malak/
# Ausgabe: malak_20260326_030000.sql.gz (neuestes oben)
```

### Schritt 2: Wiederherstellen
```bash
# Automatisch (neuestes Backup):
DATABASE_URL="postgresql://..." ./scripts/restore.sh

# Spezifisches Backup:
DATABASE_URL="postgresql://..." ./scripts/restore.sh /var/backups/malak/malak_20260326_030000.sql.gz
```

### Schritt 3: API neustarten
```bash
# Railway
railway service restart

# Lokal
pnpm --filter api dev
```

### Schritt 4: Verifizieren
```bash
./scripts/smoke-test.sh https://malak-bekleidung.com https://api.malak-bekleidung.com
```

---

## Recovery-Test (PFLICHT vor Go-Live)

```bash
# NUR auf Staging ausführen!
./scripts/test-backup-recovery.sh
```

Dieser Test:
1. Erstellt ein Backup
2. Löscht die Datenbank komplett
3. Stellt das Backup wieder her
4. Prüft ob alle Daten identisch sind

**Ergebnis: BESTANDEN / FEHLGESCHLAGEN**

---

## Notfall-Kontakte

| Dienst | Dashboard | Support |
|--------|-----------|---------|
| Railway (DB) | https://railway.app | support@railway.app |
| Upstash (Redis) | https://console.upstash.com | — |
| Vercel (Frontend) | https://vercel.com/dashboard | — |
| Cloudinary (Bilder) | https://console.cloudinary.com | — |

---

## Redis

Redis-Daten sind **kurzlebig** (Sessions, Rate-Limits, Queue-Jobs).
Bei Redis-Ausfall: Daten werden automatisch neu aufgebaut.
Upstash hat eigenes Auto-Backup — prüfe in der Upstash Console.
