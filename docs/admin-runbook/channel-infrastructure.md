# Channel-Infrastructure Runbook

Kurzleitfaden zur Bedienung des Phase-1-Channel-Systems. Drei
operationelle Szenarien, alle in 5–10 Minuten durchführbar.

---

## 1. Feed-Token verwalten

Jeder Channel (Facebook, TikTok, Google) hat ein eigenes Token, das
Teil der Feed-URL ist.

### Tokens ansehen

```
GET /admin/feeds/token
```

Liefert alle 4 Tokens in einer Antwort:

```json
{
  "tokens": {
    "facebook": "abc...",
    "tiktok": "...",
    "google": "...",
    "whatsapp": "..."
  }
}
```

Feed-URL-Format:
`https://api.malak-bekleidung.com/api/v1/feeds/{channel}?token={token}&lang=de`

### Token rotieren (NUR super_admin)

```
POST /admin/feeds/token/regenerate?channel=facebook
```

**Wichtig:** Rotation bricht den gegebenen Channel sofort — die alte
Feed-URL liefert 403. Erst das neue Token im Merchant-Dashboard
(Facebook Business Manager / Google Merchant Center / TikTok Shop
Admin) eintragen, bevor der nächste Crawl erwartet wird.

### Admin-Aktion → Audit

Jede Rotation + jeder Cache-Refresh schreibt einen Audit-Log-Eintrag
mit dem ausführenden User und der IP. In `/admin/audit-log` nach
`FEED_TOKEN_REGENERATED` oder `FEED_CACHE_CLEARED` filtern.

---

## 2. Channel-Listings & Safety-Stock

### Ein Produkt auf einen Channel veröffentlichen

1. `/admin/products/<id>` öffnen.
2. Im Block „Verkaufskanäle" den gewünschten Channel-Toggle aktivieren.
3. Speichern.

Was passiert im Hintergrund:
- `Product.channelX = true` wird geschrieben (Legacy-Boolean).
- Pro aktive Variante wird eine `ChannelProductListing`-Zeile mit
  `status='pending'` angelegt (bzw. eine bestehende `deleted`-Zeile
  reaktiviert — `externalListingId` und History bleiben erhalten).
- Ein Audit-Row `CHANNEL_LISTING_ENABLED` wird geschrieben.
- Der Channel-Feed-Cache wird invalidiert.

### Pflichten vor der Veröffentlichung

Das System blockt mit einem 3-sprachigen 400er, wenn:
- Das Produkt **keine aktive Variante** hat. Kleidung + Schuhe haben
  per Definition immer mindestens Farbe × Größe — ein Zero-Variant-
  Produkt deutet auf einen unvollständigen Datensatz hin.

Keine Blockade, aber empfohlen:
- Für Google: `Category.googleCategoryId` setzen (Dropdown im
  Kategorie-Editor). Ohne ID fällt der Feed auf den Kategorie-Namen
  zurück, Google stuft solche Listings herunter.

### Safety-Stock ändern

Aktuell: Default `safetyStock = 1` pro Listing (gesetzt bei Create).
Änderung einzeln über direkte Prisma-Queries (UI-Editor folgt in
einer Post-Launch-Iteration).

Beispiel-SQL:
```sql
UPDATE channel_product_listings
   SET safety_stock = 3
 WHERE variant_id = '<VARIANT_UUID>'
   AND channel = 'facebook';
```

### Wenn ein Listing automatisch pausiert wurde

**Trigger:** `availableStock <= safetyStock` (max-per-Warehouse-
Semantik, konsistent mit der Cart).

**Signale:**
- Admin-Notification (Bell-Icon) Typ `channel_auto_paused`
- Audit-Log-Eintrag `CHANNEL_LISTING_AUTO_PAUSED`
- Listing-Row: `status='paused'`, `pauseReason='low_stock'`, `pausedAt=...`

**Auto-Resume:** Sobald der verfügbare Bestand wieder über dem
Schwellwert liegt (durch Retoure-Restock oder Inventar-Einbuchung),
flippt das System das Listing automatisch zurück auf `status='active'`.
Zusätzlich läuft alle 5 Minuten ein Self-Healing-Cron
(`ChannelSafetyStockCron`) der verpasste Events nachholt.

**Manuelle Pause NICHT automatisch reaktivierbar:** Wenn ein Admin
ein Listing manuell pausiert (`pauseReason='manual'`), wird es
niemals automatisch reaktiviert — nur durch erneute Admin-Aktion.

---

## 3. WhatsApp-Smart-Link nutzen

1. `/admin/products/<id>` öffnen.
2. Im Block „Verkaufskanäle" den WhatsApp-Toggle aktivieren.
3. Sobald das Produkt mindestens eine aktive Variante hat, erscheint
   darunter der Block „WhatsApp-Nachricht" mit zwei Buttons:
   - **Als DE kopieren** → Deutsche Version in Zwischenablage
   - **نسخ بالعربية** → Arabische Version
4. Nachricht in WhatsApp Business Catalog oder eine WhatsApp-
   Konversation einfügen. Bilder separat aus der Galerie kopieren
   (oben auf der Seite).

### Was die Nachricht enthält

```
{Produkt-Name}

{Beschreibung — max 280 Zeichen}

Preis: 49,99 EUR
Farben: Schwarz, Blau
Größen: S, M, L

Jetzt ansehen: https://malak-bekleidung.com/de/products/hemd-blau
```

Die arabische Version hat identische Struktur mit `السعر`, `الألوان`,
`المقاسات`, `عرض المنتج` — RTL wird im Button automatisch gesetzt.

### Warum kein automatischer Upload?

Meta's WhatsApp Business Catalog API erfordert einen vollständigen
Commerce-Setup (Catalog-ID, App-OAuth, Commerce-Manager-Verifikation).
Für den Malak-Launch ist der Aufwand nicht gerechtfertigt — der
manuelle Copy-Paste-Weg kostet ~30 Sekunden pro Produkt und vermeidet
ein 4-stündiges API-Onboarding.

---

## Fehlerbilder

### Feed antwortet 503 Service Unavailable

Seltener Fehler-Fall — bedeutet: Feed-Generierung crashte UND kein
Stale-Cache verfügbar. Schritte:

1. Sentry prüfen — Tag `severity:hard_fail` zeigt den Stack-Trace.
2. Admin-E-Mail-Inbox prüfen (Alert wurde ausgelöst).
3. Wenn DB-Ausfall: Wenn Supabase wieder antwortet, einfach einen
   manuellen Cache-Refresh via `POST /admin/feeds/refresh`.

### Listing wurde pausiert obwohl Bestand da ist

Prüfen:
- `SELECT quantity_on_hand, quantity_reserved FROM inventory WHERE variant_id = '<UUID>'`
- Max über alle Warehouses = `max(onHand - reserved)` pro Warehouse
- Liegt der Wert über `safety_stock`? Wenn ja: Self-Healing-Cron läuft
  alle 5 Min, Listing flippt von selbst zurück.

### Google-Feed zeigt falsche Versandpreise

`/admin/shipping-zones` prüfen. Jede aktive Zone erzeugt einen
`<g:shipping>`-Block pro Country-Code. Ist eine Zone `isActive=false`
oder `deletedAt IS NOT NULL`, erscheint sie nicht im Feed.

---

## Referenz-Dokumente

- `docs/admin-release-notes/2026-04-21-phase-1-channel-infrastructure.md`
  — Gesamt-Release-Note
- `docs/admin-runbook/master-key-management.md` — Channel-Token-
  Encryption für Phase 2+
- `docs/admin-runbook/backup-wiederherstellung.md` — DB-Backup
  (Phase-unabhängig)
