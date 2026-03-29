import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Impressum' }

export default function ImpressumPage() {
  const company = process.env.COMPANY_NAME ?? 'Malak [Rechtsform wird ergänzt]'
  const address = process.env.COMPANY_ADDRESS ?? '[Adresse wird ergänzt]'
  const ceo = process.env.COMPANY_CEO ?? '[Geschäftsführer wird ergänzt]'
  const register = process.env.COMPANY_REGISTER ?? '[Registergericht + HRB wird ergänzt]'
  const vatId = process.env.COMPANY_VAT_ID ?? '[USt-IdNr. wird ergänzt]'
  const phone = process.env.COMPANY_PHONE ?? '[wird ergänzt]'
  const email = process.env.COMPANY_CONTACT_EMAIL ?? 'info@malak-bekleidung.com'

  return (
    <>
      <h1>Impressum</h1>
      <h2>Angaben gemäß § 5 TMG</h2>
      <p>{company}<br />{address}</p>

      <h2>Vertreten durch</h2>
      <p>Geschäftsführer: {ceo}</p>

      <h2>Kontakt</h2>
      <p>Telefon: {phone}<br />E-Mail: {email}</p>

      <h2>Registereintrag</h2>
      <p>{register}</p>

      <h2>Umsatzsteuer-Identifikationsnummer</h2>
      <p>gemäß § 27 a Umsatzsteuergesetz: {vatId}</p>

      <h2>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
      <p>{ceo}<br />{address}</p>

      <h2>Streitschlichtung</h2>
      <p>
        Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
        {' '}<a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noopener noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>.
      </p>
      <p>Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>

      <h2>Haftung für Inhalte</h2>
      <p>
        Als Diensteanbieter sind wir gemäß § 7 Abs.1 TMG für eigene Inhalte auf diesen Seiten
        nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter
        jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen.
      </p>
    </>
  )
}
