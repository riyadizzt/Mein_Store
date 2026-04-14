# Staging Environment Guide — Malak Bekleidung

## Quick Start (Lokal)

### 1. Docker Services starten
```bash
docker compose -f docker-compose.staging.yml up -d
```

### 2. Schema auf Staging-DB pushen
```bash
DATABASE_URL=postgresql://malak_staging:malak_staging_pw@localhost:5434/malak_staging \
npx prisma db push --schema=./prisma/schema.prisma
```

### 3. Testdaten einspielen
```bash
DATABASE_URL=postgresql://malak_staging:malak_staging_pw@localhost:5434/malak_staging \
pnpm --filter api seed:staging
```

### 4. Backend starten (Staging)
```bash
cp .env.staging apps/api/.env
pnpm --filter api dev
```

### 5. Frontend starten
```bash
pnpm --filter web dev
```

### 6. Shop öffnen
- Web Store: http://localhost:3000/de
- API Docs: http://localhost:3001/api/docs
- Admin: http://localhost:3000/de/admin/login

---

## Test-Accounts

| Rolle | E-Mail | Passwort | Zugang |
|-------|--------|----------|--------|
| Super-Admin | admin@malak-bekleidung.com | Test1234! | Admin Dashboard + alle Funktionen |
| Admin | staff@malak-bekleidung.com | Test1234! | Admin Dashboard (ohne User-Sperrung) |
| Kunde DE | anna@test.de | Test1234! | Store + Kundenkonto |
| Kunde EN | john@test.de | Test1234! | Store (Englisch) |
| Kunde AR | ahmed@test.de | Test1234! | Store (Arabisch + RTL) |

---

## Stripe Test-Karten

| Karte | Nummer | Ergebnis |
|-------|--------|----------|
| Erfolg | 4242 4242 4242 4242 | Zahlung erfolgreich |
| Fehler | 4000 0000 0000 0002 | Karte abgelehnt |
| 3D Secure | 4000 0027 6000 3184 | 3D Secure Flow |
| 3D Secure Fail | 4000 0082 6000 3178 | 3D Secure abgelehnt |

Ablaufdatum: beliebig in der Zukunft (z.B. 12/30)
CVC: beliebige 3 Ziffern (z.B. 123)

---

## 3 Pflicht-Testkäufe auf Staging

### Test 1: Stripe Kartenzahlung (Happy Path)
```
1. http://localhost:3000/de → Produkt auswählen → In den Warenkorb
2. Zur Kasse → Als anna@test.de einloggen
3. Adresse auswählen → Versand → Kreditkarte
4. Stripe Testkarte: 4242 4242 4242 4242
5. "Kostenpflichtig bestellen"
✓ Bestätigungsseite mit Bestellnummer
✓ Admin Dashboard zeigt neue Bestellung
✓ E-Mail-Log prüfen (Resend Dashboard)
```

### Test 2: Klarna Zahlung
```
1. Neuen Kauf starten → Klarna als Zahlungsart
2. Klarna Playground durchlaufen
3. Redirect zurück zum Shop
✓ Bestellung im Status PENDING (Klarna capture erst bei Versand)
```

### Test 3: Guest Checkout
```
1. NICHT einloggen → "Weiter als Gast"
2. guest@test.de eingeben → Adresse → Versand → Stripe
✓ Bestellung ohne Account erstellt
✓ Bestätigungs-E-Mail an guest@test.de
```

---

## Load Testing

### Installation
```bash
brew install k6
```

### Ausführen
```bash
# Vollständiger Load Test (2 Minuten, 500 User)
k6 run load-tests/store-load.js

# Concurrency Test (Anti-Überverkauf)
k6 run load-tests/concurrency-test.js
```

### Ziele
- Homepage: p95 < 300ms
- Checkout: p95 < 1000ms
- Error Rate: < 1%
- Concurrency: Max 5 Orders bei Bestand = 5

---

## Cloud Deployment

### Frontend → Vercel
```bash
cd apps/web
vercel --prod
```
Region: `fra1` (Frankfurt)

### Backend → Railway
```bash
cd apps/api
railway up
```
Mit PostgreSQL + Redis Add-ons

### Checkliste vor Production
- [ ] Stripe: TEST → LIVE Keys
- [ ] DHL: Sandbox → Production
- [ ] Klarna: Playground → Production
- [ ] Resend: Domain verifiziert
- [ ] Domain DNS konfiguriert
- [ ] SSL Zertifikat aktiv
- [ ] Monitoring (Sentry + UptimeRobot) aktiv
- [ ] Backup-Plan konfiguriert
- [ ] Smoke Test auf Production bestanden
