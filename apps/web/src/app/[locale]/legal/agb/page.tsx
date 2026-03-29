import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'AGB' }

export default function AGBPage() {
  const company = process.env.COMPANY_NAME ?? 'Malak [Rechtsform wird ergänzt]'
  const email = process.env.COMPANY_CONTACT_EMAIL ?? 'info@malak-bekleidung.com'

  return (
    <>
      <h1>Allgemeine Geschäftsbedingungen</h1>

      <h2>§ 1 Geltungsbereich</h2>
      <p>
        Diese Allgemeinen Geschäftsbedingungen (AGB) gelten für alle Bestellungen, die über den
        Online-Shop von {company} getätigt werden.
      </p>

      <h2>§ 2 Vertragsschluss</h2>
      <p>
        Die Darstellung der Produkte im Online-Shop stellt kein rechtlich bindendes Angebot dar,
        sondern eine unverbindliche Aufforderung, Waren zu bestellen. Mit dem Absenden der Bestellung
        geben Sie ein verbindliches Angebot ab. Die Annahme des Angebots erfolgt durch die Auftragsbestätigung per E-Mail.
      </p>

      <h2>§ 3 Preise und Zahlung</h2>
      <p>
        Alle angegebenen Preise verstehen sich inklusive der gesetzlichen Mehrwertsteuer von 19%.
        Versandkosten werden gesondert ausgewiesen und sind vom Kunden zu tragen, sofern nicht
        anders angegeben.
      </p>
      <p>Wir akzeptieren folgende Zahlungsarten: Kreditkarte (Visa, Mastercard), Klarna, PayPal, Apple Pay, Google Pay.</p>

      <h2>§ 4 Lieferung</h2>
      <p>
        Die Lieferung erfolgt an die vom Kunden angegebene Lieferadresse. Die Lieferzeit beträgt
        in der Regel 2-4 Werktage innerhalb Deutschlands. Für Lieferungen ins EU-Ausland kann
        eine längere Lieferzeit anfallen.
      </p>

      <h2>§ 5 Eigentumsvorbehalt</h2>
      <p>
        Die gelieferte Ware bleibt bis zur vollständigen Bezahlung Eigentum von {company}.
      </p>

      <h2>§ 6 Gewährleistung</h2>
      <p>
        Es gelten die gesetzlichen Gewährleistungsrechte. Die Gewährleistungsfrist für neue Waren
        beträgt zwei Jahre ab Lieferung.
      </p>

      <h2>§ 7 Haftung</h2>
      <p>
        {company} haftet unbeschränkt für Vorsatz und grobe Fahrlässigkeit. Für leichte
        Fahrlässigkeit haften wir nur bei Verletzung wesentlicher Vertragspflichten.
      </p>

      <h2>§ 8 Datenschutz</h2>
      <p>
        Informationen zur Verarbeitung Ihrer personenbezogenen Daten finden Sie in unserer
        {' '}<a href="/de/legal/datenschutz">Datenschutzerklärung</a>.
      </p>

      <h2>§ 9 Schlussbestimmungen</h2>
      <p>
        Es gilt das Recht der Bundesrepublik Deutschland. Gerichtsstand ist der Sitz von {company}.
      </p>
      <p>Kontakt: {email}</p>

      <p><em>Stand: März 2026</em></p>
    </>
  )
}
