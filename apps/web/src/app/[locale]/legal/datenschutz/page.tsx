import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Datenschutzerklärung' }

export default function DatenschutzPage() {
  const company = process.env.COMPANY_NAME ?? 'Malak [Rechtsform wird ergänzt]'
  const email = process.env.COMPANY_CONTACT_EMAIL ?? 'info@malak-bekleidung.com'

  return (
    <>
      <h1>Datenschutzerklärung</h1>

      <h2>1. Datenschutz auf einen Blick</h2>
      <h3>Allgemeine Hinweise</h3>
      <p>
        Die folgenden Hinweise geben einen einfachen Überblick darüber, was mit Ihren personenbezogenen
        Daten passiert, wenn Sie diese Website besuchen. Personenbezogene Daten sind alle Daten, mit denen
        Sie persönlich identifiziert werden können.
      </p>

      <h2>2. Verantwortliche Stelle</h2>
      <p>{company}<br />E-Mail: {email}</p>

      <h2>3. Cookies und Einwilligung</h2>
      <h3>Ihr Wahlrecht (Opt-In)</h3>
      <p>
        Beim ersten Besuch unseres Shops erscheint ein Cookie-Banner. Sie können wählen, ob Sie
        nur notwendige Cookies oder zusätzlich Analyse- und Marketing-Cookies akzeptieren möchten.
        Tracking-Technologien werden <strong>erst nach Ihrer ausdrücklichen Einwilligung</strong> aktiviert
        (Art. 6 Abs. 1 lit. a DSGVO). Sie können Ihre Einwilligung jederzeit widerrufen über den
        Link „Cookie-Einstellungen" im Footer unserer Website.
      </p>

      <h3>Kategorie 1: Notwendige Cookies (immer aktiv)</h3>
      <p>
        Diese Cookies sind für den Betrieb des Shops unerlässlich. Sie ermöglichen grundlegende
        Funktionen wie den Warenkorb, die Sprachauswahl und die Anmeldung. <strong>Sie können nicht
        deaktiviert werden.</strong>
      </p>
      <ul>
        <li><strong>Warenkorb</strong> — Speichert Ihren Warenkorb (localStorage)</li>
        <li><strong>Spracheinstellung</strong> — Speichert Ihre gewählte Sprache</li>
        <li><strong>Authentifizierung</strong> — JWT-Token für die Anmeldung</li>
        <li><strong>Cookie-Consent</strong> — Speichert Ihre Cookie-Präferenzen</li>
      </ul>

      <h3>Kategorie 2: Analyse-Cookies (optional)</h3>
      <p>
        Diese Cookies helfen uns zu verstehen, wie Besucher unseren Shop nutzen.
        Die Daten werden <strong>ausschließlich auf EU-Servern</strong> (Frankfurt) verarbeitet.
      </p>
      <ul>
        <li>
          <strong>PostHog Analytics</strong> — Erfasst Seitenaufrufe, Klickverhalten und
          anonymisierte Nutzungsdaten. Anbieter: PostHog Inc., Datenverarbeitung über
          eu.posthog.com (EU-Rechenzentrum). PostHog kann Sitzungsaufnahmen erstellen,
          bei denen Eingabefelder automatisch maskiert werden.
        </li>
      </ul>

      <h3>Kategorie 3: Marketing-Cookies (optional)</h3>
      <p>
        Diese Cookies ermöglichen personalisierte Werbung und Retargeting-Kampagnen über
        Drittanbieter-Plattformen.
      </p>
      <ul>
        <li>
          <strong>Meta Pixel (Facebook/Instagram)</strong> — Erfasst Seitenaufrufe, Produktansichten
          und Kaufabschlüsse zur Ausspielung personalisierter Werbung auf Facebook und Instagram.
          Anbieter: Meta Platforms Ireland Ltd.
        </li>
        <li>
          <strong>TikTok Pixel</strong> — Erfasst Seitenaufrufe und Kaufereignisse zur Ausspielung
          personalisierter Werbung auf TikTok. Anbieter: TikTok Technology Ltd. (Irland).
        </li>
      </ul>

      <h3>Einwilligung widerrufen</h3>
      <p>
        Sie können Ihre Cookie-Einwilligung jederzeit ändern oder widerrufen.
        Klicken Sie dazu auf „Cookie-Einstellungen" im Footer unserer Website oder löschen Sie
        die Cookies in Ihren Browsereinstellungen.
      </p>

      <h3>Server-Log-Dateien</h3>
      <p>
        Der Provider der Seiten erhebt und speichert automatisch Informationen in so genannten
        Server-Log-Dateien, die Ihr Browser automatisch an uns übermittelt.
      </p>

      <h2>4. Bestellabwicklung</h2>
      <p>
        Zur Abwicklung Ihrer Bestellung verarbeiten wir folgende Daten: Name, Adresse, E-Mail-Adresse,
        Telefonnummer, Zahlungsinformationen. Die Verarbeitung erfolgt auf Grundlage von Art. 6 Abs. 1
        lit. b DSGVO.
      </p>

      <h2>5. Zahlungsdienstleister</h2>
      <p>
        Wir nutzen Stripe, Klarna und PayPal als Zahlungsdienstleister. Ihre Zahlungsdaten werden
        direkt an den jeweiligen Dienstleister übermittelt und nicht auf unseren Servern gespeichert.
      </p>

      <h2>6. Datenspeicherung</h2>
      <p>
        Alle Kundendaten werden auf EU-Servern gespeichert (Supabase, Frankfurt am Main).
        Analyse-Daten werden über PostHog auf EU-Servern verarbeitet (eu.posthog.com).
        Es findet <strong>keine Übertragung an Server außerhalb der EU</strong> statt, sofern
        Sie keine Marketing-Cookies akzeptieren.
      </p>

      <h2>7. Ihre Rechte</h2>
      <p>Sie haben jederzeit das Recht auf:</p>
      <ul>
        <li>Auskunft über Ihre gespeicherten Daten (Art. 15 DSGVO)</li>
        <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
        <li>Löschung Ihrer Daten (Art. 17 DSGVO)</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
        <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
        <li><strong>Widerruf Ihrer Einwilligung</strong> zu Cookies jederzeit über die Cookie-Einstellungen im Footer</li>
      </ul>
      <p>Kontaktieren Sie uns unter: {email}</p>

      <h2>8. Datenexport</h2>
      <p>
        Sie können jederzeit in Ihrem Kundenkonto unter „Account löschen" einen Export aller Ihrer
        personenbezogenen Daten anfordern (Art. 20 DSGVO).
      </p>

      <p><em>Stand: April 2026 — Diese Datenschutzerklärung wird regelmäßig aktualisiert.</em></p>
    </>
  )
}
