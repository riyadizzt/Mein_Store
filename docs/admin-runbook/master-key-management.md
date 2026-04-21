# Master-Key-Management — Channel OAuth Token Encryption

Dieser Runbook beschreibt, wie der `CHANNEL_TOKEN_MASTER_KEY` lokal
erzeugt, in Produktion gesetzt und im Katastrophenfall wiederhergestellt
wird. Der Schlüssel schützt OAuth-Tokens für eBay / TikTok Shop, die im
`sales_channel_configs`-Table verschlüsselt gespeichert werden.

---

## Phase A — Aktuelle Entwicklungs-Phase (heute)

Das Projekt läuft lokal gegen Supabase. Es gibt noch kein Produktions-
Deployment und noch keine echten Channel-OAuth-Tokens. Der Dev-Key wird
nur für Unit-Tests und zukünftige lokale eBay-Sandbox-Tests benötigt.

### Schritt 1 — Dev-Key erzeugen

```bash
openssl rand -base64 32
# Beispiel-Ausgabe: pF3kYq7BvX2+oN8+yM1aLZqR0sH5nT9WcG4jK6uV3xE=
```

### Schritt 2 — In `apps/api/.env` eintragen

```
CHANNEL_TOKEN_MASTER_KEY=pF3kYq7BvX2+oN8+yM1aLZqR0sH5nT9WcG4jK6uV3xE=
```

### Schritt 3 — Verifikation

```bash
cd apps/api
pnpm exec jest --testPathPattern='channel-token-encryption'
# Erwartet: 36/36 Tests grün
```

### Sicherheitsregeln Phase A

- **Niemals** den Dev-Key in `.env.example`, irgendein `.env.*` außerhalb
  von lokalen `.gitignore`-geschützten Files, oder in Commits einchecken.
- Der Dev-Key schützt derzeit **nichts Produktives**. Er existiert, damit
  der Encryption-Helper initialisiert werden kann, wenn er in Tests und
  (später) in eBay-Sandbox-Aufrufen verwendet wird.
- Jeder Entwickler auf demselben Rechner kann einen eigenen Dev-Key
  nutzen — keine Koordination nötig.

---

## Phase B — Deployment-Vorbereitung (vor Produktions-Launch)

Wenn der Shop live geht und eBay / TikTok Shop produktiv autorisiert
werden, muss ein **separater** Production-Master-Key existieren.

### Schritt 1 — Production-Key erzeugen

Auf einer sicheren Maschine (idealerweise offline-fähiger Rechner):

```bash
openssl rand -base64 32
```

### Schritt 2 — Im Password-Manager sichern

Speichere den Key als neuen Eintrag in Bitwarden / 1Password:

- **Titel:** `Malak — CHANNEL_TOKEN_MASTER_KEY (Production)`
- **Wert:** der generierte Base64-String
- **Notiz:** Datum der Erstellung, Rotation-Historie

**Pflicht:** Zweiter Zugriff (2nd-Admin oder Offline-Kopie in einem
verschlüsselten Container). Ein einzelner Verlustpunkt macht alle eBay/
TikTok-Tokens unrecoverable.

### Schritt 3 — Als Railway-Env-Variable setzen

```bash
# Nur via Railway Dashboard oder Railway CLI
railway vars set CHANNEL_TOKEN_MASTER_KEY="<der-production-key>"
```

**Nicht** per SSH oder per committetem File setzen. Nur über die
Railway-Oberfläche.

### Schritt 4 — Production-Key ≠ Dev-Key

Verifiziere nach dem Deploy, dass der Railway-Key sich vom lokalen Dev-
Key unterscheidet:

```bash
railway run 'echo "${CHANNEL_TOKEN_MASTER_KEY:0:8}..."'
# Gibt die ersten 8 Zeichen aus — vergleiche mit lokaler .env
# Die dürfen NICHT identisch sein
```

### Sicherheitsregeln Phase B

- **Niemals** denselben Key für Dev und Production verwenden.
- **Niemals** den Production-Key in einem Chat / E-Mail / Ticket-System
  teilen. Nur Password-Manager oder direktes Railway-Dashboard.
- Rotation alle 12 Monate ist gute Praxis (Implementation in späterer
  Phase, siehe unten).

---

## Disaster-Recovery — Verlust des Production-Master-Keys

**Szenario:** Der Production-Key in Railway wurde überschrieben, der
Password-Manager-Eintrag ist weg, die Offline-Kopie ist nicht mehr
auffindbar.

**Konsequenz:** Alle in `sales_channel_configs.access_token` und
`refresh_token` gespeicherten OAuth-Tokens sind **unwiderruflich
verloren**. Die Daten sind kryptografisch korrekt verschlüsselt — ohne
den Master-Key mathematisch unrecoverable.

**Wiederherstellung:**

1. Neuen Master-Key generieren (Phase B Schritt 1).
2. In Railway setzen.
3. Im Admin-Panel unter `/admin/channels/ebay` (+ TikTok) **neu
   autorisieren**:
   - eBay-OAuth-Flow durchlaufen → neuer Access + Refresh Token.
   - Gleiches für TikTok Shop.
4. Prüfen, dass alle Listings wieder `status='active'` haben.

**Kein Datenverlust** im eigentlichen Sinne — nur die Token-Kette muss
neu aufgebaut werden. Bestehende eBay-Listings, Orders, Returns bleiben
bei eBay intakt. Nach Re-Auth synchronisiert das System sich automatisch
wieder.

**Service-Unterbrechung:** 5–15 Minuten pro Channel während der
Re-Authorization.

---

## Rotation — Konzept (später Phase)

Nicht in Phase 1 implementiert, aber vorbereitet:

- Zweite Env-Variable `CHANNEL_TOKEN_MASTER_KEY_PREV` erlaubt, dass der
  Helper beim Entschlüsseln **erst den aktuellen**, dann den
  vorherigen Key probiert.
- Admin-Cron läuft einmalig nach Rotation und re-encrypted alle Rows
  mit dem neuen Key.
- `CHANNEL_TOKEN_MASTER_KEY_PREV` wird entfernt, sobald der Cron
  bestätigt dass keine Row mehr den alten Key benötigt.

Details werden in einer späteren Phase dokumentiert, wenn Rotation
praktisch relevant wird.

---

## Verifikation der Helper-Konfiguration

Schneller Check, ob der Helper korrekt lädt:

```bash
cd apps/api
pnpm exec ts-node -e "
  import { encryptChannelToken, decryptChannelToken } from './src/common/helpers/channel-token-encryption';
  const t = encryptChannelToken('test-token-123');
  console.log('envelope:', t.slice(0, 20) + '...');
  console.log('round-trip:', decryptChannelToken(t));
"
```

Bei fehlendem / falschem Key erscheint ein 3-sprachiger Error mit
Setup-Hinweis.
