# Security Audit Report — Malak Omnichannel Store

**Datum:** 26. März 2026
**Durchgeführt von:** Claude Code (automatisiertes Code-Audit)
**Scope:** Backend (NestJS API) + Frontend (Next.js)
**Status:** Alle kritischen Issues behoben

---

## Zusammenfassung

| Kategorie | Status | Gefundene Issues | Behoben |
|-----------|--------|-----------------|---------|
| Authentication (JWT) | ✅ BESTANDEN | 0 | - |
| Role Guards | ✅ BEHOBEN | 3 fehlende Guards | 3/3 |
| Webhook-Signatur | ✅ BEHOBEN | 2 kritische Lücken | 2/2 |
| Input-Validierung | ✅ BEHOBEN | 1 fehlende DTO | 1/1 |
| SQL Injection | ✅ BESTANDEN | 0 | - |
| Data Exposure | ✅ BESTANDEN | 0 | - |
| CORS | ✅ BESTANDEN | 0 | - |
| Rate Limiting | ✅ BESTANDEN | 0 | - |
| Secrets im Code | ✅ BESTANDEN | 0 | - |
| Passwort-Hashing | ✅ BESTANDEN | 0 | - |
| Security Headers | ✅ BESTANDEN | 0 | - |
| DSGVO-Konformität | ✅ BESTANDEN | 0 | - |

---

## Kritische Issues — BEHOBEN

### 1. Klarna Webhook ohne Signatur-Verifizierung (KRITISCH)
- **Datei:** `payments/providers/klarna.provider.ts`
- **Problem:** `verifyWebhookSignature()` gab immer `isValid: true` zurück
- **Risiko:** Angreifer konnte gefälschte Zahlungsbestätigungen senden
- **Fix:** HMAC-SHA256 Signatur-Verifizierung mit `KLARNA_WEBHOOK_SECRET` implementiert
- **Verifizierung:** `crypto.timingSafeEqual()` gegen Timing-Attacks

### 2. DHL Webhook ohne Signatur-Verifizierung (KRITISCH)
- **Datei:** `shipments/shipments.controller.ts`
- **Problem:** DHL Tracking-Webhook akzeptierte jeden Request ohne Prüfung
- **Risiko:** Angreifer konnte Tracking-Status manipulieren
- **Fix:** HMAC-SHA256 Signatur mit `DHL_WEBHOOK_SECRET` implementiert

### 3. Fehlende Role Guards auf Shipments + Refund Endpoints (KRITISCH)
- **Dateien:** `shipments/shipments.controller.ts`, `payments/payments.controller.ts`
- **Problem:** `POST /shipments`, `POST /returns/:id/received`, `POST /payments/refunds` hatten nur `JwtAuthGuard` aber keinen `RolesGuard`
- **Risiko:** Jeder eingeloggte Kunde konnte Sendungen erstellen, Returns markieren oder Refunds auslösen
- **Fix:** `@UseGuards(RolesGuard) @Roles('admin', 'super_admin')` hinzugefügt

### 4. Reset-Password ohne DTO-Validierung (MITTEL)
- **Datei:** `auth/auth.controller.ts`
- **Problem:** `/auth/reset-password` akzeptierte Passwörter ohne Mindestlänge/Stärke-Prüfung
- **Fix:** `ResetPasswordDto` mit `@MinLength(8)`, `@MaxLength(72)`, `@Matches()` erstellt

---

## Bestandene Prüfungen

### Authentication (JWT)
- ✅ Alle sensiblen Endpoints durch `JwtAuthGuard` geschützt
- ✅ Token-Rotation bei Refresh
- ✅ Passwort-Änderung invalidiert alle Sessions
- ✅ Account-Sperrung nach 5 fehlgeschlagenen Logins (15 Min)
- ✅ Öffentliche Endpoints korrekt identifiziert (Katalog, Suche, Health)

### SQL Injection
- ✅ 6 Raw-SQL-Queries gefunden — alle parametrisiert via Prisma Template Literals
- ✅ Produktsuche nutzt `plainto_tsquery()` (safe)
- ✅ Kein String-Concatenation in SQL

### Passwort-Sicherheit
- ✅ bcrypt mit 12 Rounds (über Minimum von 10)
- ✅ Registrierung: Mindestlänge 8 + Zahl + Sonderzeichen
- ✅ `passwordHash` wird **nie** an Client zurückgegeben
- ✅ `twoFactorSecret` wird **nie** exponiert

### Rate Limiting
- ✅ Global: 10 req/s, 100 req/min
- ✅ Login: 5 Versuche/min
- ✅ Passwort-Reset: 3 E-Mails/5min (Controller) + 3/Stunde (Redis)

### CORS + Security Headers
- ✅ Helmet aktiviert (X-Frame-Options, X-Content-Type-Options, etc.)
- ✅ CORS auf Frontend-Origin beschränkt
- ✅ Next.js Security Headers konfiguriert (X-Frame-Options: DENY, Referrer-Policy)

### Secrets
- ✅ Keine hardcodierten API Keys im Quellcode
- ✅ Alle Secrets in `.env` Dateien
- ✅ `.env` in `.gitignore`
- ✅ Nur `NEXT_PUBLIC_*` Variablen im Frontend-Bundle

### DSGVO
- ✅ Cookie-Banner mit Opt-in (nicht Opt-out)
- ✅ Datenexport (Art. 20) implementiert
- ✅ Account-Löschung mit 30-Tage-Frist
- ✅ Anonymisierung nach Frist (BullMQ + Cron Safety Net)
- ✅ Consent-Log mit Zeitstempel
- ✅ Impressum §5 TMG vorhanden
- ✅ Datenschutzerklärung mit Auftragsverarbeitern (Stripe, Klarna, Cloudinary, DHL)
- ✅ Widerrufsbelehrung mit 14-Tage-Frist
- ✅ AGB mit Vertragsschluss-Klausel

### Webhook-Sicherheit (nach Fix)
- ✅ Stripe: `stripe.webhooks.constructEvent()` mit Signatur-Verifizierung
- ✅ Klarna: HMAC-SHA256 mit `crypto.timingSafeEqual()` (Timing-Safe)
- ✅ DHL: HMAC-SHA256 Signatur-Prüfung
- ✅ Alle Webhooks: Idempotency via `webhook_events.provider_event_id`

---

## Offene Punkte (nicht-kritisch)

| Punkt | Priorität | Status |
|-------|-----------|--------|
| HttpOnly Cookies statt localStorage für JWT | MITTEL | Geplant für Deployment |
| CSP Header erweitern (script-src) | NIEDRIG | Geplant |
| OWASP Dependency Check (npm audit) | MITTEL | Vor Production |
| Penetration Test durch externen Anbieter | EMPFOHLEN | Vor erstem echten Kunden |

---

## Neue .env Variablen (nach Audit hinzugefügt)

```
KLARNA_WEBHOOK_SECRET=xxxx    # HMAC-SHA256 Secret für Klarna Webhooks
DHL_WEBHOOK_SECRET=xxxx       # HMAC-SHA256 Secret für DHL Tracking Webhooks
```

---

## Test-Ergebnis nach Fixes

```
Backend:  97/97 Unit Tests BESTANDEN
Frontend: 81 Static Pages BUILD ERFOLGREICH
TypeScript: 0 Errors
```
