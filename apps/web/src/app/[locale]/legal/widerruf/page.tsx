import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Widerrufsbelehrung' }

export default function WiderrufPage() {
  const company = process.env.COMPANY_NAME ?? 'Malak [Rechtsform wird ergänzt]'
  const address = process.env.COMPANY_ADDRESS ?? '[Adresse wird ergänzt]'
  const email = process.env.COMPANY_CONTACT_EMAIL ?? 'info@malak-bekleidung.com'
  const phone = process.env.COMPANY_PHONE ?? '[wird ergänzt]'

  return (
    <>
      <h1>Widerrufsbelehrung</h1>

      <h2>Widerrufsrecht</h2>
      <p>
        Sie haben das Recht, binnen <strong>vierzehn Tagen</strong> ohne Angabe von Gründen diesen
        Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder
        ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen
        haben bzw. hat.
      </p>
      <p>
        Um Ihr Widerrufsrecht auszuüben, müssen Sie uns mittels einer eindeutigen Erklärung
        (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen
        Vertrag zu widerrufen, informieren.
      </p>

      <h2>Kontakt für den Widerruf</h2>
      <p>
        {company}<br />
        {address}<br />
        E-Mail: {email}<br />
        Telefon: {phone}
      </p>

      <p>
        Sie können auch den Widerruf über Ihr Kundenkonto unter „Meine Bestellungen" → „Widerruf
        beantragen" einleiten. Ein Rücksendeetikett wird Ihnen automatisch per E-Mail zugesandt.
      </p>

      <h2>Folgen des Widerrufs</h2>
      <p>
        Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen
        erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten,
        die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene,
        günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn
        Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags
        bei uns eingegangen ist.
      </p>
      <p>
        Für die Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen
        Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes
        vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.
      </p>

      <h2>Rücksendung</h2>
      <p>
        Die <strong>Rücksendung ist für Sie kostenlos</strong>. Nutzen Sie das Rücksendeetikett,
        das Ihnen per E-Mail zugesandt wird, oder fordern Sie eines über Ihr Kundenkonto an.
      </p>
      <p>
        Sie haben die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab
        dem Tag, an dem Sie uns über den Widerruf dieses Vertrags unterrichten, an uns
        zurückzusenden oder zu übergeben.
      </p>

      <h2>Ausschluss des Widerrufsrechts</h2>
      <p>Das Widerrufsrecht besteht nicht bei Verträgen:</p>
      <ul>
        <li>zur Lieferung versiegelter Waren, die aus Gründen des Gesundheitsschutzes oder der Hygiene nicht zur Rückgabe geeignet sind, wenn ihre Versiegelung nach der Lieferung entfernt wurde</li>
        <li>zur Lieferung von Waren, die nach Kundenspezifikation angefertigt werden</li>
      </ul>

      <p><em>Stand: März 2026</em></p>
    </>
  )
}
