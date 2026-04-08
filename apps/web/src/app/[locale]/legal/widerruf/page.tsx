'use client'

import { useLocale } from 'next-intl'

const TEXTS = {
  de: {
    title: 'Widerrufsbelehrung',
    rightTitle: 'Widerrufsrecht',
    rightText1: 'Sie haben das Recht, binnen <strong>vierzehn Tagen</strong> ohne Angabe von Gründen diesen Vertrag zu widerrufen. Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen haben bzw. hat.',
    rightText2: 'Um Ihr Widerrufsrecht auszuüben, müssen Sie uns mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.',
    contactTitle: 'Kontakt für den Widerruf',
    contactNote: 'Sie können auch den Widerruf über Ihr Kundenkonto unter „Meine Bestellungen" → „Widerruf beantragen" einleiten. Ein Rücksendeetikett wird Ihnen automatisch per E-Mail zugesandt.',
    consequencesTitle: 'Folgen des Widerrufs',
    consequencesText1: 'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist.',
    consequencesText2: 'Für die Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.',
    returnTitle: 'Rücksendung',
    returnText1: 'Die <strong>Kosten der Rücksendung trägt der Kunde</strong>. Sie können das Rücksendeetikett über Ihr Kundenkonto anfordern oder die Ware selbstständig an uns zurücksenden.',
    returnText2: 'Sie haben die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem Sie uns über den Widerruf dieses Vertrags unterrichten, an uns zurückzusenden oder zu übergeben.',
    exclusionsTitle: 'Ausschluss des Widerrufsrechts',
    exclusionsNote: 'Das Widerrufsrecht besteht nicht bei Verträgen:',
    exclusion1: 'zur Lieferung versiegelter Waren, die aus Gründen des Gesundheitsschutzes oder der Hygiene nicht zur Rückgabe geeignet sind, wenn ihre Versiegelung nach der Lieferung entfernt wurde',
    exclusion2: 'zur Lieferung von Waren, die nach Kundenspezifikation angefertigt werden',
    asOf: 'Stand: März 2026',
  },
  en: {
    title: 'Withdrawal Policy',
    rightTitle: 'Right of Withdrawal',
    rightText1: 'You have the right to withdraw from this contract within <strong>fourteen days</strong> without giving any reason. The withdrawal period is fourteen days from the day on which you or a third party named by you, who is not the carrier, has taken possession of the goods.',
    rightText2: 'To exercise your right of withdrawal, you must inform us by means of a clear statement (e.g. a letter sent by post or an email) of your decision to withdraw from this contract.',
    contactTitle: 'Contact for Withdrawal',
    contactNote: 'You can also initiate the withdrawal via your customer account under "My Orders" → "Request Return". A return shipping label will be sent to you automatically by email.',
    consequencesTitle: 'Consequences of Withdrawal',
    consequencesText1: 'If you withdraw from this contract, we shall reimburse all payments received from you, including delivery costs (except for additional costs arising from your choice of a type of delivery other than the cheapest standard delivery we offer), without undue delay and no later than fourteen days from the day on which we are informed of your decision to withdraw from this contract.',
    consequencesText2: 'We will use the same means of payment as you used for the original transaction, unless expressly agreed otherwise; in no case will you be charged any fees for this reimbursement.',
    returnTitle: 'Returns',
    returnText1: '<strong>Return shipping costs are borne by the customer</strong>. You can request a return shipping label via your customer account or send the goods back to us independently.',
    returnText2: 'You must send back the goods without undue delay and in any event no later than fourteen days from the day on which you communicate your withdrawal from this contract to us.',
    exclusionsTitle: 'Exclusions from the Right of Withdrawal',
    exclusionsNote: 'The right of withdrawal does not apply to contracts:',
    exclusion1: 'for the supply of sealed goods which are not suitable for return due to health protection or hygiene reasons, if their seal has been removed after delivery',
    exclusion2: 'for the supply of goods that are made to the customer\'s specifications',
    asOf: 'As of: March 2026',
  },
  ar: {
    title: 'سياسة الإلغاء والإرجاع',
    rightTitle: 'حق الإلغاء',
    rightText1: 'لديك الحق في إلغاء هذا العقد خلال <strong>أربعة عشر يوماً</strong> دون إبداء أي سبب. تبدأ فترة الإلغاء من اليوم الذي استلمت فيه أنت أو طرف ثالث تحدده (غير شركة الشحن) البضائع.',
    rightText2: 'لممارسة حقك في الإلغاء، يجب عليك إبلاغنا بقرارك بإلغاء هذا العقد من خلال بيان واضح (مثل رسالة بريدية أو بريد إلكتروني).',
    contactTitle: 'جهة الاتصال للإلغاء',
    contactNote: 'يمكنك أيضاً بدء عملية الإلغاء من حسابك تحت "طلباتي" ← "طلب إرجاع". سيتم إرسال ملصق الإرجاع إليك تلقائياً عبر البريد الإلكتروني.',
    consequencesTitle: 'نتائج الإلغاء',
    consequencesText1: 'في حال إلغاء هذا العقد، سنقوم برد جميع المدفوعات التي تلقيناها منك، بما في ذلك تكاليف التوصيل (باستثناء التكاليف الإضافية الناتجة عن اختيارك لطريقة توصيل غير أرخص طريقة قياسية نقدمها)، دون تأخير غير مبرر وفي موعد أقصاه أربعة عشر يوماً من اليوم الذي نُبلغ فيه بقرار إلغائك.',
    consequencesText2: 'سنستخدم نفس وسيلة الدفع التي استخدمتها في المعاملة الأصلية، ما لم يتم الاتفاق صراحة على خلاف ذلك؛ ولن يتم تحميلك أي رسوم مقابل هذا الاسترداد.',
    returnTitle: 'الإرجاع',
    returnText1: '<strong>تكاليف الإرجاع يتحملها العميل</strong>. يمكنك طلب ملصق الإرجاع من حسابك أو إرسال البضائع إلينا بشكل مستقل.',
    returnText2: 'يجب عليك إرسال البضائع دون تأخير غير مبرر وفي موعد أقصاه أربعة عشر يوماً من اليوم الذي تبلغنا فيه بإلغاء هذا العقد.',
    exclusionsTitle: 'استثناءات حق الإلغاء',
    exclusionsNote: 'لا ينطبق حق الإلغاء على العقود:',
    exclusion1: 'لتوريد بضائع مختومة غير مناسبة للإرجاع لأسباب تتعلق بحماية الصحة أو النظافة، إذا تمت إزالة الختم بعد التسليم',
    exclusion2: 'لتوريد بضائع مصنوعة وفقاً لمواصفات العميل',
    asOf: 'الحالة: مارس 2026',
  },
}

export default function WiderrufPage() {
  const locale = useLocale()
  const t = TEXTS[locale as keyof typeof TEXTS] ?? TEXTS.de

  const company = process.env.NEXT_PUBLIC_COMPANY_NAME ?? 'Malak Bekleidung'
  const address = process.env.NEXT_PUBLIC_COMPANY_ADDRESS ?? '[Adresse wird ergänzt]'
  const email = process.env.NEXT_PUBLIC_COMPANY_EMAIL ?? 'info@malak-bekleidung.com'
  const phone = process.env.NEXT_PUBLIC_COMPANY_PHONE ?? '[wird ergänzt]'

  return (
    <>
      <h1>{t.title}</h1>

      <h2>{t.rightTitle}</h2>
      <p dangerouslySetInnerHTML={{ __html: t.rightText1 }} />
      <p>{t.rightText2}</p>

      <h2>{t.contactTitle}</h2>
      <p>
        {company}<br />
        {address}<br />
        {locale === 'ar' ? 'البريد الإلكتروني' : 'E-Mail'}: {email}<br />
        {locale === 'ar' ? 'الهاتف' : locale === 'en' ? 'Phone' : 'Telefon'}: {phone}
      </p>
      <p>{t.contactNote}</p>

      <h2>{t.consequencesTitle}</h2>
      <p>{t.consequencesText1}</p>
      <p>{t.consequencesText2}</p>

      <h2>{t.returnTitle}</h2>
      <p dangerouslySetInnerHTML={{ __html: t.returnText1 }} />
      <p>{t.returnText2}</p>

      <h2>{t.exclusionsTitle}</h2>
      <p>{t.exclusionsNote}</p>
      <ul>
        <li>{t.exclusion1}</li>
        <li>{t.exclusion2}</li>
      </ul>

      <p><em>{t.asOf}</em></p>
    </>
  )
}
