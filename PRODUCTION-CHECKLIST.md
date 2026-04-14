# Production Checklist — Malak Bekleidung

## Vor dem Go-Live JEDE Checkbox abhaken

---

### 1. Umgebungsvariablen

- [ ] `.env.production` erstellt (Vorlage: `.env.production.template`)
- [ ] Neue JWT Secrets generiert: `openssl rand -hex 64`
- [ ] Stripe: **LIVE** Key (sk_live_...) — NICHT sk_test_!
- [ ] Stripe Webhook Secret für Production-Endpoint
- [ ] Klarna: Production API URL (`https://api.klarna.com`)
- [ ] DHL: `DHL_SANDBOX=false` + echte Geschäftskundennummer
- [ ] Resend: Domain verifiziert (SPF + DKIM)
- [ ] Cloudinary: Production Credentials
- [ ] Sentry DSN eingetragen
- [ ] DATABASE_URL zeigt auf Production-DB (Railway)
- [ ] UPSTASH_REDIS zeigt auf Production-Redis
- [ ] Keine Variable enthält "REPLACE", "xxxx", "test", "staging"

### 2. Domain + SSL

- [ ] Domain registriert (z.B. malak-bekleidung.com)
- [ ] DNS: A-Record → Vercel
- [ ] DNS: CNAME api.malak-bekleidung.com → Railway
- [ ] SSL-Zertifikat aktiv (Vercel Auto-SSL)
- [ ] www → non-www Redirect konfiguriert
- [ ] CORS in Backend: `NEXT_PUBLIC_APP_URL=https://malak-bekleidung.com`

### 3. Datenbank

- [ ] Railway PostgreSQL erstellt (Region: EU Frankfurt)
- [ ] Schema deployt: `npx prisma migrate deploy`
- [ ] Production Seed ausgeführt: `seed-production.ts` (nur Admin + Zones)
- [ ] Tägliches Backup aktiv (Railway Auto-Backup ODER Cron + `backup.sh`)
- [ ] Backup-Recovery einmal getestet

### 4. Zahlungen

- [ ] Stripe Live-Account aktiviert + verifiziert
- [ ] Stripe Webhook Endpoint registriert: `https://api.malak-bekleidung.com/api/v1/payments/webhooks/stripe`
- [ ] Stripe Webhook Events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.refunded`, `charge.dispute.created`
- [ ] Klarna Merchant Account aktiviert
- [ ] 1 Test-Transaktion mit echter Karte → sofort refunded

### 5. Versand

- [ ] DHL Geschäftskundenvertrag aktiv
- [ ] DHL API Credentials für Production
- [ ] DHL Tracking Webhook registriert
- [ ] 1 Test-Sendung erstellt → storniert

### 6. E-Mail

- [ ] Resend Domain verifiziert (DNS Records)
- [ ] SPF Record gesetzt
- [ ] DKIM Record gesetzt
- [ ] Test-E-Mail von noreply@malak-bekleidung.com gesendet und empfangen

### 7. Monitoring

- [ ] Sentry: Projekt erstellt, DSN in .env
- [ ] UptimeRobot / BetterStack: URL-Monitor für https://malak-bekleidung.com
- [ ] UptimeRobot: URL-Monitor für https://api.malak-bekleidung.com/api/v1/health
- [ ] Alerting: E-Mail bei Downtime konfiguriert
- [ ] Railway Logs: Zugriff getestet

### 8. Sicherheit

- [ ] Security Audit bestanden (SECURITY-AUDIT.md)
- [ ] Alle Webhook-Secrets gesetzt (Stripe, Klarna, DHL)
- [ ] Rate Limiting aktiv
- [ ] CORS nur für https://malak-bekleidung.com
- [ ] `.env.production` NICHT in Git

### 9. Rechtliches

- [ ] Impressum: Echte Firmendaten eingetragen
- [ ] Datenschutzerklärung: Vom Anwalt geprüft
- [ ] AGB: Vom Anwalt geprüft
- [ ] Widerrufsbelehrung: Vom Anwalt geprüft
- [ ] Cookie-Banner: Funktioniert, opt-in aktiv

### 10. Deployment

- [ ] `./scripts/deploy-production.sh` — alle Prüfungen bestanden
- [ ] Frontend deployed: `cd apps/web && vercel --prod`
- [ ] Backend deployed: `cd apps/api && railway up`
- [ ] `./scripts/smoke-test.sh` — alle Checks grün

### 11. Smoke Test (nach Deployment)

- [ ] Homepage lädt (https://malak-bekleidung.com)
- [ ] API Health Check (https://api.malak-bekleidung.com/api/v1/health)
- [ ] Produktkatalog zeigt Produkte
- [ ] 1 Testkauf mit eigener Kreditkarte → Bestätigung erhalten → refunded
- [ ] Admin Dashboard lädt
- [ ] Alle 3 Sprachen funktionieren (DE, EN, AR)
- [ ] Mobile: Shop auf echtem Smartphone getestet

---

## Nach Go-Live (erste 48 Stunden)

- [ ] Sentry: Keine kritischen Fehler?
- [ ] Uptime: Kein Ausfall?
- [ ] Erste echte Bestellung eingegangen und verarbeitet?
- [ ] E-Mails kommen an?
- [ ] Admin Dashboard: Daten korrekt?
- [ ] Backup: Erstes automatisches Backup erfolgreich?
