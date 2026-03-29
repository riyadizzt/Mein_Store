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

      <h2>3. Datenerfassung auf dieser Website</h2>
      <h3>Cookies</h3>
      <p>
        Unsere Internetseiten verwenden so genannte „Cookies". Cookies sind kleine Datenpakete und richten
        auf Ihrem Endgerät keinen Schaden an. Sie werden entweder vorübergehend für die Dauer einer Sitzung
        (Session-Cookies) oder dauerhaft (permanente Cookies) auf Ihrem Endgerät gespeichert.
      </p>
      <p>
        Sie können Ihren Browser so einstellen, dass Sie über das Setzen von Cookies informiert werden und
        Cookies nur im Einzelfall erlauben, die Annahme von Cookies für bestimmte Fälle oder generell
        ausschließen sowie das automatische Löschen der Cookies beim Schließen des Browsers aktivieren.
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

      <h2>6. Ihre Rechte</h2>
      <p>Sie haben jederzeit das Recht auf:</p>
      <ul>
        <li>Auskunft über Ihre gespeicherten Daten (Art. 15 DSGVO)</li>
        <li>Berichtigung unrichtiger Daten (Art. 16 DSGVO)</li>
        <li>Löschung Ihrer Daten (Art. 17 DSGVO)</li>
        <li>Einschränkung der Verarbeitung (Art. 18 DSGVO)</li>
        <li>Datenübertragbarkeit (Art. 20 DSGVO)</li>
        <li>Widerspruch gegen die Verarbeitung (Art. 21 DSGVO)</li>
      </ul>
      <p>Kontaktieren Sie uns unter: {email}</p>

      <h2>7. Datenexport</h2>
      <p>
        Sie können jederzeit in Ihrem Kundenkonto unter „Account löschen" einen Export aller Ihrer
        personenbezogenen Daten anfordern (Art. 20 DSGVO).
      </p>

      <p><em>Stand: März 2026 — Diese Datenschutzerklärung wird regelmäßig aktualisiert.</em></p>
    </>
  )
}
