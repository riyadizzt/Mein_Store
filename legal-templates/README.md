# Legal Templates — Malak Bekleidung

> ⚠ **WICHTIGER HINWEIS:** Diese Templates sind **Platzhalter** die als Ausgangspunkt
> für deinen Anwalt / Rechtsberater gedacht sind. Sie ersetzen **KEINE** rechtliche
> Beratung. Bevor du eine dieser Texte live schaltest, muss sie von einem in
> deutschem E-Commerce-Recht versierten Rechtsanwalt geprüft und angepasst werden.
>
> **NICHT EINFACH KOPIEREN UND LIVE NEHMEN** — falsche oder unvollständige Rechtstexte
> können zu Abmahnungen, Bußgeldern und Schadensersatzforderungen führen.

## Was hier drin ist

Diese Templates bilden den aktuellen Stand deines Shops ab (DE als Primärmarkt,
Versand an DE/AT/CH/BE/NL/FR/PL, Zahlungsmethoden Stripe/PayPal/Klarna/SumUp/Vorkasse,
DHL-Versand, 14-Tage-Widerruf, Cookie-Consent mit PostHog-Analytics).

```
legal-templates/
├── README.md                  ← DIESE DATEI
├── AGB_DE.md                  ← Allgemeine Geschäftsbedingungen (Deutsch)
├── AGB_EN.md                  ← Terms & Conditions (English)
├── AGB_AR.md                  ← الشروط والأحكام (Arabisch)
├── WIDERRUF_DE.md             ← Widerrufsbelehrung (Deutsch — gesetzliche Musterform!)
├── WIDERRUF_EN.md             ← Cancellation Policy (English)
└── WIDERRUF_AR.md             ← سياسة الإلغاء (Arabisch)
```

Alle Dateien enthalten `[PLATZHALTER: …]` Markierungen an Stellen wo dein Anwalt
anpassen oder bestätigen muss, zum Beispiel:
- Minimal- / Maximal-Alter
- Gerichtsstand
- Spezifische Lieferzeiten
- Wie Rücksendekosten genau kommuniziert werden
- Versicherungs-Klauseln

## Empfohlener Workflow

### 1. An den Anwalt geben
Schicke deinem Rechtsanwalt diese 6 Dateien. Erkläre kurz:
- Produkte: Bekleidung für Damen, Herren, Kinder
- Zielgruppe: Endverbraucher (B2C) in DE/AT/CH/BE/NL/FR/PL
- Zahlungsarten: Stripe (Kreditkarte), PayPal, Klarna, SumUp, Vorkasse (Banküberweisung)
- Versand: DHL Parcel DE Standard, kostenloser Versand ab 100€
- Retouren: 14-Tage-Widerrufsrecht, Kunde trägt Rücksendekosten (außer
  Shop-Admin markiert Retoure als "Shop zahlt Versand")
- Plattform: Eigener Shop (keine Marktplatz-AGB nötig)
- Rechtsform: `[PLATZHALTER: Einzelunternehmen / UG / GmbH — dein Anwalt passt an]`

### 2. Vom Anwalt angepasste Version zurückbekommen
Der Anwalt schickt dir die finalen Texte (meist als .docx oder PDF).
Kopiere den reinen Text in die jeweilige Datei hier.

### 3. In die Live-DB einfügen
Sobald die Texte finalisiert sind, nutze das Installationsscript:

```bash
cd apps/api
npx ts-node scripts/install-legal-content.ts --dry-run    # Vorschau
npx ts-node scripts/install-legal-content.ts              # Wirklich schreiben
```

Das Script liest alle 6 Dateien und upsert sie in die `shop_settings` Tabelle
unter den Keys `agb_de`, `agb_en`, `agb_ar`, `widerruf_de`, `widerruf_en`,
`widerruf_ar`. Die anderen Legal-Felder (Impressum, Datenschutz) werden
**nicht angefasst** — die sind bereits befüllt.

### 4. Alternativ: via Admin-Panel
Wenn du lieber manuell einfügen willst:
- `/de/admin/settings` → (Legal-Tab wenn vorhanden) oder der entsprechende Bereich
- Jede Textarea mit dem Inhalt der jeweiligen Datei füllen
- Speichern

## Wichtige Hinweise

1. **Widerrufsbelehrung ist gesetzlich genau vorgeschrieben.** Das Muster stammt
   aus Anlage 1 zu Artikel 246a § 1 Absatz 2 Satz 2 EGBGB. Abweichungen können
   den Widerrufszeitraum auf ein Jahr + 14 Tage verlängern!

2. **Die AGB müssen zur Bestellung explizit akzeptiert werden.** Der Checkout
   der Malak-Platform macht das bereits über den "Bestellen mit Zahlungspflicht"
   Button und den Haken "Ich akzeptiere AGB + Widerrufsbelehrung".

3. **Preise müssen immer mit MwSt angegeben sein.** Das ist bereits korrekt —
   der Shop zeigt durchgehend Brutto-Preise und rechnet die MwSt raus.

4. **Versand-Kosten müssen vor Bestellabschluss klar kommuniziert sein.** Das
   ist bereits korrekt — der Checkout zeigt Versandkosten in der Zusammenfassung.

5. **Für Verkäufe in andere EU-Länder** (AT/BE/NL/FR/PL) gelten zusätzliche
   Regeln zum OSS-Verfahren (One-Stop-Shop) und eventuell landesspezifische
   Anpassungen. Dein Anwalt sollte das explizit bestätigen.

## Was diese Templates NICHT abdecken

- **ODR-Link** ist enthalten (Pflicht nach § 14 Abs. 1 ODR-VO)
- **Verbraucherstreitbeilegung** ist im Template als "wir nehmen nicht teil" —
  prüfen ob das für dich gilt oder ob du freiwillig teilnimmst
- **Hinweise zu speziellen Produkten** (Lebensmittel, Kosmetik, Hygieneartikel):
  NICHT enthalten da du Bekleidung verkaufst. Falls du später erweiterst, müssen
  zusätzliche Klauseln dazu.
- **Klarna-spezifische Bedingungen**: NICHT enthalten. Klarna hat eigene AGB
  die der Kunde bei der Klarna-Checkout-Seite akzeptiert. Muss aber in deinen
  AGB als "externe Bedingungen" erwähnt werden.
- **Rechtswahl bei internationalen Bestellungen**: Template enthält Standard
  (Recht der Bundesrepublik Deutschland). Bei Verbrauchern kann aber zwingend
  das Recht des Wohnsitzstaates gelten — dein Anwalt muss entscheiden ob das
  so bleibt oder angepasst wird.

Stand dieser Templates: 2026-04-14
