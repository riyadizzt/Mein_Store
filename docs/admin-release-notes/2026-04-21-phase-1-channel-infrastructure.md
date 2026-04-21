# Phase 1 — Unified Channel Infrastructure (21.–24.04.2026)

Dieses Release fasst sieben Commits (C1–C7) zusammen, die das
Channel-System von Malak von einem Boolean-pro-Produkt-Ansatz auf
eine zentrale `ChannelProductListing`-Tabelle umstellen und alle
externen Ads-Feeds gegen Produktionsbetrieb härten.

**Für den Admin-Alltag heißt das konkret:**

- **Neue Produkte sind jetzt opt-IN für alle Ads-Channels.** Facebook,
  TikTok, Google und WhatsApp stehen beim Anlegen auf AUS — du musst
  explizit pro Produkt und Channel entscheiden. Bestehende Produkte
  behalten ihre aktuelle Channel-Belegung (kein rückwirkender Eingriff).

- **Google Shopping nutzt jetzt deine echten Versandzonen.** Die alte
  fest verdrahtete `4,99 € DE`-Regel ist weg — der Feed zieht jede
  aktive Zone aus `/admin/shipping-zones` und gibt einen Versandblock
  pro Land aus. Außerdem: Kategorien tragen jetzt eine **Google-
  Taxonomie-ID** (Dropdown mit Suche, 5595 Einträge). Ohne gesetzte
  ID fällt der Feed wie bisher auf den Kategorie-Namen zurück.

- **Feed-Tokens sind pro Channel getrennt.** In `/admin/channels`
  siehst du vier eigene URLs (Facebook/TikTok/Google/…). Eine Rotation
  bricht nur einen Channel, nicht alle. Hinweis: Das alte globale
  Token ist ab sofort wertlos — beim Launch müssen die neuen Feed-URLs
  in den Merchant-Dashboards eingetragen werden (Store ist nicht live,
  keine Unterbrechung).

- **Safety-Stock pro Listing.** Jede `ChannelProductListing`-Zeile hat
  einen Schwellwert (Default 1). Fällt der verfügbare Bestand auf oder
  unter diesen Wert, wird das Listing automatisch auf
  `status='paused'` gesetzt — mit Admin-Notification (Typ
  `channel_auto_paused`). Sobald der Bestand wieder über der Schwelle
  liegt (durch Retoure-Restock oder Inventar-Einbuchung), wird das
  Listing automatisch reaktiviert. Manuell pausierte Listings
  (`pauseReason='manual'`) werden **niemals** automatisch reaktiviert.

- **Cache-Invalidierung bei jedem Produkt-Write.** Preis-Änderung,
  Kategorie-Wechsel, Variant-Add/Delete, Channel-Toggle, Settings-
  Change — alle triggern eine Leerung des In-Memory-Feed-Caches. Die
  Crawler bekommen beim nächsten Poll frische Daten statt bis zu
  30-Minuten-alte.

- **Graceful-Degraded-Feeds.** Wenn die DB kurzzeitig nicht erreichbar
  ist, liefert der Feed den letzten erfolgreichen Cache (Warning in
  Sentry). Gibt es keinen Cache, antwortet der Endpoint mit HTTP 503
  und `Retry-After: 60` — und ein Critical-Sentry-Event + Admin-E-Mail
  werden ausgelöst.

- **WhatsApp-Catalog-Feed wurde entfernt.** Der alte
  `/feeds/whatsapp`-Endpoint antwortet jetzt mit HTTP 410 Gone. Meta
  hat die URL nie gepollt — das war eine Fassade. Stattdessen gibt es
  im Produkt-Editor einen neuen **WhatsApp-Freigabe-Block**: zwei
  Buttons „Als DE kopieren" / „نسخ بالعربية" generieren eine fertige
  Produkt-Nachricht (Name, Beschreibung, Preis, Farben, Größen,
  Shop-Link) und legen sie in der Zwischenablage ab. Admin fügt sie
  manuell in den WhatsApp-Business-Katalog ein.

- **Token-Verschlüsselung vorbereitet.** Zukünftige eBay-/TikTok-Shop-
  OAuth-Tokens (Phase 2/3) werden AES-256-GCM envelope-verschlüsselt
  gespeichert. Master-Key in `CHANNEL_TOKEN_MASTER_KEY`. Setup:
  `docs/admin-runbook/master-key-management.md`.

**Für den normalen Tagesbetrieb ändert sich wenig:** Die drei Ads-
Feeds (Facebook/TikTok/Google) liefern bei korrekt gesetzten Channel-
Toggles byte-identische Output-Struktur wie vor Phase 1 — das
garantiert ein 14-Test Byte-Equal-Regression-Guard. Google-Feed hat
die neuen Shipping-Blöcke + Taxonomie-ID; Facebook + TikTok sind
output-identisch.

**Nächste Phase:** C8+ in Phase 2 bringt echte eBay-Integration
(OAuth, Listing-Sync, Order-Import). TikTok Shop in Phase 3. Diese
Phase-1-Infrastruktur ist das Fundament — jeder neue Channel-Adapter
hängt sich an das gleiche `ChannelProductListing` + `SalesChannelConfig`-
Modell, statt einen weiteren Boolean ins Product-Schema zu pressen.

---

**Technische Metriken (Phase 1, 7 Commits):**
- 7 atomare Commits auf `origin/main` (C1 → C7)
- +121 neue Backend-Tests (627 → 748 grün)
- 2 additive Prisma-Migrations (kein Datenverlust, kein Rollback-Bedarf)
- Null Code-Änderung in ReservationService, OrdersService,
  InvoiceService, AdminReturnsService, BackupService — alle kritischen
  Module unangetastet, Regressions-Schutz via existierende Tests.
- Jeder Commit hat ein dediziertes Meta-Verify: ein surgisch-
  eingereverter Fix bricht präzise die ihn schützenden Tests.
