# Backup-Wiederherstellung — Schritt-für-Schritt

Diese Anleitung beschreibt, wie ein Datenbank-Backup aus dem Admin-Panel
heruntergeladen und in eine frische Supabase-Instanz eingespielt wird.
Die Wiederherstellung erfolgt **manuell per SSH** — es gibt bewusst keinen
Restore-Button im Admin-UI.

---

## 1. Backup herunterladen

1. Öffne `/admin/backups` im Admin-Panel (nur als `super_admin` sichtbar).
2. Wähle den gewünschten Backup aus der Liste. Status muss `Erfolgreich` sein.
3. Klick auf „Download". Der Browser öffnet einen signierten Link (15 Min gültig)
   und lädt eine Datei vom Typ `daily/2026-04-22T03-00-00Z.sql.gz` (o. ä.).
4. Speichere die Datei an einem sicheren Ort auf deinem Rechner.

Der **SHA256-Hash** der Datei steht im Admin-UI (Tooltip auf dem Statuspunkt).
Er kann nach dem Download verifiziert werden:

```bash
shasum -a 256 daily/2026-04-22T03-00-00Z.sql.gz
```

Stimmt der ausgegebene Hash nicht mit dem Admin-UI überein, ist die Datei
beschädigt — lade sie erneut herunter.

---

## 2. Backup entpacken

```bash
gunzip daily/2026-04-22T03-00-00Z.sql.gz
# → daily/2026-04-22T03-00-00Z.sql (entpacktes SQL-Skript)
```

---

## 3. In frische Supabase-Instanz einspielen

### 3.1 Voraussetzung

- Eine **leere** Supabase-Postgres-Instanz (gleiche Major-Version wie Produktion).
- Die Connection-URL dieser neuen Instanz — Format:
  `postgresql://postgres:PASSWORT@host.region.supabase.co:5432/postgres`

### 3.2 Restore

```bash
# Variante A: komplettes Einspielen (frische DB)
psql "postgresql://postgres:PASSWORT@neuer-host:5432/postgres" \
  < daily/2026-04-22T03-00-00Z.sql
```

Bei Warnungen wie „role does not exist" einfach weitermachen — der Dump
verwendet `--no-owner --no-acl`, User-Berechtigungen werden nicht wiederhergestellt.

### 3.3 App auf neue DB umstellen

1. In Railway die Umgebungsvariable `DATABASE_URL` auf die neue Connection-URL ändern.
2. Service neu starten:
   ```bash
   railway service redeploy
   ```
3. Health-Check: `https://api.malak-bekleidung.com/health` muss `200 OK` liefern.
4. Login als Admin, Stichprobe in `/admin/dashboard` (Orders-Count, Produkte).

---

## 4. Voraussetzung auf dem Runtime-Image (einmalig)

Das Backup-System ruft beim Erstellen eines Dumps `pg_dump` als Shell-Prozess auf.
Die Railway-Instanz muss `postgresql-client` installiert haben. In `nixpacks.toml`:

```toml
[phases.setup]
aptPkgs = ["postgresql-client"]
```

Prüfen: `railway run pg_dump --version` muss eine Versionsnummer ausgeben.
Ohne `pg_dump` schlägt jeder Backup mit `pg_dump spawn failed: ENOENT` fehl.

---

## 5. Was im Restore NICHT enthalten ist

- **Dateien in Cloudflare R2** (Produktbilder, Rechnungs-PDFs) — bleiben
  unverändert an ihrem Speicherort.
- **BullMQ-Queue-State in Redis** — aktive Jobs gehen verloren, der Cron
  startet neue.
- **Browser-Sessions** — alle User müssen sich nach dem Restore neu einloggen.
- **Zahlungs-Gateway-State** (Stripe, PayPal …) — manuelle Abstimmung mit
  dem jeweiligen Dashboard erforderlich, falls Orders zwischen Backup-Zeit
  und Restore-Zeit entstanden sind.

---

## 6. Retention-Politik zur Info

- **30 tägliche** Backups werden behalten (danach gelöscht).
- Der **erste Backup jedes Monats** wird automatisch zu `MONTHLY` umetikettiert.
- **12 monatliche** Backups werden behalten (ca. 1 Jahr Rückschau).
- **Manuelle** Backups werden **14 Tage** aufbewahrt.

Retention läuft automatisch nach jedem erfolgreichen Backup.
