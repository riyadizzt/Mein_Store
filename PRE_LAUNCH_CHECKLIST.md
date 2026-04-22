# ✅ PRE-LAUNCH TEST-CHECKLISTE — Malak Bekleidung

> **Stand:** 2026-04-13
> **Ziel:** Komplette Qualitätsprüfung vor Go-Live
> **Format:** ⬜ offen · 🟡 in Arbeit · ✅ erledigt · ❌ fehlgeschlagen

---

## 📋 INHALTSVERZEICHNIS

1. [Shop-Funktionen (Kundenseite)](#1-shop-funktionen-kundenseite)
2. [Admin-Dashboard](#2-admin-dashboard)
3. [Sicherheit](#3-sicherheit)
4. [Performance](#4-performance)
5. [Rechtlich (Deutschland)](#5-rechtlich-deutschland)
6. [Sprachen + RTL](#6-sprachen--rtl)
7. [Responsive](#7-responsive)
8. [DHL Adressvalidierung](#8-dhl-adressvalidierung)
9. [Smart Sizing System](#9-smart-sizing-system)
10. [KI-Integration](#10-ki-integration)
11. [DeepL Übersetzung](#11-deepl-übersetzung)
12. [Social Commerce](#12-social-commerce)
13. [Scanner-Funktionen](#13-scanner-funktionen)
14. [Cron-Jobs](#14-cron-jobs)
15. [Bestellungen — Spezialfälle](#15-bestellungen--spezialfälle)
16. [Login-Methoden](#16-login-methoden)
17. [Keyboard Shortcuts](#17-keyboard-shortcuts)
18. [Etiketten komplett](#18-etiketten-komplett)
19. [Zahlungen — Details](#19-zahlungen--details)
20. [Finanzberichte — Erstattungen](#20-finanzberichte--erstattungen)
21. [E-Mail Templates](#21-e-mail-templates)
22. [Fehlerseiten](#22-fehlerseiten)
23. [Browser-Kompatibilität](#23-browser-kompatibilität)
24. [Wartungsmodus](#24-wartungsmodus)
25. [Kontaktseite](#25-kontaktseite)
26. [Gift Cards](#26-gift-cards)
27. [Wishlist](#27-wishlist)
28. [Homepage Design Switcher](#28-homepage-design-switcher)
29. [Photon API Autocomplete](#29-photon-api-autocomplete)
30. [Toast/Snackbar System](#30-toastsnackbar-system)
31. [Master-Box System](#31-master-box-system)
32. [Export-Funktionen](#32-export-funktionen)
33. [Stripe + Klarna Webhooks](#33-stripe--klarna-webhooks)
34. [Guest Checkout](#34-guest-checkout)
35. [Tracking-Seite](#35-tracking-seite)
36. [Bestellbestätigungsseite](#36-bestellbestätigungsseite)
37. [Bilder-Infrastruktur](#37-bilder-infrastruktur)
38. [prefers-reduced-motion](#38-prefers-reduced-motion)
39. [Inventur (Stocktake)](#39-inventur-stocktake)
40. [Batch-Versand im Admin](#40-batch-versand-im-admin)

---

# 1. SHOP-FUNKTIONEN (KUNDENSEITE)

## 1.1 Homepage

✅ **[Homepage] Layout A wird als Standard angezeigt**
   Schritt: Cache leeren, `/` aufrufen
   Erwartet: Layout A (Editorial Premium) lädt mit Hero, Trust-Signals, Category Showcase, Bestsellers, Editorial Banner, New Arrivals, Newsletter

✅ **[Homepage] Layout B wird korrekt angezeigt**
   Schritt: Admin → Einstellungen → Homepage-Design → "B" → Speichern → `/` aufrufen
   Erwartet: Layout B (Minimal High-End) lädt ohne Hero-Bild, nur Text-Intro, Editorial Banner, Bestsellers, 2-Column Category Teaser, Newsletter

✅ **[Homepage] Layout C wird korrekt angezeigt**
   Schritt: Admin → Einstellungen → Homepage-Design → "C" → Speichern → `/` aufrufen
   Erwartet: Layout C (Dark Luxury) lädt mit dunklem Hintergrund, Gold-Akzenten, Editorial Split, dunklen Product Sections

✅ **[Homepage] Preview-Parameter funktioniert**
   Schritt: `/?preview=B` aufrufen (ohne Admin-Änderung)
   Erwartet: Layout B wird angezeigt, ohne Admin-Setting zu ändern

✅ **[Homepage] Campaign Hero Override funktioniert**
   Schritt: Admin → Campaigns → neue Kampagne mit heroBannerEnabled=true anlegen → Homepage aufrufen
   Erwartet: CampaignHero wird statt Standard-Hero angezeigt (in allen 3 Layouts)

✅ **[Homepage] Announcement Bar wird angezeigt**
   Schritt: Kampagne mit Announcement Bar aktivieren → Homepage
   Erwartet: Bar oben mit Custom Text und Farben sichtbar

✅ **[Homepage] Popup erscheint bei aktiver Kampagne**
   Schritt: Kampagne mit Popup aktivieren (delay 3s) → Homepage
   Erwartet: Popup erscheint nach 3s mit Coupon Code

## 1.2 Produktliste / Katalog

✅ **[Katalog] Produktliste lädt**
   Schritt: `/products` aufrufen
   Erwartet: Alle aktiven Produkte werden angezeigt mit Bild, Name, Preis

✅ **[Katalog] Kategorie-Filter funktioniert**
   Schritt: Kategorie "Schuhe" auswählen
   Erwartet: Nur Produkte der Kategorie "Schuhe" werden angezeigt

✅ **[Katalog] Farb-Filter funktioniert**
   Schritt: Farbe "Schwarz" auswählen
   Erwartet: Nur Produkte mit schwarzer Variante werden angezeigt

✅ **[Katalog] Größen-Filter funktioniert**
   Schritt: Größe "M" auswählen
   Erwartet: Nur Produkte mit Größe M werden angezeigt

✅ **[Katalog] Preis-Range Filter funktioniert**
   Schritt: Preis 20-100€ setzen
   Erwartet: Nur Produkte in diesem Preisbereich

✅ **[Katalog] Sortierung funktioniert**
   Schritt: Sortierung "Preis aufsteigend" wählen
   Erwartet: Produkte aufsteigend nach Preis sortiert

✅ **[Katalog] Sortierung "Neueste zuerst" funktioniert**
   Schritt: Sortierung "Neueste zuerst"
   Erwartet: Neueste Produkte zuerst

✅ **[Katalog] Pagination funktioniert**
   Schritt: Nach unten scrollen oder Seite 2 klicken
   Erwartet: Weitere Produkte werden geladen ohne Fehler

✅ **[Katalog] Keine Ergebnisse Seite**
   Schritt: Filter setzen die keine Produkte matchen
   Erwartet: "Keine Produkte gefunden" Meldung mit Reset-Button

## 1.3 Suche

✅ **[Suche] Instant-Search Overlay öffnet**
   Schritt: In Header auf Such-Icon klicken
   Erwartet: Overlay mit Suchfeld, Suchverlauf, Vorschläge

✅ **[Suche] Suchergebnisse bei Eingabe**
   Schritt: "Kleid" eingeben
   Erwartet: Nach 300ms Debounce erscheinen Ergebnisse im Overlay

✅ **[Suche] Keyboard-Shortcut ⌘K öffnet Suche**
   Schritt: ⌘K oder Ctrl+K drücken
   Erwartet: Suchoverlay öffnet

✅ **[Suche] Zero-Results wird geloggt**
   Schritt: Unsinniges Wort "xyzabc" suchen
   Erwartet: "Keine Ergebnisse" Meldung + Admin → Analytics zeigt Zero-Result

✅ **[Suche] Full-Text + ILIKE Fallback**
   Schritt: Deutsches Wort "Hose" suchen
   Erwartet: Alle Hosen-Produkte werden gefunden (auch bei Varianten)

✅ **[Suche] Arabische Suche funktioniert**
   Schritt: In AR-Locale "فستان" eingeben
   Erwartet: Relevante Produkte in Arabisch werden gefunden

## 1.4 Produktdetailseite (PDP)

✅ **[PDP] Produkt lädt mit allen Bildern**
   Schritt: Beliebiges Produkt anklicken
   Erwartet: Produktname, Beschreibung, Preis, Bilder-Gallery laden

✅ **[PDP] Gallery-Zoom funktioniert**
   Schritt: Auf Haupt-Bild klicken
   Erwartet: Fullscreen Lightbox öffnet mit Zoom + Pan

✅ **[PDP] Bildnavigation per Thumbnails**
   Schritt: Auf Thumbnail unten klicken
   Erwartet: Haupt-Bild wechselt zum Thumbnail-Bild

✅ **[PDP] Drag/Swipe auf Mobile funktioniert**
   Schritt: Mobile-Ansicht, Bild nach links wischen
   Erwartet: Nächstes Bild erscheint mit Slide-Animation

✅ **[PDP] Größenauswahl funktioniert**
   Schritt: Größe "L" anklicken
   Erwartet: Größe wird gold umrahmt, Varianten-State aktualisiert

✅ **[PDP] Ausverkaufte Größen durchgestrichen**
   Schritt: Produkt mit out-of-stock Variante öffnen
   Erwartet: Nicht verfügbare Größe ist durchgestrichen + disabled

✅ **[PDP] Farbauswahl wechselt Bilder**
   Schritt: Andere Farbe anklicken
   Erwartet: Haupt-Bild wechselt zum farbspezifischen Bild

✅ **[PDP] Stock-Progress-Bar bei ≤5**
   Schritt: Produkt mit 3 Stück auf Lager öffnen
   Erwartet: Stock-Bar mit "Nur noch 3 verfügbar" angezeigt

✅ **[PDP] "Auf Lager" bei >5**
   Schritt: Produkt mit 10+ Stück öffnen
   Erwartet: "Auf Lager" Badge (nicht Zahl)

✅ **[PDP] Add-to-Cart funktioniert**
   Schritt: Größe wählen, "In den Warenkorb" klicken
   Erwartet: Cart-Drawer öffnet, Toast "Hinzugefügt", Cart-Counter +1

✅ **[PDP] Wishlist-Herz funktioniert**
   Schritt: Auf Herz klicken
   Erwartet: Herz wird gefüllt, Produkt in Wishlist gespeichert

✅ **[PDP] Bewertungen werden angezeigt**
   Schritt: Produkt mit Reviews öffnen
   Erwartet: Sterne-Durchschnitt, Verteilung, Reviews-Liste

✅ **[PDP] Review schreiben funktioniert**
   Schritt: Als eingeloggter Kunde "Bewertung schreiben" klicken
   Erwartet: Modal öffnet, Sterne + Text möglich, Submit → pending Status

✅ **[PDP] Größenberatung (Smart Sizing) öffnet**
   Schritt: "Größentabelle" klicken
   Erwartet: Modal mit Tabelle, Mannequin-Figur, 3 Tabs

✅ **[PDP] Smart Sizing Empfehlung**
   Schritt: Als eingeloggter Kunde mit gespeicherten Maßen
   Erwartet: KI-Empfehlung zeigt passende Größe

✅ **[PDP] Related Products werden angezeigt**
   Schritt: Zum unteren Bereich scrollen
   Erwartet: 4-6 verwandte Produkte erscheinen

✅ **[PDP] Zuletzt angesehen werden angezeigt**
   Schritt: Mehrere Produkte öffnen, dann ein neues
   Erwartet: "Zuletzt angesehen" Sektion mit vorherigen Produkten

✅ **[PDP] Breadcrumbs korrekt**
   Schritt: Produkt öffnen
   Erwartet: Home > Kategorie > Produktname (klickbar)

✅ **[PDP] Trust Bar sichtbar**
   Schritt: PDP aufrufen
   Erwartet: Trust-Signale (Kundenservice, Sichere Zahlung, Versand, DSGVO)

✅ **[PDP] Mobile Sticky Bar funktioniert**
   Schritt: Mobile-Ansicht, nach unten scrollen
   Erwartet: Sticky Bar unten mit Preis + Add-to-Cart Button

✅ **[PDP] Notify-me bei Ausverkauf**
   Schritt: Produkt mit 0 Bestand öffnen
   Erwartet: "Benachrichtigen" Button statt Add-to-Cart

✅ **[PDP] Hinweis bei excludeFromReturns**
   Schritt: Produkt mit excludeFromReturns=true öffnen
   Erwartet: Hinweis "Dieses Produkt kann nicht retourniert werden"

## 1.5 Warenkorb

✅ **[Cart] Cart-Drawer öffnet**
   Schritt: Cart-Icon in Header klicken
   Erwartet: Drawer slidet rein mit allen Items

✅ **[Cart] Menge erhöhen funktioniert**
   Schritt: "+" Button neben Menge klicken
   Erwartet: Menge erhöht sich, Gesamtpreis aktualisiert

✅ **[Cart] Menge verringern funktioniert**
   Schritt: "-" Button klicken
   Erwartet: Menge verringert sich, Gesamtpreis aktualisiert

✅ **[Cart] Item entfernen funktioniert**
   Schritt: Papierkorb-Icon klicken
   Erwartet: Item wird entfernt, Undo-Toast erscheint

✅ **[Cart] Undo-Toast stellt Item wieder her**
   Schritt: "Rückgängig" im Undo-Toast klicken
   Erwartet: Item erscheint wieder im Cart

✅ **[Cart] Swipe-to-delete funktioniert (Mobile)**
   Schritt: Mobile, Item nach links wischen
   Erwartet: Delete-Button erscheint, Swipe komplett → Item entfernt

✅ **[Cart] Gratis-Versand Progress-Bar**
   Schritt: Warenkorb unter 100€
   Erwartet: Progress-Bar "Noch X€ bis Gratisversand"

✅ **[Cart] Gratis-Versand ab 100€**
   Schritt: Warenkorb über 100€
   Erwartet: "Gratis-Versand freigeschaltet" Meldung

✅ **[Cart] Coupon-Code eingeben**
   Schritt: Coupon-Code in Feld eingeben + "Einlösen"
   Erwartet: Rabatt wird angewendet oder Fehler bei ungültig

✅ **[Cart] Ungültiger Coupon zeigt Fehler**
   Schritt: "INVALID" Code eingeben
   Erwartet: Fehlermeldung "Coupon nicht gültig"

✅ **[Cart] Abgelaufener Coupon zeigt Fehler**
   Schritt: Expired Coupon eingeben
   Erwartet: Fehler "Coupon ist abgelaufen"

✅ **[Cart] Free-Shipping Coupon → Versand auf 0€**
   Schritt: freeShipping Coupon einlösen
   Erwartet: Versandkosten = 0€, Rabatt = 0€

✅ **[Cart] Echtzeit-Bestandsprüfung**
   Schritt: Produkt mit 2 Stück in Cart, jemand anders kauft 1
   Erwartet: Cart zeigt "Nur noch 1 verfügbar" beim Reload

✅ **[Cart] Gesamt-Berechnung korrekt**
   Schritt: Mehrere Items mit verschiedenen Preisen
   Erwartet: Zwischensumme + Versand - Rabatt = Gesamt (Brutto inkl. MwSt)

✅ **[Cart] MwSt wird rausgerechnet (nicht addiert)**
   Schritt: Item mit 100€ Bruttopreis
   Erwartet: "Enthaltene MwSt (19%): 15,97€" — totalAmount bleibt 100€

## 1.6 Checkout

✅ **[Checkout] Guest-Checkout funktioniert**
   Schritt: Cart → Checkout → "Als Gast bestellen"
   Erwartet: Formular für Adresse + Zahlung ohne Registrierung

✅ **[Checkout] Login-Checkout funktioniert**
   Schritt: Cart → Checkout → Login
   Erwartet: Gespeicherte Adressen werden geladen

✅ **[Checkout] GuestOrLogin — kein Infinite Loop**
   Schritt: Checkout aufrufen, zwischen Guest/Login hin-und-her wechseln
   Erwartet: Keine Endlosschleife, UI stabil

✅ **[Checkout] Adressformular validiert**
   Schritt: Leere Pflichtfelder, "Weiter" klicken
   Erwartet: Fehlermeldungen bei leeren Feldern

✅ **[Checkout] PLZ→Stadt Auto-Fill**
   Schritt: "10115" als PLZ eingeben
   Erwartet: Stadt "Berlin" wird automatisch ausgefüllt

✅ **[Checkout] PLZ↔Stadt Mismatch-Warnung**
   Schritt: PLZ "10115" + Stadt "München"
   Erwartet: Warnung "PLZ passt nicht zur Stadt" + Korrekturvorschlag

✅ **[Checkout] Photon Autocomplete funktioniert**
   Schritt: "Alexanderpl" eingeben
   Erwartet: Vorschlag "Alexanderplatz, Berlin" erscheint

✅ **[Checkout] DHL-Validierung bei Adress-Eingabe**
   Schritt: Adresse eintragen, Formular weiter
   Erwartet: Spinner "Adresse wird geprüft", dann OK oder Warnung

✅ **[Checkout] Ungültige DHL-Adresse → "Trotzdem fortfahren"**
   Schritt: Ungültige PLZ eingeben
   Erwartet: Warnung + Button "Trotzdem fortfahren" möglich

✅ **[Checkout] Versandmethode wählen**
   Schritt: Versand-Schritt
   Erwartet: Versandzonen-basierte Optionen (DHL Standard, Express)

✅ **[Checkout] Zahlungsschritt — deaktivierte Methoden ausgeblendet**
   Schritt: Admin → Klarna deaktivieren → Checkout
   Erwartet: Klarna wird nicht angezeigt

✅  **[Checkout] Stripe Karte — Widget lädt**
   Schritt: "Kreditkarte" wählen
   Erwartet: Stripe Element (Nummer, Ablauf, CVC) erscheint

✅ **[Checkout] Stripe-Zahlung erfolgreich**
   Schritt: Test-Karte 4242 4242 4242 4242, 12/30, 123
   Erwartet: Redirect zu Bestätigungsseite mit Bestellnummer

✅ **[Checkout] Stripe-Zahlung abgelehnt**
   Schritt: Test-Karte 4000 0000 0000 0002
   Erwartet: Fehlermeldung "Zahlung abgelehnt", Cart bleibt

✅ **[Checkout] Klarna-Flow funktioniert**
   Schritt: "Klarna" wählen → Weiter
   Erwartet: Redirect zu Klarna, Test-Login, zurück mit Erfolg

✅ **[Checkout] PayPal-Flow funktioniert**
   Schritt: "PayPal" wählen → Weiter
   Erwartet: Redirect zu PayPal Sandbox, zurück → Capture → Erfolg

✅ **[Checkout] PayPal Capture nach Redirect**
   Schritt: PayPal-Flow abschließen
   Erwartet: Bestätigungsseite ruft capture-paypal auf, Order → paid

✅ **[Checkout] SumUp Card-Widget lädt**
   Schritt: "SumUp" wählen
   Erwartet: SumUp Card Widget erscheint

✅ **[Checkout] SumUp-Zahlung erfolgreich**
   Schritt: Test-Karte in SumUp Widget, Submit
   Erwartet: Verify-Endpoint wird aufgerufen, Order → paid

✅ **[Checkout] SumUp — kein Fallback ohne Verify**
   Schritt: Versuch, ohne Verify zur Bestätigung zu gehen
   Erwartet: Nicht möglich, explizite Prüfung

✅ **[Checkout] Vorkasse wählen**
   Schritt: "Vorkasse (Banküberweisung)" wählen
   Erwartet: Erklärungstext bei Auswahl sichtbar

✅ **[Checkout] Vorkasse → Bankdaten auf Bestätigung**
   Schritt: Vorkasse-Bestellung abschließen
   Erwartet: Bestätigungsseite zeigt IBAN + Referenznummer

✅ **[Checkout] Vorkasse — kein Rechnungs-Download vor Zahlung**
   Schritt: Vorkasse-Bestellung, zum Kundenkonto
   Erwartet: Invoice-Button NICHT sichtbar bei pending_payment

✅ **[Checkout] Vorkasse → 7-Tage-Reminder**
   Schritt: Vorkasse-Bestellung älter als 7 Tage ohne Zahlung
   Erwartet: Reminder-E-Mail wird versendet (Cron)

✅ **[Checkout] Vorkasse → 10-Tage-Cancel**
   Schritt: Vorkasse-Bestellung älter als 10 Tage
   Erwartet: Auto-Stornierung per Cron

✅ **[Checkout] Payment-Timeout → Auto-Cancel**
   Schritt: Bestellung mit pending_payment länger als 30min
   Erwartet: Auto-Stornierung per Cron

✅ **[Checkout] 3-Schritt Progress Bar**
   Schritt: Checkout durchlaufen
   Erwartet: Progress zeigt Adresse → Versand → Zahlung

✅ **[Checkout] Bestellbestätigung zeigt alle Details**
   Schritt: Bestellung abschließen
   Erwartet: Bestellnummer, Artikel, Adresse, Zahlung, Versand

✅ **[Checkout] Bestätigungs-E-Mail kommt an**
   Schritt: Nach Checkout E-Mail prüfen
   Erwartet: HTML-E-Mail mit Bestellübersicht + Rechnung (außer Vorkasse)

✅ **[Checkout] UTM-Kanal-Attribution funktioniert**
   Schritt: Shop mit `?utm_source=facebook` öffnen, bestellen
   Erwartet: Bestellung in DB hat channel=facebook

## 1.7 Authentifizierung

✅ **[Auth] Registrierung mit E-Mail**
   Schritt: /auth/register → Formular ausfüllen → Submit
   Erwartet: Account erstellt, Verification-E-Mail gesendet

✅ **[Auth] E-Mail-Verifizierung funktioniert**
   Schritt: Link in Verification-E-Mail klicken
   Erwartet: Account bestätigt, Login möglich

✅ **[Auth] Login mit E-Mail + Passwort**
   Schritt: /auth/login → Credentials → Submit
   Erwartet: JWT im Cookie, Redirect zu /account

✅ **[Auth] Falsches Passwort**
   Schritt: Falsches Passwort eingeben
   Erwartet: Fehlermeldung "Ungültige Zugangsdaten"

✅  **[Auth] Account-Sperre nach 5 Fehlern**
   Schritt: 5× falsches Passwort
   Erwartet: Account temporär gesperrt, Hinweis angezeigt

✅  **[Auth] Password-Reset funktioniert**
   Schritt: "Passwort vergessen" → E-Mail → Link → Neues Passwort
   Erwartet: Passwort geändert, Login mit neuem möglich

✅  **[Auth] Google OAuth funktioniert**
   Schritt: "Mit Google anmelden" klicken
   Erwartet: Google-Dialog, zurück → Account verknüpft

✅ **[Auth] Google OAuth Abbruch → zurück zum Login**
   Schritt: Google-Dialog abbrechen
   Erwartet: Redirect zur Login-Seite (kein JSON 401)

⬜ **[Auth] Facebook OAuth funktioniert**
   Schritt: "Mit Facebook anmelden" klicken
   Erwartet: Facebook-Dialog, zurück → Account verknüpft

⬜ **[Auth] Facebook OAuth Abbruch → zurück zum Login**
   Schritt: Facebook-Dialog abbrechen
   Erwartet: Redirect zur Login-Seite

✅ **[Auth] JWT-Refresh funktioniert**
   Schritt: Länger als Access-Token-Laufzeit warten
   Erwartet: Refresh-Token erneuert JWT automatisch

✅ **[Auth] Logout löscht Session**
   Schritt: "Abmelden" klicken
   Erwartet: Cookies gelöscht, Redirect zu Home

## 1.8 Kundenkonto

✅ **[Account] Dashboard lädt**
   Schritt: /account aufrufen
   Erwartet: Überblick mit letzten Bestellungen + Quick-Links

✅ **[Account] Bestellungen-Liste**
   Schritt: /account/orders aufrufen
   Erwartet: Alle Bestellungen mit Status + Bestellnummer

✅ **[Account] Bestelldetail mit Progress-Bar**
   Schritt: Bestellung anklicken
   Erwartet: 5-Schritt Progress (Bestellt → Bezahlt → Verpackt → Versandt → Geliefert)

✅ **[Account] Farbspezifische Bilder in Bestellung**
   Schritt: Bestellung mit farbiger Variante öffnen
   Erwartet: Bild zeigt die bestellte Farbe (nicht erstes Bild)

✅ **[Account] Retouren-Status sichtbar**
   Schritt: Bestellung mit aktiver Retoure öffnen
   Erwartet: Farbige Status-Box mit Retourennummer + Betrag

✅ **[Account] Retournierte Artikel markiert**
   Schritt: Bestellung mit Teilretoure öffnen
   Erwartet: Retournierte Items durchgestrichen + "Retourniert" Badge

✅ **[Account] Retouren-Button ausgeblendet bei aktiver Retoure**
   Schritt: Bestellung mit offener Retoure öffnen
   Erwartet: Kein "Retoure anfordern" Button mehr

✅ **[Account] Erstattungszeile in Zusammenfassung**
   Schritt: Bestellung mit Erstattung öffnen
   Erwartet: Grüne "-XX,XX €" Zeile sichtbar

✅ **[Account] Stornierung zeigt rote Badges**
   Schritt: Vollstornierte Bestellung öffnen
   Erwartet: Alle Artikel mit rotem "Storniert" Badge

✅ **[Account] Retry-Payment Seite funktioniert**
   Schritt: Unbezahlte Bestellung → "Jetzt bezahlen"
   Erwartet: Zahlungs-Seite mit allen Methoden (Stripe, PayPal, SumUp, Vorkasse)

✅ **[Account] Adressen CRUD**
   Schritt: /account/addresses → Neue Adresse → Bearbeiten → Löschen
   Erwartet: Alle Operationen funktionieren, Default-Adresse setzbar

✅ **[Account] Adresse mit Order-Referenz — Soft Delete**
   Schritt: Adresse löschen die in Bestellung verwendet wurde
   Erwartet: Kein 409, Adresse wird soft-deleted

✅ **[Account] Maße speichern (Smart Sizing)**
   Schritt: /account/measurements → Maße eingeben → Speichern
   Erwartet: Maße gespeichert, in PDP verfügbar

✅ **[Account] Wishlist anzeigen**
   Schritt: /account/wishlist aufrufen
   Erwartet: Alle favorisierten Produkte werden angezeigt

✅ **[Account] Wishlist → Cart**
   Schritt: Von Wishlist in Cart hinzufügen
   Erwartet: Item im Cart, Wishlist-Counter korrekt

✅ **[Account] Passwort ändern**
   Schritt: /account/security → Altes + Neues Passwort → Speichern
   Erwartet: Passwort geändert, neuer Login funktioniert

✅ **[Account] DSGVO-Datenexport**
   Schritt: /account/privacy → "Meine Daten anfordern"
   Erwartet: E-Mail mit ZIP-Datei aller Daten

✅ **[Account] DSGVO-Löschung**
   Schritt: /account/privacy → "Account löschen" → Bestätigen
   Erwartet: Account anonymisiert, Daten-Retention für GoBD-Pflichtdaten

## 1.9 Retouren

✅ **[Return] Retoure anfordern**
   Schritt: Bestellung öffnen → "Retoure anfordern"
   Erwartet: Modal mit Artikel-Auswahl

✅ **[Return] Teilretoure mit Mengenregler**
   Schritt: Bei Item mit Menge 6 auf "2 zurückgeben" setzen
   Erwartet: Regler funktioniert, nur 2 Stück als Retoure markiert

✅ **[Return] Grund auswählen**
   Schritt: Grund aus Dropdown wählen
   Erwartet: Grund wird gespeichert

✅ **[Return] Retoure einreichen**
   Schritt: Formular absenden
   Erwartet: Status "requested", Retourennummer RET-YYYY-NNNNN

✅ **[Return] E-Mail "Retoure eingegangen"**
   Schritt: Nach Einreichung Mailbox prüfen
   Erwartet: Arabisch/DE/EN E-Mail kommt an

✅ **[Return] "Wird geprüft" Status angezeigt**
   Schritt: Bestelldetails öffnen
   Erwartet: Nur "Wird geprüft" Text, KEIN Download/Details

✅ **[Return] Nach Admin-Approve → Anweisungen sichtbar**
   Schritt: Admin genehmigt mit "Shop zahlt Versand"
   Erwartet: Kunde sieht Label-Download-Button

✅ **[Return] Bei "Kunde zahlt" → Shop-Adresse angezeigt**
   Schritt: Admin genehmigt mit "Kunde zahlt"
   Erwartet: Shop-Adresse + Barcode sichtbar

✅ **[Return] Label-Download**
   Schritt: "Label herunterladen" klicken
   Erwartet: PDF mit CODE128 Barcode + Retourennummer + Artikeln

✅ **[Return] Excluded Produkte nicht retournierbar**
   Schritt: Bestellung mit excludeFromReturns-Produkt
   Erwartet: Diese Items nicht in Retoure-Modal wählbar

## 1.10 Content / Rechtliche Seiten

✅ **[Legal] Impressum vollständig**
   Schritt: /legal/impressum aufrufen
   Erwartet: Name, Adresse, E-Mail, Tel, USt-IdNr, HR, GF

✅ **[Legal] AGB vorhanden**
   Schritt: /legal/agb aufrufen
   Erwartet: Komplette AGB mit Bestellprozess, Widerruf, Gewährleistung

✅ **[Legal] Widerrufsbelehrung**
   Schritt: /legal/widerruf aufrufen
   Erwartet: 14-Tage-Widerruf, Kunde trägt Kosten, Widerrufsformular

✅ **[Legal] Datenschutzerklärung**
   Schritt: /legal/datenschutz aufrufen
   Erwartet: DSGVO-konform, alle Tracking-Tools gelistet

✅ **[Content] Kontakt-Seite funktioniert**
   Schritt: /contact aufrufen
   Erwartet: Formular, Gold-Icons, Telefon dir="ltr"

✅ **[Content] Kontaktformular sendet E-Mail**
   Schritt: Formular ausfüllen + Submit
   Erwartet: E-Mail an Admin kommt an

✅ **[Content] Lookbook-Seite lädt**
   Schritt: /lookbook aufrufen
   Erwartet: Editorial Hero, 3 Sektionen, Featured Products

✅ **[Content] About-Seite lädt**
   Schritt: /about aufrufen
   Erwartet: Brand Story, Werte, Zahlen, Kontakt-CTA

## 1.11 Consent / Newsletter

✅ **[Consent] Cookie-Banner erscheint bei erstem Besuch**
   Schritt: Inkognito-Fenster → Homepage
   Erwartet: Banner unten mit 3 Kategorien (Essential/Analytics/Marketing)

✅ **[Consent] "Alle akzeptieren" funktioniert**
   Schritt: Im Banner alle akzeptieren
   Erwartet: Consent in localStorage, PostHog wird initialisiert

✅ **[Consent] "Essential only"**
   Schritt: Nur Essential akzeptieren
   Erwartet: Kein PostHog-Init, kein Tracking

✅ **[Consent] Settings-Modal — Feingranulare Auswahl**
   Schritt: "Einstellungen" → Einzelne Kategorien togglen
   Erwartet: Nur gewählte Kategorien aktiv

✅ **[Consent] Consent zurücksetzen möglich**
   Schritt: Im Footer Cookie-Einstellungen öffnen
   Erwartet: Settings können jederzeit geändert werden

⬜ **[Newsletter] Anmeldung funktioniert**
   Schritt: E-Mail im Footer/Homepage eingeben
   Erwartet: Double-Opt-In E-Mail kommt an

✅ **[Newsletter] Abmeldung funktioniert**
   Schritt: Unsubscribe-Link in Newsletter klicken
   Erwartet: Abmeldung erfolgreich, E-Mail nicht mehr auf Liste

## 1.12 Wartungsmodus

✅ **[Maintenance] Wartungsmodus AN → Seite erscheint**
   Schritt: Admin → Wartungsmodus → AN → Shop besuchen
   Erwartet: Maintenance-Seite mit Countdown + Logo

⬜ **[Maintenance] E-Mail-Sammlung funktioniert**
   Schritt: Wartungsseite → E-Mail eingeben → Submit
   Erwartet: E-Mail in DB, Dankesnachricht

✅ **[Maintenance] Countdown wird richtig angezeigt**
   Schritt: Wartungsseite mit Countdown
   Erwartet: Live-Countdown bis End-Datum

✅ **[Maintenance] Admin kommt noch ins Backend**
   Schritt: Mit Admin-Login /admin aufrufen
   Erwartet: Admin-Zugang trotz Wartungsmodus möglich

✅ **[Maintenance] Auto-Disable nach End-Datum**
   Schritt: End-Datum in Vergangenheit, Cron laufen lassen
   Erwartet: Wartungsmodus automatisch AUS

---

# 2. ADMIN-DASHBOARD

## 2.1 Login + Sessions

✅ **[Admin] Admin-Login funktioniert**
   Schritt: /admin/login → Credentials → Submit
   Erwartet: Redirect zu Dashboard

✅ **[Admin] Falsche Credentials**
   Schritt: Falsches Passwort
   Erwartet: Fehlermeldung, kein Redirect

✅ **[Admin] 8h Session-Ablauf**
   Schritt: Nach 8h weiter arbeiten
   Erwartet: Session abgelaufen, Re-Login nötig

✅ **[Admin] 30min Inaktivität**
   Schritt: 30min keine Aktion
   Erwartet: Auto-Logout, Re-Login nötig

⬜ **[Admin] 2FA-Login (falls aktiv)**
   Schritt: Mit 2FA aktiviertem Account einloggen
   Erwartet: 2FA-Code abgefragt nach Passwort

## 2.2 Dashboard / KPIs

✅ **[Dashboard] KPIs werden korrekt angezeigt**
   Schritt: /admin/dashboard aufrufen
   Erwartet: Umsatz heute, offene Bestellungen, Pending Returns, Alerts

✅ **[Dashboard] Charts laden**
   Schritt: Scroll zu Revenue Chart
   Erwartet: Letzte 30 Tage Umsatz-Chart

✅ **[Dashboard] Top-Produkte-Liste**
   Schritt: Scroll zu Top-Produkte
   Erwartet: Top 10 Produkte mit Umsatz

✅ **[Dashboard] Kanal-Donut-Chart**
   Schritt: Kanal-Breakdown
   Erwartet: Donut mit 6 Kanälen (website, mobile, pos, facebook, instagram, tiktok)

## 2.3 Bestellungen

✅ **[Orders] Bestell-Liste lädt**
   Schritt: /admin/orders
   Erwartet: Tabelle mit allen Bestellungen, Sortiert nach Datum

✅ **[Orders] Filter nach Status**
   Schritt: Filter "Pending"
   Erwartet: Nur pending Bestellungen

✅ **[Orders] Filter nach Kanal**
   Schritt: Filter "Facebook"
   Erwartet: Nur FB-Bestellungen

✅ **[Orders] Suche nach Bestellnummer**
   Schritt: "ORD-2026-001" eingeben
   Erwartet: Spezifische Bestellung gefunden

✅ **[Orders] Suche nach Kundenname**
   Schritt: Kundenname eingeben
   Erwartet: Alle Bestellungen des Kunden

✅ **[Orders] Detail-Ansicht lädt**
   Schritt: Bestellung anklicken
   Erwartet: Progress-Bar, Kunde, Adresse, Items, Zahlung, Versand

✅ **[Orders] Progress-Bar mit Icons + Animationen**
   Schritt: Bestelldetail ansehen
   Erwartet: 5 Icons, Gold-Ring pulsiert, gestrichelte Linien

✅ **[Orders] Status manuell ändern**
   Schritt: Status-Dropdown → "Versandt"
   Erwartet: Status geändert, E-Mail an Kunde

✅ **[Orders] Vollstornierung funktioniert**
   Schritt: "Stornieren" → "Komplett"
   Erwartet: Alle Items storniert, Refund + Bestand zurück

✅ **[Orders] Teilstornierung funktioniert**
   Schritt: "Stornieren" → "Einzelne Items wählen"
   Erwartet: Teil-Refund, Bestand nur für stornierte Items zurück

✅ **[Orders] Stripe-Refund funktioniert**
   Schritt: Paid Order → Stornieren
   Erwartet: Stripe Refund API wird aufgerufen, Status → refunded

✅ **[Orders] Refund-Retry bei Fehler**
   Schritt: Refund mit Netzwerkfehler
   Erwartet: Status "failed", Retry-Button verfügbar

✅ **[Orders] Zahlungs-Logos statt Text**
   Schritt: Bestell-Liste ansehen
   Erwartet: Stripe/PayPal/SumUp/Vorkasse-Logos sichtbar

✅ **[Orders] Kanal-Icons sichtbar**
   Schritt: Bestell-Liste
   Erwartet: Kanal-Icons (FB, IG, TT, Website, POS) pro Zeile

✅ **[Orders] DHL Label erstellen**
   Schritt: "Label erstellen" in Order-Detail
   Erwartet: Adress-Bestätigungsdialog, dann Label-PDF Download

✅ **[Orders] DHL Adress-Warnung bei fehlenden Feldern**
   Schritt: Bestellung ohne Hausnummer
   Erwartet: Warnung vor Label-Erstellung

✅ **[Orders] DHL Batch-Versand**
   Schritt: Mehrere Bestellungen → "Batch Label"
   Erwartet: Dialog mit Liste, Ausschluss-Checkboxen, alle Labels erstellt

✅ **[Orders] Lieferadresse inline bearbeiten**
   Schritt: Pencil-Icon → Adresse ändern → Speichern
   Erwartet: Adresse aktualisiert

✅ **[Orders] Rechnung PDF-Download**
   Schritt: "Rechnung" klicken
   Erwartet: PDF mit echten Firmendaten, IBAN, Lieferadresse

✅ **[Orders] Lieferschein PDF**
   Schritt: "Lieferschein" klicken
   Erwartet: PDF ohne Preise

✅ **[Orders] Tages-Gruppierung in Sendungen**
   Schritt: /admin/shipments
   Erwartet: Gruppen nach Tag klappbar mit Gold-Header

## 2.4 Produkte

✅ **[Products] Produktliste lädt**
   Schritt: /admin/products
   Erwartet: Grid/Tabelle mit allen Produkten

✅ **[Products] Filter Aktiv/Inaktiv/Gelöscht**
   Schritt: Filter wechseln
   Erwartet: Produkte korrekt gefiltert

✅ **[Products] Produkt erstellen**
   Schritt: "Neues Produkt" → Felder ausfüllen → Speichern
   Erwartet: Produkt in DB, SKU MAL-000001-SCH-M generiert

✅ **[Products] Bilder hochladen**
   Schritt: Produkt-Edit → Bilder-Drop-Zone
   Erwartet: Upload zu R2/Cloudinary, Vorschau sichtbar

✅ **[Products] Bilder sortieren**
   Schritt: Drag & Drop Bilder
   Erwartet: Reihenfolge gespeichert

✅ **[Products] Varianten erstellen (Größe × Farbe)**
   Schritt: Edit → Varianten-Matrix generieren
   Erwartet: Alle Kombinationen erstellt mit eigenen SKUs

✅ **[Products] Übersetzungen DE/EN/AR**
   Schritt: Sprach-Tabs durchgehen
   Erwartet: Alle 3 Sprachen speicherbar

✅ **[Products] Kanal-Zuordnung togglen**
   Schritt: Toggle Facebook AN
   Erwartet: Produkt erscheint nur noch im Facebook-Feed

✅ **[Products] AI-Beschreibung generieren**
   Schritt: "KI-Beschreibung" Button → Bild wird analysiert
   Erwartet: 3-sprachige Beschreibung + SEO Meta generiert

✅ **[Products] AI-Übernahme funktioniert**
   Schritt: Generierte Beschreibung → "Übernehmen"
   Erwartet: Felder werden ausgefüllt, speicherbar

✅ **[Products] Soft Delete funktioniert**
   Schritt: "Löschen" → Bestätigen
   Erwartet: Status "deleted", Produkt nicht mehr im Shop

✅ **[Products] Restore funktioniert**
   Schritt: Filter "Gelöscht" → "Wiederherstellen"
   Erwartet: Produkt wieder aktiv

✅ **[Products] excludeFromReturns-Toggle**
   Schritt: Toggle AN, speichern
   Erwartet: Produkt erscheint nicht im Retoure-Modal

## 2.5 Kategorien

✅ **[Categories] Baum-Struktur lädt**
   Schritt: /admin/categories
   Erwartet: Hierarchische Struktur angezeigt

✅ **[Categories] Neue Kategorie erstellen**
   Schritt: "Neu" → Name DE/EN/AR → Bild → Speichern
   Erwartet: Kategorie in DB und Baum

✅ **[Categories] Sortierung mit Up/Down-Pfeilen**
   Schritt: Pfeil-Button klicken
   Erwartet: Reihenfolge gespeichert

✅ **[Categories] Suche nach Kategorie**
   Schritt: Suchfeld "Schuhe"
   Erwartet: Treffer werden hervorgehoben

## 2.6 Inventar

✅ **[Inventory] Flat-View lädt**
   Schritt: /admin/inventory
   Erwartet: Tabelle mit allen Varianten und Beständen

✅ **[Inventory] Grouped-View mit Matrix**
   Schritt: "Gruppiert" Toggle
   Erwartet: Produkte mit Farb×Größen-Matrix, Lager-Spalten

✅ **[Inventory] Lager-Filter**
   Schritt: Filter "Hamburg"
   Erwartet: Nur Hamburg-Bestände

✅ **[Inventory] Standort-Filter (Box-Badges)**
   Schritt: Filter nach BOX-2026-W-001
   Erwartet: Nur Bestände dieser Box

✅ **[Inventory] Transfer zwischen Lagern**
   Schritt: Variante → Transfer → Menge → Ziel-Lager
   Erwartet: Bestand korrekt verschoben, Audit-Log-Eintrag

✅ **[Inventory] Scanner öffnet (Kamera)**
   Schritt: Scanner-Icon klicken
   Erwartet: Kamera-Zugriff, Scanning funktioniert

✅ **[Inventory] Scanner öffnet (USB-Handgerät)**
   Schritt: USB-Scanner verwenden
   Erwartet: Barcode wird erkannt

✅ **[Inventory] Bestandswarnung ≤3**
   Schritt: Scanner-Output bei Variante mit 2 Stück
   Erwartet: Rote Warnung bleibt bis manuell geschlossen

✅ **[Inventory] Buchungs-Vorprüfung**
   Schritt: Scanner-Output mit nicht-verfügbarem Artikel
   Erwartet: Roter Artikel markiert, Buchung blockiert

✅ **[Inventory] Wareneingang mit Farbpicker**
   Schritt: /admin/suppliers/{id}/intake
   Erwartet: Farbpicker + Größenpresets funktionieren

✅ **[Inventory] DeepL-Übersetzung im Wareneingang**
   Schritt: Produktname AR eingeben
   Erwartet: Auto-Übersetzung nach DE

✅ **[Inventory] CSV-Import**
   Schritt: CSV hochladen
   Erwartet: Bestände korrekt importiert

✅ **[Inventory] Return-Barcode-Scan**
   Schritt: Return-Label scannen
   Erwartet: Retoure als "empfangen" markiert

✅ **[Inventory] Negative Mengen blockiert**
   Schritt: Intake mit qty=-5
   Erwartet: BadRequest, kein Bestand geändert

✅ **[Inventory] Max-Limit 10.000 pro Buchung**
   Schritt: Intake mit qty=20000
   Erwartet: BadRequest

✅ **[Inventory] Race-Condition abgesichert**
   Schritt: 2 parallele Output-Requests auf letzten Bestand
   Erwartet: Nur einer succeeded, andere BadRequest

## 2.7 Kunden

✅ **[Customers] Liste lädt**
   Schritt: /admin/customers
   Erwartet: Tabelle mit allen Kunden

✅ **[Customers] Suche nach Name/E-Mail**
   Schritt: E-Mail eingeben
   Erwartet: Kunde gefunden

✅ **[Customers] Detail-Ansicht**
   Schritt: Kunde anklicken
   Erwartet: Profil, Bestellungen, Adressen, Aktivitätslog

✅ **[Customers] DSGVO-Export triggern**
   Schritt: "Daten exportieren"
   Erwartet: ZIP-Datei in Queue, E-Mail nach Generierung

✅ **[Customers] DSGVO-Löschung**
   Schritt: "Account löschen"
   Erwartet: Anonymisierung, GoBD-Daten behalten

## 2.8 Retouren

✅ **[Returns] Liste mit KPIs**
   Schritt: /admin/returns
   Erwartet: KPI-Karten + Retouren-Tabelle

✅ **[Returns] Detail-Ansicht**
   Schritt: Retoure öffnen
   Erwartet: Artikel, Grund, Status, Timeline

✅ **[Returns] Approve mit "Shop zahlt"**
   Schritt: "Genehmigen" → "Label senden"
   Erwartet: DHL-Label erstellt + als E-Mail-Anhang versendet

✅ **[Returns] Approve mit "Kunde zahlt"**
   Schritt: "Genehmigen" → "Kunde zahlt Versand"
   Erwartet: Status in_transit, Kunde sieht Shop-Adresse

✅ **[Returns] Reject funktioniert**
   Schritt: "Ablehnen" → Grund → Bestätigen
   Erwartet: Status rejected, E-Mail an Kunde

✅ **[Returns] Inspect mit Item-Liste**
   Schritt: "Inspizieren" → Items prüfen
   Erwartet: Pro Item OK/Defekt markierbar

✅ **[Returns] refundAmount korrekt berechnet**
   Schritt: Teilretoure 2 von 6
   Erwartet: refundAmount = 2× Item-Preis (nicht 6×)

✅ **[Returns] Refund verarbeiten**
   Schritt: "Erstatten" → Betrag bestätigen
   Erwartet: Stripe/PayPal Refund, Gutschrift PDF erstellt

✅ **[Returns] Gutschrift PDF korrekt**
   Schritt: Gutschrift herunterladen
   Erwartet: Artikel, Mengen, Preise, Bankdaten

✅ **[Returns] Timeline mit 5 Schritten**
   Schritt: Retoure öffnen
   Erwartet: 5 Dots (Requested → Approved → In Transit → Received → Refunded)

⬜ **[Returns] Scanner-Pflicht bei Empfang**
   Schritt: Admin versucht manuell "Empfangen" zu setzen
   Erwartet: Kein Button, nur "Barcode scannen" möglich

## 2.9 Finanzen

✅ **[Finance] Dashboard lädt mit 7 Tabs**
   Schritt: /admin/finance
   Erwartet: Tabs Tag/Monat/MwSt/Bestseller/Kunden/Gewinn/Export

✅ **[Finance] Tagesbericht mit Erstattungen**
   Schritt: Tag mit Refund öffnen
   Erwartet: Umsatz minus Refunds korrekt berechnet

✅ **[Finance] Monatsbericht**
   Schritt: Monat wählen
   Erwartet: Tagesaufschlüsselung, Gesamt

✅ **[Finance] MwSt-Bericht**
   Schritt: MwSt-Tab
   Erwartet: 3 KPI-Karten (Brutto, MwSt, Netto)

✅ **[Finance] Kanal-Breakdown korrekt mit Refunds**
   Schritt: Kanal-Tab
   Erwartet: Refunds dem Original-Kanal zugeordnet

✅ **[Finance] CSV-Export funktioniert**
   Schritt: "Exportieren"
   Erwartet: CSV-Download mit allen Zeilen

## 2.10 Rechnungen

✅ **[Invoices] Liste lädt**
   Schritt: /admin/invoices
   Erwartet: Alle Rechnungen mit Nummer RE-2026-NNNNN

✅ **[Invoices] Filter nach Datum**
   Schritt: Datumsbereich setzen
   Erwartet: Nur Rechnungen in Zeitraum

✅ **[Invoices] PDF-Download**
   Schritt: Rechnung klicken
   Erwartet: PDF mit Gold-Akzent, Firmendaten, IBAN

✅ **[Invoices] CSV-Export**
   Schritt: "CSV exportieren"
   Erwartet: Alle Rechnungen als CSV

✅ **[Invoices] Gutschriften fortlaufend**
   Schritt: Gutschrift erstellen
   Erwartet: GS-2026-NNNNN, fortlaufend, ohne Lücken

✅ **[Invoices] GoBD: Rechnung kann nicht gelöscht werden**
   Schritt: SQL DELETE versuchen
   Erwartet: PostgreSQL-Trigger blockiert

✅ **[Invoices] GoBD: Rechnung kann nicht geändert werden**
   Schritt: SQL UPDATE versuchen
   Erwartet: Trigger blockiert

✅ **[Invoices] Rechnungsnummer ohne Lücken**
   Schritt: 10 Rechnungen erstellen
   Erwartet: Fortlaufend, z.B. 1,2,3,...,10

## 2.11 Marketing

✅ **[Marketing] Coupon erstellen**
   Schritt: /admin/marketing/coupons → "Neu"
   Erwartet: Code, Rabatt-Typ, Gültigkeit speicherbar

✅ **[Marketing] Coupon-Validierung (minOrder)**
   Schritt: Coupon mit Min-Order testen
   Erwartet: Coupon nur bei Erfüllung akzeptiert

✅ **[Marketing] Coupon-Abuse-Schutz (maxUses)**
   Schritt: Coupon 5× nutzen, 6. Versuch
   Erwartet: "Maximal 5× nutzbar"

✅ **[Marketing] Stacking-Regeln**
   Schritt: 2 Coupons gleichzeitig versuchen
   Erwartet: Nur einer aktiv (oder Stacking laut Regel)

✅ **[Marketing] Gift Card erstellen (falls vorhanden)**
   Schritt: Gift-Card-Modul
   Erwartet: Code + Guthaben erstellbar

✅ **[Marketing] Promotion (seasonal) läuft**
   Schritt: Seasonal-Promo erstellen + Aktivieren
   Erwartet: Auto-Rabatt im Shop sichtbar

✅ **[Marketing] Kampagne mit Hero erstellen**
   Schritt: /admin/campaigns → "Neu" → Template → Felder
   Erwartet: Kampagne aktiv, Hero-Banner im Shop

✅ **[Marketing] Kampagne mit Popup**
   Schritt: Kampagne mit Popup-Delay 3s
   Erwartet: Popup im Shop nach 3s

✅ **[Marketing] Kampagne mit Announcement Bar**
   Schritt: Bar-Text + Farben setzen
   Erwartet: Bar oben im Shop

✅ **[Marketing] Kampagne Stats sichtbar**
   Schritt: Kampagnen-Detail
   Erwartet: Impressions, Klicks, Coupon-Nutzung

## 2.12 Lieferanten

✅ **[Suppliers] Liste lädt**
   Schritt: /admin/suppliers
   Erwartet: Alle Lieferanten

✅ **[Suppliers] Neuer Lieferant**
   Schritt: "Neu" → Felder → Speichern
   Erwartet: Lieferant in DB

✅ **[Suppliers] Wareneingang buchen**
   Schritt: Lieferant → "Wareneingang"
   Erwartet: Formular mit Produkten + Mengen + Farbpicker

✅ **[Suppliers] Zahlungen erfassen**
   Schritt: Lieferant → "Zahlungen" → Neu
   Erwartet: Zahlung gespeichert, Saldo aktualisiert

✅ **[Suppliers] Wareneingang-Storno**
   Schritt: Bestehenden Wareneingang stornieren
   Erwartet: Bestand reduziert, Status cancelled

## 2.13 Mitarbeiter

✅ **[Staff] Liste lädt**
   Schritt: /admin/staff
   Erwartet: Alle Mitarbeiter mit Rollen

✅ **[Staff] Mitarbeiter einladen**
   Schritt: "Einladen" → E-Mail → Rolle
   Erwartet: Einladungs-E-Mail versendet

✅ **[Staff] Rollen-Preset anwenden**
   Schritt: Rolle "Warehouse" zuweisen
   Erwartet: Alle zugehörigen Permissions aktiv

✅ **[Staff] Custom Permissions setzen**
   Schritt: Einzelne Permissions togglen
   Erwartet: Permissions korrekt gespeichert

✅ **[Staff] scanner.view_prices Permission**
   Schritt: Mitarbeiter ohne diese Permission → Scanner öffnen
   Erwartet: Preise ausgeblendet

✅ **[Staff] Super-Admin hat immer alle Rechte**
   Schritt: Super-Admin-Login
   Erwartet: Alle Module zugänglich

✅ **[Staff] Mitarbeiter deaktivieren**
   Schritt: Mitarbeiter → "Deaktivieren"
   Erwartet: Login nicht mehr möglich

## 2.14 Einstellungen

✅ **[Settings] 5 Tabs sichtbar**
   Schritt: /admin/settings
   Erwartet: Firma, Zahlungen, Marketing, Benachrichtigungen, E-Mail

✅ **[Settings] Firmendaten speichern**
   Schritt: Firmendaten editieren → Speichern
   Erwartet: In ShopSettings gespeichert, in Rechnung sichtbar

✅ **[Settings] Zahlung Stripe AN/AUS**
   Schritt: Stripe-Toggle AUS
   Erwartet: Stripe im Checkout nicht mehr sichtbar

✅ **[Settings] Homepage-Design auswählen**
   Schritt: /admin/settings → Homepage A/B/C
   Erwartet: Auswahl gespeichert, im Shop sichtbar

✅ **[Settings] DHL-Konfiguration**
   Schritt: DHL-Status prüfen
   Erwartet: EKP-Nummer + Status angezeigt

✅ **[Settings] Tracking PostHog konfigurieren**
   Schritt: /admin/settings/tracking → Key eintragen
   Erwartet: PostHog aktiv nach Consent

✅ **[Settings] E-Mail-Templates bearbeiten**
   Schritt: /admin/emails → Template
   Erwartet: Preview-Mode funktioniert

✅ **[Settings] Benachrichtigungs-Toggle E-Mail**
   Schritt: /admin/notifications/settings
   Erwartet: Admin-E-Mail-Empfänger editierbar

✅ **[Settings] KI-Features AN/AUS**
   Schritt: /admin/ai → 6 Features togglen
   Erwartet: Einzeln steuerbar

✅ **[Settings] KI-Model wechseln**
   Schritt: Claude Sonnet / Haiku wechseln
   Erwartet: Wird in nächstem Call verwendet

✅ **[Settings] Wartungsmodus AN/AUS**
   Schritt: Toggle AN → Shop prüfen
   Erwartet: Wartungsseite sofort aktiv

## 2.15 Etiketten

✅ **[Labels] Hängetikett-Modal öffnet**
   Schritt: Produkt → Tag-Button
   Erwartet: Modal mit 3 Größen (40×70 / 55×90 / 60×100)

✅ **[Labels] Hängetikett drucken (Groß)**
   Schritt: Größe wählen, Kopien: 10, Drucken
   Erwartet: A4-Seite mit 6 Karten, CODE128 Barcode sichtbar

✅ **[Labels] Foto-Etikett-Modal öffnet**
   Schritt: Produkt → Image-Button
   Erwartet: Modal mit 3 Größen

✅ **[Labels] Foto-Etikett mit Produktbild**
   Schritt: Klein (30×30mm), Drucken
   Erwartet: 54 Aufkleber pro A4 mit Bild + Farbstreifen

✅ **[Labels] Batch-Druck alle Hängetiketten**
   Schritt: Produktseite → "Alle Hängetiketten"
   Erwartet: Minimale A4-Seiten mit allen Varianten

✅ **[Labels] Batch-Druck Etiketten-Station**
   Schritt: /admin/etiketten
   Erwartet: Suche, Varianten hinzufügen, Mengen editierbar

✅ **[Labels] Farbspezifisches Bild auf Foto-Etikett**
   Schritt: Produkt mit 3 Farben, Foto-Etikett
   Erwartet: Jede Farbe zeigt ihr eigenes Bild

✅ **[Labels] CODE128 Barcode scanbar**
   Schritt: Gedrucktes Etikett im Scanner
   Erwartet: SKU wird korrekt erkannt

## 2.16 Master-Box System

✅ **[MasterBox] Neue Box erstellen**
   Schritt: /admin/master-boxes → "Neu" → Saison
   Erwartet: BOX-2026-W-001 erstellt

✅ **[MasterBox] Kamera-Scanner öffnet**
   Schritt: Box → Scanner
   Erwartet: Kamera + Flash + Counter

✅ **[MasterBox] SKU scannen → Zählhoch**
   Schritt: Gleiche SKU 3× scannen
   Erwartet: Menge zählt auf 3

✅ **[MasterBox] Menge editierbar**
   Schritt: Menge klicken, 10 eintragen, Enter
   Erwartet: Menge auf 10 gesetzt

✅ **[MasterBox] Menge auf 0 → Item gelöscht**
   Schritt: Menge auf 0 setzen
   Erwartet: Item entfernt

✅ **[MasterBox] Status-Wechsel manuell**
   Schritt: "Versiegeln" klicken
   Erwartet: Status → sealed

✅ **[MasterBox] Transfer STRICT Preflight**
   Schritt: Transfer ohne ausreichend Bestand
   Erwartet: Roter Dialog mit Konflikt-Liste, kein Transfer

✅ **[MasterBox] Transfer funktioniert**
   Schritt: Ausreichend Bestand, Transfer
   Erwartet: Box im neuen Lager, alte Location gelöscht, auto sealed

✅ **[MasterBox] A4-Druckansicht**
   Schritt: Box → "Drucken"
   Erwartet: PDF mit Produkttabelle + Master-Barcode

✅ **[MasterBox] BOX-Badge im Inventar**
   Schritt: Inventar ansehen
   Erwartet: Gold-Pill BOX-XXX klickbar

✅ **[MasterBox] Lager-Filter-Chips**
   Schritt: Master-Boxes-Seite
   Erwartet: Chips mit Live-Count, leere Lager ausgeblendet

## 2.17 Benachrichtigungen

✅ **[Notifications] SSE-Stream empfängt Events**
   Schritt: Notifications-Seite offen, neue Bestellung
   Erwartet: Toast erscheint live

✅ **[Notifications] Sound bei neuer Nachricht**
   Schritt: Neue Bestellung bei aktiven Notifications
   Erwartet: Sound wird abgespielt

✅ **[Notifications] Browser-Push (falls erlaubt)**
   Schritt: Permission granted + neue Bestellung
   Erwartet: Browser-Notification erscheint

✅ **[Notifications] Liste zeigt alle**
   Schritt: /admin/notifications
   Erwartet: Alle Notifications mit Status

✅ **[Notifications] Als gelesen markieren**
   Schritt: Notification anklicken
   Erwartet: Status → read

## 2.18 Audit-Log

✅ **[Audit] Liste lädt mit Tag-Gruppierung**
   Schritt: /admin/audit-log
   Erwartet: Nach Tag → Admin gruppiert

✅ **[Audit] Farbige Badges pro Action-Type**
   Schritt: Mehrere Action-Types
   Erwartet: order.* blau, product.* grün, etc.

✅ **[Audit] Filter nach Admin**
   Schritt: Admin-Filter
   Erwartet: Nur Aktionen dieses Admins

✅ **[Audit] Filter nach Action-Type**
   Schritt: "order.cancelled" filter
   Erwartet: Nur Stornierungen

✅ **[Audit] Detail mit Before/After**
   Schritt: Log-Eintrag anklicken
   Erwartet: JSON-Diff before/after sichtbar

---

# 3. SICHERHEIT

✅ **[Security] Admin 8h Session-Ablauf**
   Schritt: Login, 8h+ warten
   Erwartet: Auto-Logout

✅ **[Security] Admin 30min Inaktivität**
   Schritt: Login, 30min keine Aktion
   Erwartet: Auto-Logout mit Meldung

✅ **[Security] Kunden-JWT Refresh**
   Schritt: Access-Token abgelaufen
   Erwartet: Refresh-Token erneuert automatisch

✅ **[Security] CSRF-Token auf Mutation-Endpoints**
   Schritt: POST ohne CSRF-Token
   Erwartet: 403 Forbidden

✅ **[Security] XSS-Schutz in E-Mail-Templates**
   Schritt: `<script>alert(1)</script>` in Produktname
   Erwartet: Escaped, kein Script-Execution in E-Mail

✅ **[Security] XSS-Schutz in Bewertungen**
   Schritt: Script-Tag in Review-Text
   Erwartet: Escaped angezeigt

✅ **[Security] SQL-Injection-Test**
   Schritt: `'; DROP TABLE users; --` in Suchfeld
   Erwartet: Prisma escaped, keine Wirkung

✅ **[Security] Rate Limit Login (5/min)**
   Schritt: 10× Login-Request
   Erwartet: 429 Too Many Requests ab 6.

✅ **[Security] Rate Limit Register**
   Schritt: Mehrfach registrieren
   Erwartet: 429 nach X Versuchen

✅ **[Security] Passwort-Hash (bcrypt)**
   Schritt: DB → User → password Feld
   Erwartet: bcrypt-Hash, kein Klartext

✅ **[Security] Passwort-Stärke-Prüfung**
   Schritt: "123" als Passwort
   Erwartet: Fehler "Zu schwach, mindestens 8 Zeichen"

✅ **[Security] Account-Lock nach 5 Fehlern**
   Schritt: 5× falsches Passwort
   Erwartet: Account 15min gesperrt

✅ **[Security] JWT-Secret nicht im Client**
   Schritt: Frontend-Bundle durchsuchen
   Erwartet: Kein JWT_SECRET gefunden

✅ **[Security] API-Key Secrets nicht im Frontend**
   Schritt: Build-Output prüfen
   Erwartet: Nur NEXT_PUBLIC_* Variablen sichtbar

✅ **[Security] File-Upload nur erlaubte MIME-Types**
   Schritt: .exe hochladen
   Erwartet: Blockiert, Fehlermeldung

✅ **[Security] File-Upload Max-Size**
   Schritt: 50MB-Datei hochladen
   Erwartet: Blockiert bei konfigurierter Max-Size

✅ **[Security] CORS nur für erlaubte Origins**
   Schritt: Request von fremder Origin
   Erwartet: CORS-Fehler

✅ **[Security] Security Headers aktiv**
   Schritt: curl -I /
   Erwartet: X-Frame-Options, X-Content-Type-Options, CSP, Referrer-Policy

✅ **[Security] Admin-Routes geschützt**
   Schritt: /admin ohne Login aufrufen
   Erwartet: Redirect zu /admin/login

✅ **[Security] Permission-Check pro Route**
   Schritt: User ohne "finance.*" → /admin/finance
   Erwartet: 403 oder Redirect

✅ **[Security] GDPR: Daten-Löschung vollständig**
   Schritt: Account löschen
   Erwartet: Personal Data entfernt, Rechnungen bleiben (GoBD)

---

# 4. PERFORMANCE

✅ **[Perf] Lighthouse Homepage — Performance ≥90**
   Schritt: Lighthouse auf `/de` ausführen
   Erwartet: Score ≥ 90

✅ **[Perf] Lighthouse Homepage — Accessibility ≥95**
   Schritt: Lighthouse
   Erwartet: Score ≥ 95

✅ **[Perf] Lighthouse Homepage — SEO ≥95**
   Schritt: Lighthouse
   Erwartet: Score ≥ 95

✅ **[Perf] Lighthouse Homepage — Best Practices ≥95**
   Schritt: Lighthouse
   Erwartet: Score ≥ 95

✅ **[Perf] FCP < 1.8s**
   Schritt: Lighthouse / Chrome DevTools
   Erwartet: First Contentful Paint < 1800ms

✅ **[Perf] LCP < 2.5s**
   Schritt: Lighthouse
   Erwartet: Largest Contentful Paint < 2500ms

✅ **[Perf] CLS < 0.1**
   Schritt: Lighthouse
   Erwartet: Cumulative Layout Shift < 0.1

✅ **[Perf] TBT < 200ms**
   Schritt: Lighthouse
   Erwartet: Total Blocking Time < 200ms

✅ **[Perf] TTI < 3.8s**
   Schritt: Lighthouse
   Erwartet: Time to Interactive < 3800ms

✅ **[Perf] PDP Performance ≥85**
   Schritt: Lighthouse auf Produktseite
   Erwartet: Score ≥ 85

✅ **[Perf] Bundle Size Initial JS < 250KB**
   Schritt: next build → .next/analyze
   Erwartet: First-Load JS < 250KB

✅ **[Perf] Hero-Bild hat priority**
   Schritt: DevTools Network
   Erwartet: Hero-Image fetched zuerst mit fetchpriority=high

✅ **[Perf] Bilder lazy-loaded below fold**
   Schritt: DevTools Network, scrollen
   Erwartet: Bilder laden erst bei Sichtbarkeit

✅ **[Perf] AVIF/WebP Format verwendet**
   Schritt: Network Tab → Image-Requests
   Erwartet: .avif oder .webp je nach Browser-Support

✅ **[Perf] Scripts async/defer**
   Schritt: View Source
   Erwartet: Alle non-critical Scripts async oder defer

✅ **[Perf] Fonts preloaded**
   Schritt: Network Tab
   Erwartet: Cairo + Inter preloaded in HEAD

✅ **[Perf] Redis Cache funktioniert**
   Schritt: API-Endpoint 2× aufrufen
   Erwartet: 2. Request aus Cache (schneller)

✅ **[Perf] Database N+1 vermieden**
   Schritt: Prisma Log bei Produktliste
   Erwartet: Wenige Queries, include/select optimiert

✅ **[Perf] API-Response < 200ms (Cached)**
   Schritt: DevTools Network
   Erwartet: Most Endpoints < 200ms

---

# 5. RECHTLICH (DEUTSCHLAND)

✅ **[Legal] Impressum: Firmenname**
   Schritt: /legal/impressum
   Erwartet: Vollständiger Firmenname sichtbar

✅ **[Legal] Impressum: Anschrift**
   Schritt: /legal/impressum
   Erwartet: Straße, PLZ, Ort

✅ **[Legal] Impressum: Geschäftsführer/Inhaber**
   Schritt: /legal/impressum
   Erwartet: Name vorhanden

✅ **[Legal] Impressum: USt-IdNr / Steuer-Nr**
   Schritt: /legal/impressum
   Erwartet: Nummer vorhanden

✅ **[Legal] Impressum: Kontakt (E-Mail + Telefon)**
   Schritt: /legal/impressum
   Erwartet: E-Mail + Telefon klickbar

✅ **[Legal] AGB: Bestellprozess beschrieben**
   Schritt: /legal/agb
   Erwartet: Wie Vertrag zustande kommt

✅ **[Legal] AGB: Widerrufsrecht**
   Schritt: /legal/agb
   Erwartet: 14-Tage-Frist, Kunde trägt Rücksendekosten

✅ **[Legal] AGB: Gewährleistung**
   Schritt: /legal/agb
   Erwartet: Hinweise auf Gewährleistung

✅ **[Legal] Widerrufsbelehrung separat verlinkt**
   Schritt: Footer prüfen
   Erwartet: Link zu /legal/widerruf

✅ **[Legal] Widerrufsbelehrung im Checkout verlinkt**
   Schritt: Checkout-Zahlungsschritt
   Erwartet: Link auf Widerruf klickbar

✅ **[Legal] Widerrufsformular verfügbar**
   Schritt: /legal/widerruf scrollen
   Erwartet: Muster-Widerrufsformular vorhanden

✅ **[Legal] Datenschutzerklärung DSGVO-konform**
   Schritt: /legal/datenschutz
   Erwartet: Alle verwendeten Tools genannt (Stripe, DHL, PostHog, etc.)

✅ **[Legal] Datenschutz: Rechte des Betroffenen**
   Schritt: /legal/datenschutz
   Erwartet: Auskunft, Löschung, Widerspruch erwähnt

✅ **[Legal] Cookie-Consent Opt-In (nicht Opt-Out)**
   Schritt: Erstbesuch
   Erwartet: Nichts ist vorausgewählt

✅ **[Legal] Essential-only by default**
   Schritt: Banner schließen ohne Auswahl
   Erwartet: Nur Essential aktiv

✅ **[Legal] Preise Brutto inkl. MwSt**
   Schritt: Beliebiges Produkt
   Erwartet: Preis enthält 19% MwSt

✅ **[Legal] MwSt ausgewiesen**
   Schritt: Warenkorb
   Erwartet: "inkl. 19% MwSt: X,XX €" angezeigt

✅ **[Legal] Versandkosten vor Checkout sichtbar**
   Schritt: Warenkorb
   Erwartet: Versandkosten transparent

✅ **[Legal] Rechnung GoBD-konform**
   Schritt: PDF öffnen
   Erwartet: Alle Pflichtangaben, Nummer fortlaufend

✅ **[Legal] Rechnung unveränderbar (DB-Trigger)**
   Schritt: SQL UPDATE/DELETE Test
   Erwartet: Blockiert

✅ **[Legal] Rechnungsnummern fortlaufend (keine Lücken)**
   Schritt: SQL SELECT alle Nummern 2026
   Erwartet: Kontinuierlich 1,2,3,...,N

---

# 6. SPRACHEN + RTL

✅ **[i18n] Alle Seiten auf DE**
   Schritt: /de/* durchgehen
   Erwartet: Keine englischen/arabischen Fallbacks

✅ **[i18n] Alle Seiten auf EN**
   Schritt: /en/* durchgehen
   Erwartet: Komplette EN-Übersetzungen

✅ **[i18n] Alle Seiten auf AR**
   Schritt: /ar/* durchgehen
   Erwartet: Komplette AR-Übersetzungen

✅ **[i18n] RTL-Layout in AR**
   Schritt: /ar aufrufen
   Erwartet: dir="rtl", Text rechts, Pfeile gedreht

✅ **[i18n] Cairo-Font in AR**
   Schritt: /ar DevTools
   Erwartet: font-family: Cairo

✅ **[i18n] Latin-Ziffern in AR**
   Schritt: /ar Produktpreis
   Erwartet: "1.234,56 €" (nicht ١٢٣٤)

✅ **[i18n] Arabische Emails in AR**
   Schritt: AR-Kunde bestellt
   Erwartet: E-Mail in AR mit Cairo-Font, RTL

✅ **[i18n] Datum-Format DE: dd.mm.yyyy**
   Schritt: /de Bestelldatum
   Erwartet: 13.04.2026


✅ **[i18n] Keine hardcoded Strings**
   Schritt: grep nach deutschen Strings im Code
   Erwartet: Nichts, alles via useTranslations

✅ **[i18n] Language Switcher funktioniert**
   Schritt: DE → EN → AR wechseln
   Erwartet: URL ändert, UI wechselt, Inhalt bleibt

✅ **[i18n] RTL: Admin-Sidebar richtig**
   Schritt: /ar/admin
   Erwartet: Sidebar rechts, Chevrons gedreht


✅ **[i18n] RTL: Tabellen-Alignment**
   Schritt: /ar Admin-Tabelle
   Erwartet: text-start/text-end korrekt, nicht text-left

✅ **[i18n] Fehlermeldungen in allen 3 Sprachen**
   Schritt: Form-Fehler in DE/EN/AR provozieren
   Erwartet: Übersetzt

✅ **[i18n] Telefonnummer dir="ltr" in AR**
   Schritt: /ar Kontaktseite
   Erwartet: Nummer linksbündig, nicht rechts

✅ **[i18n] E-Mail-Adresse dir="ltr" in AR**
   Schritt: /ar Footer
   Erwartet: E-Mail linksbündig



---

# 7. RESPONSIVE

✅ **[Responsive] Mobile 320px (iPhone SE 1)**
   Schritt: Chrome DevTools → 320px
   Erwartet: Keine horizontale Scrollbar, alle Inhalte sichtbar

✅ **[Responsive] Mobile 375px (iPhone SE 2/3)**
   Schritt: 375px
   Erwartet: Layout korrekt

✅ **[Responsive] Mobile 414px (iPhone Plus)**
   Schritt: 414px
   Erwartet: Layout korrekt

✅ **[Responsive] Tablet 768px (iPad)**
   Schritt: 768px
   Erwartet: Tablet-Layout, 2-Col Grids

✅ **[Responsive] Tablet 1024px**
   Schritt: 1024px
   Erwartet: Desktop-artiges Layout

✅ **[Responsive] Desktop 1280px**
   Schritt: 1280px
   Erwartet: Volles Desktop-Layout

✅ **[Responsive] Desktop 1440px**
   Schritt: 1440px
   Erwartet: max-w-[1440px] Container greift

✅ **[Responsive] Desktop 1920px**
   Schritt: 1920px
   Erwartet: Inhalt zentriert, Whitespace links/rechts

✅ **[Responsive] Touch-Targets ≥ 44px**
   Schritt: Mobile, Buttons messen
   Erwartet: Alle Buttons ≥ 44×44px

✅ **[Responsive] Header kollabiert Mobile**
   Schritt: < 768px
   Erwartet: Burger-Menu, kein Desktop-Nav

✅ **[Responsive] Mobile Menu funktioniert**
   Schritt: Burger → Menu
   Erwartet: Slide-in, alle Links erreichbar

✅ **[Responsive] PDP Sticky Bar Mobile**
   Schritt: Mobile PDP, scrollen
   Erwartet: Sticky Bar unten funktioniert

✅ **[Responsive] Tabellen horizontal scrollbar**
   Schritt: Mobile Admin-Tabelle
   Erwartet: Overflow-x: auto, kein Breakage

✅ **[Responsive] Keine Horizontal-Scrollbar Homepage**
   Schritt: Alle Breakpoints
   Erwartet: Nie horizontales Scrollen

✅ **[Responsive] Bilder skalieren sauber**
   Schritt: Breakpoints durchgehen
   Erwartet: Keine Verzerrungen

✅ **[Responsive] Modals fit on Mobile**
   Schritt: Mobile, Modal öffnen
   Erwartet: Passt in Viewport, scrollbar wenn lang

✅ **[Responsive] Forms auf Mobile nutzbar**
   Schritt: Mobile Checkout
   Erwartet: Felder groß genug, Keyboard funktioniert

---

# 8. DHL ADRESSVALIDIERUNG

✅ **[DHL-Addr] Checkout: Adresse wird vor Submit geprüft**
   Schritt: Checkout → Adresse eintragen → "Weiter"
   Erwartet: Spinner "Adresse wird geprüft", DHL-API call an /address/validate

✅ **[DHL-Addr] Checkout: Gültige Adresse → Weiter möglich**
   Schritt: Echte Adresse "Alexanderplatz 1, 10178 Berlin"
   Erwartet: Grünes Häkchen, Button "Weiter" aktiv

✅ **[DHL-Addr] Checkout: Ungültige PLZ → Warnung**
   Schritt: "99999" als PLZ eingeben
   Erwartet: Warnung mit Korrekturvorschlag, "Trotzdem fortfahren" möglich

✅ **[DHL-Addr] Checkout: Fehlende Hausnummer → Warnung**
   Schritt: Straße ohne Hausnummer
   Erwartet: Warnung "Hausnummer fehlt"

✅ **[DHL-Addr] Account: Validierung bei neuer Adresse**
   Schritt: /account/addresses → "Neue Adresse" → Speichern
   Erwartet: DHL-Prüfung vor Speichern

✅ **[DHL-Addr] Account: Adresse bearbeiten prüft auch**
   Schritt: Bestehende Adresse editieren
   Erwartet: Re-Validierung bei Änderung

✅  **[DHL-Addr] PLZ→Stadt Offline-Validierung**
   Schritt: "10115" eingeben (ohne Netzwerk)
   Erwartet: "Berlin" offline vorgeschlagen (99 Leitzonen)

✅  **[DHL-Addr] PLZ↔Stadt Mismatch-Erkennung**
   Schritt: "10115" + "München"
   Erwartet: Warnung "PLZ gehört zu Berlin"

✅  **[DHL-Addr] Photon Autocomplete: Straßenvorschläge**
   Schritt: "Pannierstr" im Straßenfeld eingeben
   Erwartet: Dropdown mit "Pannierstraße 4, 12047 Berlin" etc.

✅  **[DHL-Addr] Photon: Kostenlos, kein Google-Key nötig**
   Schritt: Network-Tab prüfen
   Erwartet: Requests an photon.komoot.io, kein Google Places

✅  **[DHL-Addr] Unicode Bidi-Marker für PLZ in AR**
   Schritt: /ar Checkout mit Fehler
   Erwartet: PLZ/Stadt in Fehlermeldung korrekt LTR angezeigt

✅ **[DHL-Addr] Admin: Adresse im Admin-Panel editierbar**
   Schritt: Admin-Order → Pencil → Adresse ändern
   Erwartet: DHL-Prüfung auch hier aktiv

---

# 9. SMART SIZING SYSTEM

✅ **[Sizing] Admin: Größentabelle erstellen**
   Schritt: /admin/sizing → "Neu" → Name "Herren Oberteile"
   Erwartet: SizeChart in DB, Editor öffnet

✅ **[Sizing] Admin: Größen-Einträge hinzufügen**
   Schritt: Größen S, M, L mit Maßen (Brust, Taille, Hüfte)
   Erwartet: SizeChartEntry pro Größe gespeichert

✅ **[Sizing] Admin: Größentabelle einem Lieferanten zuweisen**
   Schritt: Supplier-Edit → Größentabelle auswählen
   Erwartet: Alle Produkte des Lieferanten nutzen diese Tabelle

✅ **[Sizing] PDP: Größenberatungs-Modal öffnet**
   Schritt: Produkt → "Größentabelle" Link klicken
   Erwartet: Modal mit Tabelle + Mannequin + 3 Tabs

✅ **[Sizing] PDP: Tab 1 — Größentabelle**
   Schritt: Erster Tab
   Erwartet: Tabelle aller Größen des Produkts

✅ **[Sizing] PDP: Tab 2 — Maße eingeben**
   Schritt: Zweiter Tab → Maße eingeben
   Erwartet: Input-Felder für Brust, Taille, Hüfte

✅ **[Sizing] PDP: Tab 3 — Empfehlung anzeigen**
   Schritt: Maße eingetragen → Tab 3
   Erwartet: KI-Empfehlung "Wir empfehlen Größe L"

✅ **[Sizing] PDP: Distanz-basiertes Matching**
   Schritt: Maße knapp zwischen M und L
   Erwartet: Größe mit minimaler Distanz wird empfohlen

✅ **[Sizing] Account: Kundenmaße speichern**
   Schritt: /account/measurements → Maße → Speichern
   Erwartet: CustomerMeasurement in DB

✅ **[Sizing] Account: Gespeicherte Maße auf PDP laden**
   Schritt: PDP als eingeloggter Kunde öffnen
   Erwartet: Maße vorausgefüllt + Empfehlung direkt sichtbar

✅ **[Sizing] Mannequin-Figur reagiert auf Maße**
   Schritt: Maße ändern
   Erwartet: Mannequin-Grafik aktualisiert

---

# 10. KI-INTEGRATION

✅ **[AI] Alle 6 Features standardmäßig AUS**
   Schritt: Neuinstallation / Fresh DB → /admin/ai
   Erwartet: Alle Toggles auf AUS

✅ **[AI] Chatbot (Kunde) AN-Toggle**
   Schritt: Toggle AN → Frontend Chat-Widget prüfen
   Erwartet: Chat sichtbar, Antworten funktionieren

✅ **[AI] Chatbot AUS-Toggle**
   Schritt: Toggle AUS → Frontend prüfen
   Erwartet: Chat-Widget verschwindet

✅ **[AI] Admin-Assistent AN**
   Schritt: Toggle AN → /admin Dashboard
   Erwartet: Admin-Chat verfügbar

✅ **[AI] Produktbeschreibung generieren**
   Schritt: Produkt → "KI-Beschreibung" Button
   Erwartet: Claude Vision analysiert Bild → DE/EN/AR generiert

✅ **[AI] Produktbeschreibung: Realistischer Ton**
   Schritt: Generierte Beschreibung prüfen
   Erwartet: Sachlich, keine Übertreibungen wie "das Beste ever"

✅ **[AI] Produktbeschreibung: Vorschau + Übernehmen**
   Schritt: Preview anzeigen → "Übernehmen"
   Erwartet: Felder werden gefüllt, speicherbar

✅ **[AI] Produktbeschreibung: Verwerfen funktioniert**
   Schritt: "Verwerfen" klicken
   Erwartet: Originaltext unverändert

✅ **[AI] SEO Meta-Tags mit generiert**
   Schritt: KI-Beschreibung generieren
   Erwartet: SEO Title + SEO Description in allen 3 Sprachen

✅ **[AI] Inventar-Vorschläge**
   Schritt: KI-Feature AN → Inventar-Ansicht
   Erwartet: Vorschläge für Nachbestellung basierend auf Verkauf

✅ **[AI] Marketing-Texte generieren**
   Schritt: Kampagne → "KI-Text generieren"
   Erwartet: 3-sprachiger Kampagnen-Text

✅ **[AI] Social Media Replies**
   Schritt: WhatsApp/Social-Nachricht
   Erwartet: KI antwortet in der Sprache des Kunden

✅ **[AI] Rate-Limiting greift**
   Schritt: >20 Requests/Minute
   Erwartet: 429 Too Many Requests

✅ **[AI] Caching funktioniert**
   Schritt: 2× gleiche Produktbeschreibung generieren
   Erwartet: 2. Request aus Cache (schneller + kein API-Call)

✅ **[AI] Claude Sonnet als Default**
   Schritt: /admin/ai → Model-Dropdown
   Erwartet: claude-sonnet-4-20250514 default

✅ **[AI] Gemini Fallback bei Claude-Ausfall**
   Schritt: Claude-Key ungültig
   Erwartet: Auto-Fallback zu Gemini

✅ **[AI] Logs in Admin sichtbar**
   Schritt: /admin/ai → "Logs" Tab
   Erwartet: Alle Requests mit Response-Time + Kosten

✅ **[AI] Kein KI-Call ohne Consent (Chatbot)**
   Schritt: Consent abgelehnt → Chat öffnen
   Erwartet: Info "KI deaktiviert — Consent erforderlich"

---

# 11. DEEPL ÜBERSETZUNG

✅ **[DeepL] AR → DE Vorschlag im Wareneingang**
   Schritt: Supplier-Intake → AR-Produktname eingeben
   Erwartet: DE-Übersetzungs-Vorschlag erscheint

✅ **[DeepL] Vorschlag wird NICHT auto-gespeichert**
   Schritt: AR-Name eingeben
   Erwartet: DE-Feld leer, Admin muss "Übernehmen" klicken

✅ **[DeepL] Admin-Bestätigung via Button**
   Schritt: Vorschlag → "Übernehmen"
   Erwartet: DE-Feld gefüllt, speicherbar

✅ **[DeepL] Admin kann Vorschlag bearbeiten**
   Schritt: "Übernehmen" → Text ändern
   Erwartet: Modifizierte Version wird gespeichert

✅ **[DeepL] Batch-Übersetzung funktioniert**
   Schritt: Mehrere Produkte markieren → "Übersetzen"
   Erwartet: Alle werden übersetzt (Bestätigung pro Produkt)

✅ **[DeepL] Cache für wiederholte Phrasen**
   Schritt: Gleichen AR-Text 2× eingeben
   Erwartet: 2. Request aus Cache (kein DeepL-Call)

✅ **[DeepL] API-Fehler graceful handeln**
   Schritt: DeepL-Key ungültig
   Erwartet: Kein Crash, Vorschlag bleibt leer mit Hinweis

---

# 12. SOCIAL COMMERCE

✅ **[Social] Facebook Feed erreichbar**
   Schritt: GET /api/v1/feeds/facebook.xml
   Erwartet: XML mit allen Produkten die channelFacebook=true

✅ **[Social] Facebook Feed: Produkt-AUS blendet aus**
   Schritt: Produkt channelFacebook=false → Feed laden
   Erwartet: Produkt nicht im XML

✅ **[Social] Facebook Feed: Globale AUS-Schalter**
   Schritt: Admin → Kanäle → Facebook AUS
   Erwartet: Feed liefert leere Liste oder 404

✅ **[Social] TikTok Feed (TSV)**
   Schritt: GET /api/v1/feeds/tiktok.tsv
   Erwartet: TSV-Datei mit Produkten

✅ **[Social] Google Feed (XML)**
   Schritt: GET /api/v1/feeds/google.xml
   Erwartet: Google-Shopping konformes XML

✅ **[Social] WhatsApp Business Catalog Feed**
   Schritt: GET /api/v1/feeds/whatsapp.json
   Erwartet: JSON für WhatsApp Commerce

✅ **[Social] Feeds enthalten Bruttopreise**
   Schritt: Feed-Inhalt prüfen
   Erwartet: Preise inkl. 19% MwSt, Währung EUR

✅ **[Social] Feeds enthalten Varianten**
   Schritt: Produkt mit Varianten → Feed
   Erwartet: Jede Variante als eigenes Item mit item_group_id

✅ **[Social] UTM-Parameter werden erkannt**
   Schritt: Shop mit ?utm_source=facebook&utm_medium=shop aufrufen
   Erwartet: sessionStorage speichert Attribution

✅ **[Social] UTM → Order Channel-Attribution**
   Schritt: Mit UTM bestellen
   Erwartet: Order.channel = 'facebook' in DB

✅ **[Social] Open Graph Tags auf PDP**
   Schritt: PDP → View Source
   Erwartet: og:title, og:description, og:image, og:url

✅ **[Social] WhatsApp-Teilen Button funktioniert**
   Schritt: PDP → WhatsApp-Icon klicken
   Erwartet: wa.me mit Produkt-Link öffnet

✅ **[Social] WhatsApp Floating Button sichtbar**
   Schritt: Shop öffnen
   Erwartet: Button unten rechts, min 56×56px

✅ **[Social] WhatsApp Button RTL-aware**
   Schritt: /ar öffnen
   Erwartet: Button unten LINKS (nicht rechts)

✅ **[Social] Facebook Pixel tracked PageView**
   Schritt: Consent erteilt → Homepage
   Erwartet: Pixel fires PageView Event

✅ **[Social] Facebook Pixel tracked Purchase**
   Schritt: Bestellung abschließen
   Erwartet: Pixel Purchase Event mit value

---

# 13. SCANNER-FUNKTIONEN

⬜ **[Scanner] USB-Barcode im Inventar**
   Schritt: USB-Handscanner an Admin-Gerät → Scanner-Seite
   Erwartet: Barcode wird in Input erkannt, Produkt gefunden

⬜ **[Scanner] Kamera-Scanner (Mobile)**
   Schritt: Mobile → Kamera-Scanner-Button
   Erwartet: Kamera-Zugriff-Anfrage, Kamera öffnet

⬜ **[Scanner] Kamera erkennt CODE128**
   Schritt: Etikett mit CODE128 scannen
   Erwartet: SKU erkannt, Sound + grüner Flash

⬜ **[Scanner] Kamera erkennt EAN13**
   Schritt: EAN13-Barcode scannen
   Erwartet: Erkennung OK

⬜ **[Scanner] Fehler-Sound bei unbekanntem Code**
   Schritt: Fremden Barcode scannen
   Erwartet: Roter Flash + Error-Sound

⬜ **[Scanner] 2s Debounce zwischen Scans**
   Schritt: Gleichen Code schnell 2× scannen
   Erwartet: Nur 1× verarbeitet

⬜ **[Scanner] Im Suchfeld verwendbar**
   Schritt: Suche-Input → Scanner nutzen
   Erwartet: SKU im Feld, Suche triggert automatisch

⬜ **[Scanner] Bestandswarnung: letzter Artikel**
   Schritt: Letzten Artikel scannen
   Erwartet: Warnung "Letzter Artikel im Lager X"

⬜ **[Scanner] Warnung zeigt andere Lager mit Bestand**
   Schritt: Scan bei 0 Bestand
   Erwartet: Liste alternativer Lager mit Beständen

⬜ **[Scanner] Warnung bleibt bis manuell geschlossen**
   Schritt: Warnung öffnen → nicht schließen → weiter scannen
   Erwartet: Warnung persistent bis X geklickt

⬜ **[Scanner] Master-Box Scanner funktioniert**
   Schritt: Box öffnen → Kamera → Artikel scannen
   Erwartet: Item zur Box hinzugefügt, Counter +1

⬜ **[Scanner] Master-Box: Mehrfach-Scan zählt hoch**
   Schritt: Gleiche SKU 3× in Box scannen
   Erwartet: Quantity auf 3, kein Duplikat

⬜ **[Scanner] BarcodeDetector API + html5-qrcode Fallback**
   Schritt: Chrome (API-Support) vs Safari (Fallback)
   Erwartet: Beide funktionieren

---

# 14. CRON-JOBS

✅ **[Cron] Vorkasse: 7-Tage-Reminder**
   Schritt: Vorkasse-Order 7 Tage alt ohne Zahlung
   Erwartet: Reminder-E-Mail wird gesendet

✅ **[Cron] Vorkasse: 10-Tage-Stornierung**
   Schritt: Vorkasse-Order 10 Tage alt
   Erwartet: Auto-Cancel, Bestand freigegeben, E-Mail an Kunde

✅ **[Cron] Payment-Timeout 30min**
   Schritt: Order in pending_payment > 30min
   Erwartet: Status → cancelled, Reservierung aufgehoben

✅ **[Cron] Reservierungs-Cleanup**
   Schritt: Abgelaufene Reservierungen in DB
   Erwartet: Auto-Delete, quantityReserved zurück

✅ **[Cron] DHL Tracking Update (alle 2h)**
   Schritt: Shipment mit DHL Tracking ID
   Erwartet: Status wird aktualisiert (z.B. in_transit → delivered)

✅ **[Cron] Maintenance Auto-Disable**
   Schritt: Wartungsmodus mit End-Datum in Vergangenheit
   Erwartet: Auto-OFF

✅ **[Cron] Daily-Summary E-Mail**
   Schritt: Nach Tages-End Cron
   Erwartet: E-Mail mit KPIs an Admin

✅ **[Cron] Logs für jeden Cron-Run**
   Schritt: Audit-Log oder Logs prüfen
   Erwartet: Jeder Cron-Run dokumentiert

✅ **[Cron] Fehler in Cron → Alert**
   Schritt: Cron crasht
   Erwartet: Admin wird benachrichtigt 

---

# 15. BESTELLUNGEN — SPEZIALFÄLLE

⬜ **[Order-Edge] Teilstornierung: einzelne Items**
   Schritt: Bestellung mit 3 Items → 1 stornieren
   Erwartet: 1 Item cancelled, 2 bleiben, Teil-Refund

⬜ **[Order-Edge] Teilretoure: 2 von 6**
   Schritt: Retoure für 2 Stück einreichen
   Erwartet: Nur 2 retourniert, refundAmount korrekt

⬜ **[Order-Edge] Vorkasse-Refund manuell**
   Schritt: Vorkasse-Order stornieren
   Erwartet: Manueller Refund-Workflow (nicht Stripe API)

⬜ **[Order-Edge] Vorkasse-Refund: Bankdaten eingeben**
   Schritt: Admin gibt IBAN des Kunden ein
   Erwartet: Rückzahlung dokumentiert, Status refunded

⬜ **[Order-Edge] Failed Refund → Retry-Button**
   Schritt: Stripe-Refund fehlschlagen lassen
   Erwartet: Status "failed", Retry-Button sichtbar

⬜ **[Order-Edge] Retry Refund funktioniert**
   Schritt: Retry klicken
   Erwartet: Erneut Stripe API Call, bei Erfolg → succeeded

⬜ **[Order-Edge] Adress-Snapshot: gespeicherte Adresse**
   Schritt: Login + vorhandene Adresse → Bestellen
   Erwartet: Order hat Snapshot der Adresse (nicht Referenz)

⬜ **[Order-Edge] Adress-Snapshot: neue Adresse**
   Schritt: Login + neue Adresse im Checkout
   Erwartet: Adresse gespeichert + Snapshot in Order

⬜ **[Order-Edge] Adress-Snapshot: Gast-Bestellung**
   Schritt: Gast-Checkout mit Adresse
   Erwartet: Snapshot ohne User-Referenz

⬜ **[Order-Edge] Adresse ändert sich nach Bestellung → Order unverändert**
   Schritt: Adresse nach Bestellung editieren
   Erwartet: Alte Bestellung zeigt alte Adresse (Snapshot)

⬜ **[Order-Edge] Multi-Warehouse Fulfillment**
   Schritt: Admin → Order → "Lager wählen"
   Erwartet: Dropdown zeigt Lager mit Bestand

⬜ **[Order-Edge] Reservierungs-Transfer bei Lagerwechsel**
   Schritt: Fulfillment-Lager wechseln
   Erwartet: Reservierung wandert, kein Überverkauf

⬜ **[Order-Edge] Idempotency-Key bei Checkout**
   Schritt: Checkout 2× submitten
   Erwartet: Nur 1 Order erstellt

---

# 16. LOGIN-METHODEN

⬜ **[Login] E-Mail + Passwort**
   Schritt: /auth/login → Credentials
   Erwartet: Einloggen, Redirect zu /account

⬜ **[Login] Google OAuth Live**
   Schritt: "Mit Google" → Google-Dialog → Zurück
   Erwartet: Account verknüpft / erstellt, Redirect zu /account

⬜ **[Login] Facebook OAuth Live**
   Schritt: "Mit Facebook" → FB-Dialog → Zurück
   Erwartet: Account verknüpft / erstellt

⬜ **[Login] Bestehendes E-Mail-Konto + Google = gleicher Account**
   Schritt: Mit E-Mail registriert → danach Google mit gleicher E-Mail
   Erwartet: Beide Methoden zum gleichen Account verlinkt

⬜ **[Login] 5 Fehlversuche → Kontosperre**
   Schritt: 5× falsches Passwort
   Erwartet: Account 15min gesperrt + Meldung

⬜ **[Login] Kontosperre wird nach Zeit aufgehoben**
   Schritt: 15min warten
   Erwartet: Login wieder möglich

⬜ **[Login] Rate-Limit auf Login-Endpoint**
   Schritt: Viele parallele Login-Requests
   Erwartet: 429 nach X Requests

⬜ **[Login] Passwort-Reset per E-Mail**
   Schritt: "Passwort vergessen" → E-Mail → Link
   Erwartet: Link expired nach 1h, neues Passwort setzen möglich

⬜ **[Login] Logout löscht Cookies + Refresh-Token**
   Schritt: /auth/logout
   Erwartet: Alle Tokens invalid

---

# 17. KEYBOARD SHORTCUTS

⬜ **[Keyboard] ⌘K öffnet Suche (Mac)**
   Schritt: Cmd+K drücken
   Erwartet: Suchoverlay öffnet

⬜ **[Keyboard] Ctrl+K öffnet Suche (Windows/Linux)**
   Schritt: Ctrl+K drücken
   Erwartet: Suchoverlay öffnet

⬜ **[Keyboard] Esc schließt Suchoverlay**
   Schritt: Suche offen → Esc
   Erwartet: Overlay schließt

⬜ **[Keyboard] PDP: Pfeiltaste rechts → nächstes Bild**
   Schritt: Gallery offen → →
   Erwartet: Nächstes Bild

⬜ **[Keyboard] PDP: Pfeiltaste links → vorheriges Bild**
   Schritt: Gallery offen → ←
   Erwartet: Vorheriges Bild

⬜ **[Keyboard] Lightbox: Esc schließt**
   Schritt: Fullscreen Lightbox → Esc
   Erwartet: Schließt zum PDP

⬜ **[Keyboard] Tab-Navigation durch Forms**
   Schritt: Checkout → Tab
   Erwartet: Logisch durch alle Felder

⬜ **[Keyboard] Focus-Indicators sichtbar**
   Schritt: Tab-Navigation
   Erwartet: Gold-Ring / Outline auf fokussierten Elementen

---

# 18. ETIKETTEN KOMPLETT

⬜ **[Labels] Barcode-Etikett Klein (25×50mm)**
   Schritt: Produkt → Barcode → Klein → Drucken
   Erwartet: A4 mit vielen kleinen Etiketten, SKU + CODE128 lesbar

⬜ **[Labels] Barcode-Etikett Mittel (40×70mm)**
   Schritt: Barcode → Mittel
   Erwartet: Korrekte Größe, kein Beschnitt

⬜ **[Labels] Barcode-Etikett Groß (60×100mm)**
   Schritt: Barcode → Groß
   Erwartet: 6 pro A4, Barcode deutlich

⬜ **[Labels] Hängetikett Klein (40×70mm)**
   Schritt: Tag-Button → Klein
   Erwartet: 16 pro A4, Loch-Markierung sichtbar

⬜ **[Labels] Hängetikett Mittel (55×90mm)**
   Schritt: Tag-Button → Mittel
   Erwartet: 9 pro A4

⬜ **[Labels] Hängetikett Groß (60×100mm)**
   Schritt: Tag-Button → Groß
   Erwartet: 6 pro A4

⬜ **[Labels] Hängetikett Vorderseite: MALAK BEKLEIDUNG**
   Schritt: Print-Preview
   Erwartet: Brand in Playfair Display

⬜ **[Labels] Hängetikett Rückseite: Produktname + Barcode + Preis**
   Schritt: Print-Preview
   Erwartet: Name, Farbe·Größe, Barcode, SKU, Preis

⬜ **[Labels] Foto-Etikett Klein (30×30mm)**
   Schritt: Image-Button → Klein
   Erwartet: 54 pro A4

⬜ **[Labels] Foto-Etikett Mittel (50×35mm)**
   Schritt: Mittel
   Erwartet: 32 pro A4

⬜ **[Labels] Foto-Etikett Groß (50×50mm)**
   Schritt: Groß
   Erwartet: 20 pro A4

⬜ **[Labels] Foto-Etikett: Farbstreifen korrekt**
   Schritt: Herren-Produkt
   Erwartet: Roter Farbstreifen (Damen=Blau, Kinder=Grün, Unisex=Grau)

⬜ **[Labels] Foto-Etikett: farbspezifisches Bild**
   Schritt: Produkt mit 3 Farben → Foto-Etikett
   Erwartet: Jede Farbe zeigt eigenes Bild

⬜ **[Labels] Foto-Etikett: Platzhalter bei fehlendem Bild**
   Schritt: Produkt ohne Bild
   Erwartet: Grauer Kreis mit Initial-Buchstabe

⬜ **[Labels] Karton-Inhaltsliste (A4)**
   Schritt: Master-Box → Drucken
   Erwartet: A4 mit Produkttabelle + Master-Barcode

⬜ **[Labels] Batch-Druck Hängetikett**
   Schritt: Produktseite → "Alle Hängetiketten"
   Erwartet: Minimale A4-Seiten für alle Varianten

⬜ **[Labels] Batch-Druck Foto-Etikett**
   Schritt: "Alle Foto-Etiketten"
   Erwartet: Sortiert nach Produkt→Farbe→Größe

⬜ **[Labels] Etiketten-Station (/admin/etiketten)**
   Schritt: /admin/etiketten öffnen
   Erwartet: Tabs Foto/Hang, Suche, Varianten-Liste

⬜ **[Labels] Schnellfoto im Wareneingang**
   Schritt: Wareneingang → Foto-Button
   Erwartet: Kamera öffnet, Foto wird gespeichert

⬜ **[Labels] Etiketten ignorieren Ausverkäufe**
   Schritt: Produkt mit 0 Bestand
   Erwartet: Etiketten können weiterhin gedruckt werden

---

# 19. ZAHLUNGEN — DETAILS

⬜ **[Pay] Stripe: Kreditkarte**
   Schritt: Test-Karte 4242... → Submit
   Erwartet: succeeded

⬜ **[Pay] Stripe: Apple Pay (falls konfiguriert)**
   Schritt: Safari → Apple Pay Button
   Erwartet: Apple Pay Dialog erscheint

⬜ **[Pay] Stripe: Google Pay (falls konfiguriert)**
   Schritt: Chrome → Google Pay
   Erwartet: Google Pay Dialog erscheint

⬜ **[Pay] Stripe: SEPA Lastschrift**
   Schritt: SEPA → IBAN DE...
   Erwartet: Mandat erstellt, Order → pending → paid nach Clearing

⬜ **[Pay] Stripe: Giropay**
   Schritt: Giropay → Bank wählen → Redirect
   Erwartet: Nach Bestätigung zurück → paid

⬜ **[Pay] Klarna: Sofort**
   Schritt: Klarna → "Sofort zahlen"
   Erwartet: Klarna Redirect, paid

⬜ **[Pay] Klarna: Später (Rechnung)**
   Schritt: Klarna → "Später zahlen"
   Erwartet: Order paid, Klarna schickt Rechnung

⬜ **[Pay] Klarna: Raten**
   Schritt: Klarna → Raten
   Erwartet: Klarna Verifizierung, paid

⬜ **[Pay] Vorkasse: Bestätigung mit Bankdaten**
   Schritt: Vorkasse → Bestellen
   Erwartet: Bestätigungsseite zeigt IBAN, BIC, Verwendungszweck

⬜ **[Pay] Vorkasse: Verwendungszweck = Bestellnummer**
   Schritt: Bestellbestätigung
   Erwartet: "Verwendungszweck: ORD-2026-00123"

⬜ **[Pay] Vorkasse: KEINE Rechnung vor Zahlung**
   Schritt: Vorkasse-Order ansehen
   Erwartet: Invoice-Button ausgeblendet

⬜ **[Pay] Vorkasse: Admin bestätigt Zahlung**
   Schritt: Admin → Order → "Zahlung bestätigen"
   Erwartet: Status captured, Rechnung wird DANN erstellt

⬜ **[Pay] Vorkasse: E-Mail nach Bestätigung**
   Schritt: Admin bestätigt
   Erwartet: Kunde bekommt E-Mail mit Rechnung

⬜ **[Pay] SumUp: Card Widget lädt**
   Schritt: SumUp wählen
   Erwartet: SumUp Widget im Iframe

⬜ **[Pay] SumUp: Erfolgreiche Zahlung**
   Schritt: Test-Karte in SumUp
   Erwartet: Verify-Endpoint → paid

⬜ **[Pay] SumUp: Refund mit Transaction ID**
   Schritt: Refund SumUp-Order
   Erwartet: Transaction ID verwendet, Refund erfolgreich

⬜ **[Pay] PayPal: Orders API v2**
   Schritt: PayPal → Create Order → Redirect → Capture
   Erwartet: paid

⬜ **[Pay] PayPal: Abbruch → Redirect zu Cart**
   Schritt: PayPal Abbrechen
   Erwartet: Zurück zu Cart, keine Order

⬜ **[Pay] Admin-Toggle blendet Methoden im Checkout aus**
   Schritt: Admin → Stripe AUS → Checkout
   Erwartet: Stripe nicht wählbar

⬜ **[Pay] Zahlungs-Icons (Visa, MC, PayPal, Klarna, SumUp) sichtbar**
   Schritt: Checkout / Footer / Cart
   Erwartet: SVG-Logos

⬜ **[Pay] "Wir akzeptieren" im Footer/Cart**
   Schritt: Scroll zu Footer
   Erwartet: Logos-Badge sichtbar

---

# 20. FINANZBERICHTE — ERSTATTUNGEN

⬜ **[Finance-Refund] Erstattung im Tagesbericht als Minus**
   Schritt: Refund heute → /admin/finance → Tagesbericht
   Erwartet: "Erstattungen: -XX,XX €" Zeile sichtbar

⬜ **[Finance-Refund] Nettowert wird korrekt berechnet**
   Schritt: Umsatz 1000€, Refund 100€
   Erwartet: Netto-Umsatz 900€

⬜ **[Finance-Refund] Erstattung im Monatsbericht als Minus**
   Schritt: Monatsbericht prüfen
   Erwartet: Monatliche Refunds summiert als Minus

⬜ **[Finance-Refund] MwSt auf Erstattung abgezogen**
   Schritt: MwSt-Tab
   Erwartet: Refund-MwSt subtrahiert vom Total-MwSt

⬜ **[Finance-Refund] Kanal-Attribution bei Refund**
   Schritt: FB-Order refunden → Kanal-Tab
   Erwartet: -XX€ im FB-Kanal

⬜ **[Finance-Refund] Gutschrift PDF mit Artikeldetails**
   Schritt: GS PDF öffnen
   Erwartet: Pro Item: Name, Menge, Einzelpreis, Summe

⬜ **[Finance-Refund] Gutschrift PDF mit Bankdaten**
   Schritt: GS PDF öffnen
   Erwartet: IBAN/BIC im Footer

⬜ **[Finance-Refund] Gutschrift-Nummer fortlaufend**
   Schritt: Mehrere Gutschriften
   Erwartet: GS-2026-00001, GS-2026-00002, ... (keine Lücken)

---

# 21. E-MAIL TEMPLATES

⬜ **[Email] Bestellbestätigung (DE/EN/AR)**
   Schritt: Je Sprache bestellen → Mailbox
   Erwartet: 3 Varianten kommen an, korrekt übersetzt

⬜ **[Email] Status-Update bei Versand**
   Schritt: Admin → Status → "Versandt"
   Erwartet: Kunde bekommt E-Mail mit Tracking-Link

⬜ **[Email] Versandbestätigung mit Tracking**
   Schritt: DHL Label erstellt
   Erwartet: E-Mail mit DHL Tracking-URL

⬜ **[Email] Vorkasse Bankdaten-E-Mail**
   Schritt: Vorkasse-Order
   Erwartet: E-Mail mit IBAN, BIC, Verwendungszweck, Logo

⬜ **[Email] Vorkasse Reminder (7 Tage)**
   Schritt: Cron triggert
   Erwartet: Reminder-E-Mail

⬜ **[Email] Vorkasse Stornierung (10 Tage)**
   Schritt: Cron triggert
   Erwartet: Cancel-E-Mail

⬜ **[Email] Gast-Einladung zum Account**
   Schritt: Gast bestellt → Bestätigung
   Erwartet: E-Mail mit "Account erstellen" CTA

⬜ **[Email] Passwort-Reset**
   Schritt: "Passwort vergessen"
   Erwartet: Reset-Link kommt an, expired nach 1h

⬜ **[Email] Willkommen nach Registrierung**
   Schritt: Neuer Account
   Erwartet: Welcome-Mail mit Brand-Design

⬜ **[Email] Willkommen arabisch: "خدمة العملاء" (nicht إرجاع مجاني)**
   Schritt: AR-Account → Welcome-Mail
   Erwartet: "Kundenservice" nicht "kostenlose Rücksendung"

⬜ **[Email] Tägliche Zusammenfassung**
   Schritt: Cron End-Of-Day
   Erwartet: KPI-E-Mail an Admin (Umsatz, Orders, Refunds)

⬜ **[Email] Retoure requested**
   Schritt: Retoure einreichen
   Erwartet: Bestätigungs-E-Mail "Ihre Retoure wird geprüft"

⬜ **[Email] Retoure approved (Label senden)**
   Schritt: Admin "Label senden"
   Erwartet: E-Mail mit PDF-Anhang (Label)

⬜ **[Email] Retoure approved (Kunde zahlt)**
   Schritt: Admin "Kunde zahlt"
   Erwartet: E-Mail mit Shop-Adresse

⬜ **[Email] Retoure rejected**
   Schritt: Ablehnen
   Erwartet: E-Mail mit Ablehnungsgrund

⬜ **[Email] Retoure received**
   Schritt: Barcode scannen
   Erwartet: "Retoure eingetroffen" E-Mail

⬜ **[Email] Retoure refunded**
   Schritt: Erstattung verarbeiten
   Erwartet: "Erstattung erfolgt" E-Mail

⬜ **[Email] Gutschrift-E-Mail mit PDF-Anhang**
   Schritt: Refund verarbeitet
   Erwartet: E-Mail mit Gutschrift PDF

⬜ **[Email] Admin-Notification bei neuer Bestellung**
   Schritt: Kunde bestellt
   Erwartet: Admin bekommt E-Mail (wenn Toggle AN)

⬜ **[Email] Admin-Notification in AR + RTL**
   Schritt: Admin mit AR-Sprache
   Erwartet: E-Mail in AR, Cairo-Font, RTL-Layout

⬜ **[Email] Footer mit echten Firmendaten**
   Schritt: Alle E-Mails prüfen
   Erwartet: Name, Adresse, USt-IdNr aus ShopSettings (keine Platzhalter)

⬜ **[Email] Logo + Brand-Farben**
   Schritt: E-Mails ansehen
   Erwartet: MALAK Logo oben, Gold-Akzente

⬜ **[Email] Mobile-optimiert**
   Schritt: E-Mails auf Handy öffnen
   Erwartet: Responsive, lesbar

⬜ **[Email] Resend API Key funktioniert**
   Schritt: Test-E-Mail senden
   Erwartet: Kommt an (apps/api/.env Key, nicht Root)

---

# 22. FEHLERSEITEN

⬜ **[Error] 404 Seite nicht gefunden**
   Schritt: /nicht-existent aufrufen
   Erwartet: Malak-Stil 404, Link zurück zur Home

⬜ **[Error] 404 in 3 Sprachen**
   Schritt: /de/xxx, /en/xxx, /ar/xxx
   Erwartet: 404 übersetzt

⬜ **[Error] 500 Seite freundlich**
   Schritt: Server-Fehler provozieren
   Erwartet: Freundliche Meldung, Retry-Button

⬜ **[Error] Offline-Seite (PWA / Service Worker)**
   Schritt: Netzwerk abschalten
   Erwartet: Offline-Meldung oder Cache-Inhalt

⬜ **[Error] 403 bei fehlenden Rechten**
   Schritt: User ohne Permission → Admin-Route
   Erwartet: 403 freundlich, Logout-Option

⬜ **[Error] Error-Boundary fängt React-Crashes**
   Schritt: Crash in Component
   Erwartet: Fallback UI statt White Screen

---

# 23. BROWSER-KOMPATIBILITÄT

⬜ **[Browser] Chrome (Desktop)**
   Schritt: Latest Chrome
   Erwartet: Alle Features funktionieren

⬜ **[Browser] Firefox (Desktop)**
   Schritt: Latest Firefox
   Erwartet: Alle Features funktionieren

⬜ **[Browser] Safari (Desktop)**
   Schritt: Latest Safari
   Erwartet: Alle Features funktionieren (inkl. Stripe Apple Pay)

⬜ **[Browser] Edge (Desktop)**
   Schritt: Latest Edge
   Erwartet: Alle Features funktionieren

⬜ **[Browser] iOS Safari (Mobile)**
   Schritt: iPhone Safari
   Erwartet: Alle Features, Touch-Gesten, Apple Pay

⬜ **[Browser] Android Chrome (Mobile)**
   Schritt: Android Chrome
   Erwartet: Alle Features, Google Pay

⬜ **[Browser] Samsung Internet**
   Schritt: Samsung Galaxy
   Erwartet: Core-Features OK

⬜ **[Browser] Keine console.errors**
   Schritt: DevTools → Console in allen Browsern
   Erwartet: Keine Errors (Warnings OK)

---

# 24. WARTUNGSMODUS

⬜ **[Maintenance] Toggle AN im Admin**
   Schritt: /admin/maintenance → AN
   Erwartet: Setting gespeichert

⬜ **[Maintenance] Shop zeigt Wartungsseite**
   Schritt: Incognito → Shop
   Erwartet: Maintenance-Seite mit Logo

⬜ **[Maintenance] Countdown wird live aktualisiert**
   Schritt: End-Datum in 1h
   Erwartet: Countdown zählt runter

⬜ **[Maintenance] E-Mail-Sammlung funktioniert**
   Schritt: E-Mail eingeben → Submit
   Erwartet: In DB gespeichert, Dankesnachricht

⬜ **[Maintenance] Social Links sichtbar**
   Schritt: Wartungsseite
   Erwartet: Instagram/Facebook/TikTok Links

⬜ **[Maintenance] Admin-Bypass funktioniert**
   Schritt: Eingeloggter Admin → Shop
   Erwartet: Admin kommt trotzdem rein

⬜ **[Maintenance] Auto-Deaktivierung via Cron**
   Schritt: End-Datum in Vergangenheit → Cron
   Erwartet: Auto AUS

⬜ **[Maintenance] Texte in DE/AR editierbar**
   Schritt: Admin → Texte ändern
   Erwartet: Gespeichert, in Frontend sichtbar

⬜ **[Maintenance] Stats: Gesammelte E-Mails**
   Schritt: Admin → Stats
   Erwartet: Anzahl + Liste der E-Mails

---

# 25. KONTAKTSEITE

⬜ **[Contact] Formular sichtbar**
   Schritt: /contact
   Erwartet: Name, E-Mail, Betreff, Nachricht, Submit

⬜ **[Contact] Formular sendet E-Mail**
   Schritt: Ausfüllen → Submit
   Erwartet: E-Mail an Admin, Dankesnachricht

⬜ **[Contact] Validierung funktioniert**
   Schritt: Leere Felder → Submit
   Erwartet: Fehlermeldungen pro Feld

⬜ **[Contact] Telefonnummer klickbar**
   Schritt: Klick auf Nummer
   Erwartet: tel:-Link öffnet Telefon-App

⬜ **[Contact] Telefonnummer dir="ltr" in AR**
   Schritt: /ar/contact
   Erwartet: Nummer linksbündig, nicht spiegelverkehrt

⬜ **[Contact] E-Mail klickbar**
   Schritt: Klick auf E-Mail
   Erwartet: mailto:-Link öffnet Mail-App

⬜ **[Contact] Adresse sichtbar**
   Schritt: /contact
   Erwartet: Shop-Adresse angezeigt

⬜ **[Contact] Gold-Icons sichtbar**
   Schritt: /contact
   Erwartet: Icons in Gold #d4a853

⬜ **[Contact] Gold CTA-Button**
   Schritt: Submit-Button
   Erwartet: Gold-Hintergrund, h-14, font-semibold

---

# 26. GIFT CARDS

⬜ **[GiftCard] Kauf einer Gift Card**
   Schritt: Gift Card Produkt → Betrag wählen → Kaufen
   Erwartet: Order mit Gift-Card-Code in DB

⬜ **[GiftCard] Code wird per E-Mail versendet**
   Schritt: Nach erfolgreicher Zahlung
   Erwartet: E-Mail mit Code + Guthaben

⬜ **[GiftCard] Guthaben prüfen**
   Schritt: /gift-cards/check → Code eingeben
   Erwartet: Guthaben angezeigt

⬜ **[GiftCard] Im Checkout anwenden**
   Schritt: Checkout → Gift Card Feld → Code
   Erwartet: Rabatt in Höhe des Guthabens

⬜ **[GiftCard] Teilweise einlösen**
   Schritt: 50€ GC, 30€ Bestellung
   Erwartet: 30€ abgezogen, 20€ Restguthaben

⬜ **[GiftCard] Mehr als Bestellsumme**
   Schritt: 50€ GC, 30€ Bestellung
   Erwartet: 20€ Guthaben bleibt auf Karte

⬜ **[GiftCard] Abgelaufene Gift Card abgelehnt**
   Schritt: Expired Code
   Erwartet: "Gift Card abgelaufen"

⬜ **[GiftCard] Admin kann Gift Cards verwalten**
   Schritt: /admin/gift-cards
   Erwartet: Liste, Erstellen, Deaktivieren möglich

---

# 27. WISHLIST

⬜ **[Wishlist] Button auf Produktkarten**
   Schritt: Produktliste
   Erwartet: Herz-Icon oben rechts

⬜ **[Wishlist] Button auf PDP**
   Schritt: Produktseite
   Erwartet: Herz-Button sichtbar

⬜ **[Wishlist] Klick fügt hinzu**
   Schritt: Herz klicken
   Erwartet: Gefüllt, Toast "Zur Wishlist hinzugefügt"

⬜ **[Wishlist] Zweiter Klick entfernt**
   Schritt: Gefülltes Herz klicken
   Erwartet: Leer, "Entfernt"

⬜ **[Wishlist] Seite im Kundenkonto**
   Schritt: /account/wishlist
   Erwartet: Alle Wishlist-Items sichtbar

⬜ **[Wishlist] Zum Cart hinzufügen**
   Schritt: Wishlist → "In Warenkorb"
   Erwartet: Item im Cart

⬜ **[Wishlist] Persistent bei Re-Login**
   Schritt: Login → Wishlist → Logout → Login
   Erwartet: Wishlist erhalten

⬜ **[Wishlist] Gäste-Wishlist (localStorage)**
   Schritt: Ohne Login → Wishlist nutzen
   Erwartet: In localStorage gespeichert

⬜ **[Wishlist] Counter im Header**
   Schritt: Wishlist Items
   Erwartet: Badge mit Anzahl

---

# 28. HOMEPAGE DESIGN SWITCHER

⬜ **[Design] Admin: 3 Designs wählbar**
   Schritt: /admin/settings → Homepage Design
   Erwartet: Radio A / B / C sichtbar

⬜ **[Design] Live-Preview via ?preview=**
   Schritt: /?preview=B ohne Speichern
   Erwartet: Layout B sichtbar, Setting unverändert

⬜ **[Design] Speichern → sofortiger Wechsel**
   Schritt: Layout B → Speichern → / aufrufen
   Erwartet: Layout B live

⬜ **[Design] Preview nur für Admin wahrscheinlich (Optional)**
   Schritt: Nicht-Admin nutzt ?preview=
   Erwartet: Funktioniert (ist ein öffentlicher Query-Param)

⬜ **[Design] Layout A = Default**
   Schritt: Fresh DB, kein Setting
   Erwartet: Layout A wird geladen

⬜ **[Design] Ungültiger Wert fällt auf A zurück**
   Schritt: setting = "Z"
   Erwartet: Layout A wird geladen

⬜ **[Design] Wechsel zwischen Layouts per URL**
   Schritt: /?preview=A, /?preview=B, /?preview=C
   Erwartet: Jedes Layout lädt korrekt

---

# 29. PHOTON API AUTOCOMPLETE

⬜ **[Photon] Dropdown erscheint beim Tippen**
   Schritt: Straßenfeld → "Panni" eingeben
   Erwartet: Vorschläge erscheinen (debounced)

⬜ **[Photon] Klick auf Vorschlag füllt Felder**
   Schritt: "Pannierstraße 4, Berlin" klicken
   Erwartet: Straße, Hausnummer, PLZ, Stadt alle gefüllt

⬜ **[Photon] Funktioniert im Checkout**
   Schritt: /checkout → Adresse
   Erwartet: Autocomplete aktiv

⬜ **[Photon] Funktioniert im Account**
   Schritt: /account/addresses → Neu
   Erwartet: Autocomplete aktiv

⬜ **[Photon] Admin-Toggle AN/AUS**
   Schritt: Admin → Autovervollständigung AUS
   Erwartet: Dropdown nicht mehr sichtbar

⬜ **[Photon] Kein API-Key erforderlich**
   Schritt: .env prüfen
   Erwartet: Kein GOOGLE_PLACES_KEY

⬜ **[Photon] Nur deutsche Ergebnisse**
   Schritt: Eingabe "Berlin"
   Erwartet: Nur DE-Ergebnisse

---

# 30. TOAST/SNACKBAR SYSTEM

⬜ **[Toast] Stufe 1: Normale Toasts**
   Schritt: Add-to-Cart
   Erwartet: Toast oben/unten "Hinzugefügt", schließt nach 3s

⬜ **[Toast] Stufe 2: Modal-Bestätigung**
   Schritt: Adresse ändern
   Erwartet: Custom Modal "Sind Sie sicher?" (nicht browser-confirm)

⬜ **[Toast] Stufe 3: Gefährliche Aktion**
   Schritt: Account löschen / Produkt löschen
   Erwartet: Rotes Warn-Modal mit "Zum Bestätigen eintippen"

⬜ **[Toast] Undo-Funktion bei Löschen**
   Schritt: Item aus Cart entfernen
   Erwartet: Undo-Toast erscheint, Klick → Item zurück

⬜ **[Toast] KEINE native alert()**
   Schritt: grep -r "alert(" src/
   Erwartet: Keine Treffer (außer in node_modules)

⬜ **[Toast] KEINE native confirm()**
   Schritt: grep -r "confirm(" src/
   Erwartet: Keine Treffer

⬜ **[Toast] useConfirm() Hook statt confirm()**
   Schritt: Code-Review
   Erwartet: Custom Hook verwendet

⬜ **[Toast] Mehrere Toasts stacken korrekt**
   Schritt: 3 Actions schnell hintereinander
   Erwartet: 3 Toasts übereinander, nicht überlappend

⬜ **[Toast] Arabische Toast-Buttons**
   Schritt: /ar Delete-Bestätigung
   Erwartet: "تأكيد" / "إلغاء" (nicht Bestätigen/Abbrechen)

---

# 31. MASTER-BOX SYSTEM

⬜ **[Box] Karton erstellen mit Saison**
   Schritt: /admin/master-boxes → "Neu" → Saison Winter
   Erwartet: BOX-2026-W-001 erstellt

⬜ **[Box] Karton benennen (optional)**
   Schritt: Name-Feld editieren
   Erwartet: Custom-Name gespeichert

⬜ **[Box] Lager auswählen**
   Schritt: Lager-Dropdown
   Erwartet: Alle aktiven Lager angezeigt

⬜ **[Box] Scanner öffnet**
   Schritt: Box → Scanner
   Erwartet: Kamera-Zugriff Modal

⬜ **[Box] SKU scannen → Item hinzu**
   Schritt: Etikett scannen
   Erwartet: Item in Liste, Quantity 1

⬜ **[Box] Gleiche SKU 3× scannen**
   Schritt: 3× gleiche SKU
   Erwartet: Quantity auf 3

⬜ **[Box] Menge editieren (klickbar)**
   Schritt: Quantity klicken → 10 eintragen → Enter
   Erwartet: Quantity auf 10

⬜ **[Box] +/- Buttons funktionieren**
   Schritt: +/- klicken
   Erwartet: Quantity ±1

⬜ **[Box] Quantity auf 0 → Item entfernt**
   Schritt: Auf 0 setzen
   Erwartet: Item verschwindet

⬜ **[Box] A4 Druck mit Master-Barcode**
   Schritt: Drucken
   Erwartet: PDF mit Tabelle + Master-CODE128

⬜ **[Box] PDF zeigt Lager + Datum + Gesamt**
   Schritt: PDF prüfen
   Erwartet: Meta-Grid mit 3 Werten

⬜ **[Box] Transfer zwischen Lagern Preflight**
   Schritt: Transfer ohne Bestand
   Erwartet: Roter Warndialog, kein Transfer

⬜ **[Box] Transfer erfolgreich → auto sealed**
   Schritt: Mit Bestand transferieren
   Erwartet: Status → sealed, Lager gewechselt

⬜ **[Box] Status-Wechsel manuell**
   Schritt: "Öffnen" klicken
   Erwartet: Status packing/sealed/opened

⬜ **[Box] Badge im Inventar klickbar**
   Schritt: /admin/inventory
   Erwartet: BOX-Badge → navigiert zu Box-Detail

⬜ **[Box] Badge ist read-only Info**
   Schritt: Badge prüfen
   Erwartet: Keine Mengenänderung direkt möglich

⬜ **[Box] Master-Barcode scannen öffnet Detail**
   Schritt: Scanner → Master-Barcode scannen
   Erwartet: Box-Detailseite öffnet sich

⬜ **[Box] Lager-Filter-Chips zeigen Count**
   Schritt: Master-Boxes-Seite
   Erwartet: "Hamburg (5)", "Marzahn (3)"

⬜ **[Box] Leere Lager ausgeblendet**
   Schritt: Lager ohne Boxen
   Erwartet: Chip nicht sichtbar

---

# 32. EXPORT-FUNKTIONEN

⬜ **[Export] Rechnung als PDF einzeln**
   Schritt: /admin/invoices → Download
   Erwartet: PDF-Datei

⬜ **[Export] ZIP-Sammelexport pro Monat**
   Schritt: /admin/invoices → Monat wählen → "ZIP Export"
   Erwartet: ZIP mit allen PDFs

⬜ **[Export] Finanzbericht als CSV**
   Schritt: /admin/finance → Export CSV
   Erwartet: CSV mit allen Zeilen

⬜ **[Export] Finanzbericht als Excel**
   Schritt: Export Excel
   Erwartet: .xlsx Datei

⬜ **[Export] Kundenliste als CSV (DSGVO)**
   Schritt: /admin/customers → Export
   Erwartet: CSV mit allen Kunden (für DSGVO-Auskunft)

⬜ **[Export] Produktliste als CSV**
   Schritt: /admin/products → Export
   Erwartet: CSV mit SKU, Name, Preis, Bestand

⬜ **[Export] Bestelliste als CSV**
   Schritt: /admin/orders → Export
   Erwartet: CSV mit Orders im Zeitraum

⬜ **[Export] CSV-Encoding UTF-8 BOM (Excel-kompatibel)**
   Schritt: CSV in Excel öffnen
   Erwartet: Umlaute/Arabisch korrekt angezeigt

---

# 33. STRIPE + KLARNA WEBHOOKS

⬜ **[Webhook] Stripe: payment_intent.succeeded**
   Schritt: Stripe Dashboard → Test Webhook
   Erwartet: Order auf paid gesetzt

⬜ **[Webhook] Stripe: charge.refunded**
   Schritt: Stripe Dashboard Refund
   Erwartet: Order refund_status aktualisiert

⬜ **[Webhook] Stripe: payment_intent.payment_failed**
   Schritt: Failed Payment Webhook
   Erwartet: Order payment_failed Status

⬜ **[Webhook] Stripe: Signature-Verifizierung**
   Schritt: Webhook ohne Signature
   Erwartet: 401 Unauthorized

⬜ **[Webhook] Stripe: Idempotency**
   Schritt: Gleichen Webhook 2× senden
   Erwartet: Nur 1× verarbeitet

⬜ **[Webhook] Klarna: payment.authorized**
   Schritt: Klarna Webhook
   Erwartet: Order paid

⬜ **[Webhook] Klarna: order.captured**
   Schritt: Webhook
   Erwartet: Status captured

⬜ **[Webhook] Klarna: Signature-Verifizierung**
   Schritt: Ohne Signature
   Erwartet: 401

⬜ **[Webhook] DHL Shipment Webhook**
   Schritt: DHL status update
   Erwartet: Shipment status aktualisiert

⬜ **[Webhook] Fehler werden geloggt**
   Schritt: Webhook crasht
   Erwartet: Error in Log, 500 an Stripe (→ Retry)

⬜ **[Webhook] Retry von Stripe funktioniert**
   Schritt: Webhook failt → Stripe retries
   Erwartet: Irgendwann succeeds, kein Duplikat

---

# 34. GUEST CHECKOUT

⬜ **[Guest] Checkout ohne Account**
   Schritt: Cart → Checkout → "Als Gast"
   Erwartet: Formular ohne Login

⬜ **[Guest] Bestellung erfolgreich**
   Schritt: Gast-Checkout durchlaufen
   Erwartet: Order erstellt, Status paid

⬜ **[Guest] Bestellbestätigungs-E-Mail**
   Schritt: Nach Checkout
   Erwartet: E-Mail an Gast-Adresse kommt an

⬜ **[Guest] Einladung zur Account-Erstellung**
   Schritt: Bestätigungs-E-Mail
   Erwartet: CTA "Account erstellen" mit Pre-Fill der E-Mail

⬜ **[Guest] Account-Erstellung übernimmt Bestellungen**
   Schritt: Gast → Account erstellen (gleiche E-Mail)
   Erwartet: Alle bisherigen Gast-Bestellungen im Konto

⬜ **[Guest] Tracking ohne Login möglich**
   Schritt: /tracking → Bestellnummer + E-Mail
   Erwartet: Order-Status sichtbar ohne Login

⬜ **[Guest] Retoure ohne Account**
   Schritt: Tracking → "Retoure anfordern"
   Erwartet: Retouren-Formular für Gäste

⬜ **[Guest] Gast-Adresse wird als Snapshot gespeichert**
   Schritt: Gast bestellt
   Erwartet: Adresse in Order, nicht in Address-Tabelle

---

# 35. TRACKING-SEITE

⬜ **[Tracking] /tracking öffnet**
   Schritt: /tracking aufrufen
   Erwartet: Formular Bestellnummer + E-Mail

⬜ **[Tracking] Gültige Daten → Bestellung**
   Schritt: ORD-2026-00001 + Kunde-E-Mail
   Erwartet: Order-Detail angezeigt

⬜ **[Tracking] Ungültige Daten → Fehler**
   Schritt: Falsche Nummer
   Erwartet: "Nicht gefunden" Meldung

⬜ **[Tracking] DHL Tracking-Link sichtbar**
   Schritt: Versandte Bestellung
   Erwartet: "Bei DHL verfolgen" Button mit Link

⬜ **[Tracking] Für Registrierte Kunden und Gäste**
   Schritt: Beide Typen testen
   Erwartet: Beide sehen Order

⬜ **[Tracking] Progress-Bar sichtbar**
   Schritt: Tracking-Seite
   Erwartet: 5 Schritte Progress wie in Account

⬜ **[Tracking] Rate-Limit gegen Brute-Force**
   Schritt: Viele Tracking-Requests
   Erwartet: 429 nach X Versuchen

---

# 36. BESTELLBESTÄTIGUNGSSEITE

⬜ **[Confirm] Erfolg → korrekte Bestätigung**
   Schritt: Payment erfolgreich
   Erwartet: Seite zeigt Order-Nummer + "Vielen Dank"

⬜ **[Confirm] Zahlungsabbruch → KEINE falsche Bestätigung**
   Schritt: PayPal abbrechen
   Erwartet: Redirect zu Cart, keine Confirmation-Seite

⬜ **[Confirm] Browser-Back verhindert doppelte Bestellung**
   Schritt: Confirm-Seite → Browser-Back → Submit
   Erwartet: Keine zweite Order, Meldung "bereits bestellt"

⬜ **[Confirm] Idempotency-Key im Checkout**
   Schritt: Schnelles Doppel-Submit
   Erwartet: Nur 1 Order

⬜ **[Confirm] Reload lädt keine neue Order**
   Schritt: Confirm-Seite reloaden
   Erwartet: Gleiche Order angezeigt

⬜ **[Confirm] Bei Vorkasse: Bankdaten sichtbar**
   Schritt: Vorkasse-Bestätigung
   Erwartet: IBAN, BIC, Verwendungszweck

⬜ **[Confirm] "Zur Startseite" / "Zum Konto" CTAs**
   Schritt: Confirm-Seite
   Erwartet: Links funktionieren

---

# 37. BILDER-INFRASTRUKTUR

⬜ **[Images] Produktbilder laden von ImageKit/R2**
   Schritt: Network-Tab → Image-Request
   Erwartet: URL zeigt imagekit.io oder R2 (NICHT Supabase Storage)

⬜ **[Images] Supabase Storage NUR für PDFs**
   Schritt: Rechnung downloaden
   Erwartet: URL zeigt supabase.co für PDFs

⬜ **[Images] WebP Auto-Conversion**
   Schritt: Image request im Chrome
   Erwartet: .webp returned

⬜ **[Images] AVIF für Safari/neuere Browser**
   Schritt: Network-Tab in Safari
   Erwartet: .avif wo supported

⬜ **[Images] Responsive Bildgrößen (srcset)**
   Schritt: View Source
   Erwartet: next/image mit sizes

⬜ **[Images] Komprimierung aktiv**
   Schritt: Image-Size prüfen
   Erwartet: < 100KB für normale Produktbilder

⬜ **[Images] Lazy-Loading für Below-fold**
   Schritt: Network-Tab
   Erwartet: Below-fold Bilder laden erst beim Scrollen

⬜ **[Images] Priority für Hero-Image**
   Schritt: Network Waterfall
   Erwartet: Hero zuerst geladen mit fetchpriority=high

⬜ **[Images] Placeholder bei fehlendem Bild**
   Schritt: Produkt ohne Bild
   Erwartet: Grauer Kreis mit Initial

⬜ **[Images] Alt-Tags immer gesetzt**
   Schritt: Images inspizieren
   Erwartet: Alle haben alt-Attribut

---

# 38. PREFERS-REDUCED-MOTION

⬜ **[A11y-Motion] OS-Einstellung respektiert**
   Schritt: macOS/iOS → Bewegung reduzieren AN
   Erwartet: Keine GSAP-Animationen

⬜ **[A11y-Motion] Framer Motion stoppt**
   Schritt: prefers-reduced-motion: reduce
   Erwartet: Keine Animationen, direkte State-Wechsel

⬜ **[A11y-Motion] Hero-Parallax stoppt**
   Schritt: Hero-Section
   Erwartet: Statisches Bild, kein Parallax

⬜ **[A11y-Motion] Partikel-Effekte deaktiviert**
   Schritt: Falls vorhanden
   Erwartet: Keine Partikel animiert

⬜ **[A11y-Motion] Page-Transitions instant**
   Schritt: Zwischen Seiten wechseln
   Erwartet: Kein Fade, direkte Navigation

⬜ **[A11y-Motion] Sale-Pulse deaktiviert**
   Schritt: Sale-Badges
   Erwartet: Statisch, kein Pulsieren

⬜ **[A11y-Motion] Gallery-Crossfade direkt**
   Schritt: Bild wechseln
   Erwartet: Instant Switch, kein Fade

⬜ **[A11y-Motion] Scroll-Reveal deaktiviert**
   Schritt: Scrollen
   Erwartet: Inhalt ist sofort sichtbar

---

# 39. INVENTUR (STOCKTAKE)

⬜ **[Stocktake] Inventur starten**
   Schritt: /admin/inventory → "Inventur starten"
   Erwartet: Neue Inventur angelegt

⬜ **[Stocktake] Produkte zählen**
   Schritt: SKU scannen + tatsächliche Menge eingeben
   Erwartet: Ist-Menge gespeichert

⬜ **[Stocktake] Differenzen anzeigen**
   Schritt: Zählung abschließen
   Erwartet: Tabelle mit Soll vs Ist vs Diff

⬜ **[Stocktake] Nur Überschuss markieren**
   Schritt: Filter "positive Diff"
   Erwartet: Nur Überschüsse sichtbar

⬜ **[Stocktake] Nur Schwund markieren**
   Schritt: Filter "negative Diff"
   Erwartet: Nur Verluste sichtbar

⬜ **[Stocktake] Bestand korrigieren**
   Schritt: "Korrigieren" → Bestätigen
   Erwartet: quantityOnHand aktualisiert, Audit-Log-Eintrag

⬜ **[Stocktake] Inventur archivieren**
   Schritt: Abschließen
   Erwartet: Status completed, nicht mehr editierbar

⬜ **[Stocktake] History aller Inventuren**
   Schritt: /admin/inventory/stocktakes
   Erwartet: Liste aller durchgeführten Inventuren

---

# 40. BATCH-VERSAND IM ADMIN

⬜ **[Batch] "Alle versenden" Button**
   Schritt: /admin/orders → Mehrfach-Auswahl oder "Alle Pending" Button
   Erwartet: Dialog mit Liste aller versand-bereiten Orders

⬜ **[Batch] Adress-Prüfung pro Order**
   Schritt: Dialog öffnen
   Erwartet: Jede Adresse wird geprüft, Warnungen sichtbar

⬜ **[Batch] Verdächtige Adressen markiert**
   Schritt: Order mit unvollständiger Adresse
   Erwartet: Rot markiert, Warnung-Icon

⬜ **[Batch] Ausschluss-Checkboxen**
   Schritt: Orders per Checkbox ausschließen
   Erwartet: Nur ausgewählte Orders im Batch

⬜ **[Batch] Batch-Ausführung**
   Schritt: "Versenden" klicken
   Erwartet: Alle Labels auf einmal erstellt

⬜ **[Batch] Fortschritts-Anzeige**
   Schritt: Batch läuft
   Erwartet: Progress-Bar X von Y

⬜ **[Batch] Fehler pro Order abfangen**
   Schritt: Eine Order failed
   Erwartet: Andere laufen weiter, Fehler im Log

⬜ **[Batch] Sammel-PDF aller Labels**
   Schritt: Nach Batch
   Erwartet: 1 großes PDF mit allen Labels oder einzelne Downloads

⬜ **[Batch] Status-Update für alle gleichzeitig**
   Schritt: Batch abgeschlossen
   Erwartet: Alle Orders → "shipped"

---

# 📊 ZUSAMMENFASSUNG

| # | Bereich | Tests |
|---|---|---|
| 1 | Shop-Funktionen (Kundenseite) | ~125 |
| 2 | Admin-Dashboard | ~155 |
| 3 | Sicherheit | 21 |
| 4 | Performance | 19 |
| 5 | Rechtlich (Deutschland) | 22 |
| 6 | Sprachen + RTL | 19 |
| 7 | Responsive | 17 |
| 8 | DHL Adressvalidierung | 12 |
| 9 | Smart Sizing System | 11 |
| 10 | KI-Integration | 18 |
| 11 | DeepL Übersetzung | 7 |
| 12 | Social Commerce | 16 |
| 13 | Scanner-Funktionen | 13 |
| 14 | Cron-Jobs | 9 |
| 15 | Bestellungen — Spezialfälle | 13 |
| 16 | Login-Methoden | 9 |
| 17 | Keyboard Shortcuts | 8 |
| 18 | Etiketten komplett | 20 |
| 19 | Zahlungen — Details | 21 |
| 20 | Finanzberichte — Erstattungen | 8 |
| 21 | E-Mail Templates | 24 |
| 22 | Fehlerseiten | 6 |
| 23 | Browser-Kompatibilität | 8 |
| 24 | Wartungsmodus | 9 |
| 25 | Kontaktseite | 9 |
| 26 | Gift Cards | 8 |
| 27 | Wishlist | 9 |
| 28 | Homepage Design Switcher | 7 |
| 29 | Photon API Autocomplete | 7 |
| 30 | Toast/Snackbar System | 9 |
| 31 | Master-Box System | 19 |
| 32 | Export-Funktionen | 8 |
| 33 | Stripe + Klarna Webhooks | 11 |
| 34 | Guest Checkout | 8 |
| 35 | Tracking-Seite | 7 |
| 36 | Bestellbestätigungsseite | 7 |
| 37 | Bilder-Infrastruktur | 10 |
| 38 | prefers-reduced-motion | 8 |
| 39 | Inventur (Stocktake) | 8 |
| 40 | Batch-Versand im Admin | 9 |
| | **GESAMT** | **~750** |

---

## 🎯 EMPFOHLENE REIHENFOLGE

1. **Tag 1:** Shop-Funktionen (1.1 - 1.6) — Kern-Funktionalität
2. **Tag 2:** Shop-Funktionen (1.7 - 1.12) + Rechtliches
3. **Tag 3:** Admin-Dashboard (2.1 - 2.8)
4. **Tag 4:** Admin-Dashboard (2.9 - 2.18)
5. **Tag 5:** Sicherheit + Performance
6. **Tag 6:** Sprachen + RTL + Responsive
7. **Tag 7:** Re-Test aller ❌ Fehlgeschlagenen

---

## 📝 NOTIZEN

- Bei jedem ❌ bitte Screenshot + Beschreibung machen
- Bei kritischen Fehlern sofort melden, nicht weiter testen
- Datum des Tests + Tester-Name pro Sektion notieren
- Nach Fix: Re-Test und Status auf ✅ setzen
