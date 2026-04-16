/**
 * Install final legal content into the database.
 * Run: npx ts-node scripts/install-legal-final.ts
 *
 * DISCLAIMER: Diese Texte sind Entwürfe und müssen vor dem Launch
 * von einem Rechtsanwalt geprüft werden.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const LEGAL: Record<string, string> = {}

// ═══════════════════════════════════════════════════════════
// IMPRESSUM
// ═══════════════════════════════════════════════════════════

LEGAL.impressum_de = `# Impressum

## Angaben gemäß § 5 TMG

Malak Bekleidung
Inhaber: Mohammad Albraqi
Pannierstr. 4
12047 Berlin
Deutschland

## Kontakt

Telefon: +49 157 78413511
E-Mail: info@malak-bekleidung.com

## Umsatzsteuer-Identifikationsnummer

Umsatzsteuer-Identifikationsnummer gemäß § 27a Umsatzsteuergesetz:
DE327937542

## Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV

Mohammad Albraqi
Pannierstr. 4
12047 Berlin
Deutschland

## Streitschlichtung

Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit:
https://ec.europa.eu/consumers/odr/

Unsere E-Mail-Adresse findest du oben im Impressum.

Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.

## Haftung für Inhalte

Als Diensteanbieter sind wir gemäß § 7 Abs. 1 TMG für eigene Inhalte auf diesen Seiten nach den allgemeinen Gesetzen verantwortlich. Nach §§ 8 bis 10 TMG sind wir als Diensteanbieter jedoch nicht verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.

Verpflichtungen zur Entfernung oder Sperrung der Nutzung von Informationen nach den allgemeinen Gesetzen bleiben hiervon unberührt. Eine diesbezügliche Haftung ist jedoch erst ab dem Zeitpunkt der Kenntnis einer konkreten Rechtsverletzung möglich. Bei Bekanntwerden von entsprechenden Rechtsverletzungen werden wir diese Inhalte umgehend entfernen.

## Haftung für Links

Unser Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben. Deshalb können wir für diese fremden Inhalte auch keine Gewähr übernehmen. Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber der Seiten verantwortlich.

## Urheberrecht

Die durch die Seitenbetreiber erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen Urheberrecht. Die Vervielfältigung, Bearbeitung, Verbreitung und jede Art der Verwertung außerhalb der Grenzen des Urheberrechtes bedürfen der schriftlichen Zustimmung des jeweiligen Autors bzw. Erstellers.

Stand: April 2026`

LEGAL.impressum_en = `# Legal Notice (Impressum)

## Company Information (§ 5 TMG)

Malak Bekleidung
Owner: Mohammad Albraqi
Pannierstr. 4
12047 Berlin
Germany

## Contact

Phone: +49 157 78413511
Email: info@malak-bekleidung.com

## VAT Identification Number

VAT ID according to § 27a of the German VAT Act:
DE327937542

## Responsible for content (§ 55 Abs. 2 RStV)

Mohammad Albraqi
Pannierstr. 4
12047 Berlin
Germany

## Dispute Resolution

The European Commission provides a platform for online dispute resolution (ODR):
https://ec.europa.eu/consumers/odr/

Our email address can be found above.

We are neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board.

## Liability for Content

As a service provider, we are responsible for our own content on these pages in accordance with § 7 (1) TMG. According to §§ 8 to 10 TMG, however, we are not obliged to monitor transmitted or stored third-party information or to investigate circumstances that indicate illegal activity.

## Liability for Links

Our website contains links to external third-party websites over whose content we have no influence. We therefore cannot accept any liability for this third-party content.

## Copyright

The content and works on these pages created by the site operators are subject to German copyright law. Reproduction, editing, distribution, and any kind of use beyond the limits of copyright law require the written consent of the respective author or creator.

Last updated: April 2026`

LEGAL.impressum_ar = `# البيانات القانونية

## معلومات الشركة وفقاً للقانون الألماني (§ 5 TMG)

Malak Bekleidung
المالك: محمد البراقي
Pannierstr. 4
12047 Berlin
ألمانيا

## التواصل

الهاتف: +49 157 78413511
البريد الإلكتروني: info@malak-bekleidung.com

## الرقم الضريبي

رقم التعريف الضريبي وفقاً للمادة 27أ من قانون ضريبة القيمة المضافة:
DE327937542

## المسؤول عن المحتوى (§ 55 Abs. 2 RStV)

محمد البراقي
Pannierstr. 4
12047 Berlin
ألمانيا

## تسوية النزاعات

توفر المفوضية الأوروبية منصة لتسوية النزاعات عبر الإنترنت:
https://ec.europa.eu/consumers/odr/

يمكنك العثور على عنوان بريدنا الإلكتروني أعلاه.

نحن غير ملزمين وغير مستعدين للمشاركة في إجراءات تسوية النزاعات أمام هيئة تحكيم المستهلكين.

## المسؤولية عن المحتوى

بصفتنا مقدم خدمة، نحن مسؤولون عن المحتوى الخاص بنا على هذه الصفحات وفقاً للقوانين العامة. ومع ذلك، لسنا ملزمين بمراقبة المعلومات المنقولة أو المخزنة من أطراف ثالثة.

## المسؤولية عن الروابط

يحتوي موقعنا على روابط لمواقع خارجية لأطراف ثالثة لا نملك أي تأثير على محتواها. لذلك لا يمكننا تحمل أي مسؤولية عن محتوى هذه المواقع.

## حقوق النشر

المحتوى والأعمال الموجودة على هذه الصفحات تخضع لقانون حقوق النشر الألماني.

آخر تحديث: أبريل 2026`

// ═══════════════════════════════════════════════════════════
// AGB
// ═══════════════════════════════════════════════════════════

LEGAL.agb_de = `# Allgemeine Geschäftsbedingungen

## § 1 Geltungsbereich

Für die Geschäftsbeziehung zwischen Malak Bekleidung (nachfolgend „Anbieter") und dem Kunden gelten ausschließlich die nachfolgenden Allgemeinen Geschäftsbedingungen in ihrer zum Zeitpunkt der Bestellung gültigen Fassung. Abweichende Bedingungen des Kunden werden nicht anerkannt, es sei denn, der Anbieter stimmt ihrer Geltung ausdrücklich schriftlich zu.

## § 2 Vertragspartner

Der Kaufvertrag kommt zustande mit:

Malak Bekleidung
Inhaber: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Deutschland
E-Mail: info@malak-bekleidung.com
Telefon: +49 157 78413511
USt-IdNr.: DE327937542

## § 3 Vertragsschluss

(1) Die Darstellung der Produkte im Online-Shop stellt kein rechtlich bindendes Angebot dar, sondern eine Aufforderung zur Abgabe einer Bestellung.

(2) Durch Anklicken des Buttons „Jetzt kaufen" gibt der Kunde eine verbindliche Bestellung der im Warenkorb enthaltenen Waren ab. Die Bestellung kann nur abgegeben werden, wenn der Kunde diese Vertragsbedingungen akzeptiert hat.

(3) Der Anbieter sendet dem Kunden eine automatische Bestellbestätigung per E-Mail. Diese Bestätigung stellt noch keine Annahme des Vertragsangebotes dar. Der Vertrag kommt erst durch die Versandbestätigung oder die Auslieferung der Ware zustande.

## § 4 Preise und Versandkosten

(1) Alle Preise im Online-Shop verstehen sich inklusive der gesetzlichen Umsatzsteuer (derzeit 19 %).

(2) Die Versandkosten werden dem Kunden vor Abgabe der Bestellung deutlich mitgeteilt. Innerhalb Deutschlands erfolgt der Versand über DHL. Ab einem Warenwert von 100,00 € liefert der Anbieter versandkostenfrei innerhalb Deutschlands.

(3) Bei Lieferungen in andere EU-Länder gelten gesonderte Versandkosten, die im Bestellprozess transparent dargestellt werden.

## § 5 Lieferbedingungen

(1) Die Lieferung erfolgt an die vom Kunden angegebene Lieferadresse.

(2) Die Lieferzeit innerhalb Deutschlands beträgt in der Regel 2–5 Werktage nach Zahlungseingang. Bei Lieferungen ins EU-Ausland kann sich die Lieferzeit entsprechend verlängern.

(3) Kann ein bestelltes Produkt nicht geliefert werden, wird der Anbieter den Kunden unverzüglich informieren. Bereits erbrachte Zahlungen werden unverzüglich erstattet.

## § 6 Zahlungsbedingungen

(1) Der Kunde kann aus folgenden Zahlungsmethoden wählen:

- Kreditkarte (Visa, Mastercard) über Stripe
- PayPal
- Klarna
- SumUp
- Vorkasse (Banküberweisung)

(2) Bei Zahlung per Vorkasse ist der Kaufpreis innerhalb der in der Bestellbestätigung genannten Frist zu überweisen. Die Ware wird erst nach Zahlungseingang versandt. Erfolgt keine Zahlung innerhalb der Frist, wird die Bestellung automatisch storniert.

(3) Bei Zahlung über Klarna, PayPal oder Stripe gelten die jeweiligen Nutzungsbedingungen des Zahlungsdienstleisters zusätzlich.

## § 7 Eigentumsvorbehalt

Bis zur vollständigen Bezahlung bleibt die Ware Eigentum des Anbieters.

## § 8 Gewährleistung

(1) Es gelten die gesetzlichen Gewährleistungsrechte.

(2) Der Kunde wird gebeten, die Ware bei Anlieferung auf offensichtliche Mängel zu prüfen und diese dem Anbieter unverzüglich mitzuteilen.

(3) Die Gewährleistungsfrist beträgt zwei Jahre ab Lieferung der Ware.

## § 9 Haftung

(1) Der Anbieter haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit sowie für vorsätzlich oder grob fahrlässig verursachte Schäden.

(2) Im Übrigen haftet der Anbieter nur bei Verletzung wesentlicher Vertragspflichten, wobei die Haftung auf den vorhersehbaren, vertragstypischen Schaden begrenzt ist.

## § 10 Widerrufsrecht

Verbrauchern steht ein gesetzliches Widerrufsrecht zu. Die vollständige Widerrufsbelehrung findest du unter dem Menüpunkt „Widerrufsbelehrung".

## § 11 Datenschutz

Der Anbieter erhebt und verarbeitet personenbezogene Daten des Kunden nur im Rahmen der geltenden Datenschutzbestimmungen. Einzelheiten findest du in unserer Datenschutzerklärung.

## § 12 Außergerichtliche Streitbeilegung

(1) Die Europäische Kommission stellt eine Plattform zur Online-Streitbeilegung (OS) bereit: https://ec.europa.eu/consumers/odr/

(2) Wir sind nicht bereit oder verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.

## § 13 Schlussbestimmungen

(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts. Für Verbraucher gilt diese Rechtswahl nur, soweit nicht der gewährte Schutz durch zwingende Bestimmungen des Rechts des Staates, in dem der Verbraucher seinen gewöhnlichen Aufenthalt hat, entzogen wird.

(2) Sollten einzelne Bestimmungen dieser AGB unwirksam sein, bleibt die Wirksamkeit des Vertrages im Übrigen unberührt.

Stand: April 2026`

LEGAL.agb_en = `# Terms and Conditions

## § 1 Scope

These General Terms and Conditions apply exclusively to the business relationship between Malak Bekleidung (hereinafter "Provider") and the customer in the version valid at the time of the order.

## § 2 Contracting Party

The purchase contract is concluded with:

Malak Bekleidung
Owner: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Germany
Email: info@malak-bekleidung.com
Phone: +49 157 78413511
VAT ID: DE327937542

## § 3 Conclusion of Contract

(1) The presentation of products in the online shop does not constitute a legally binding offer, but an invitation to place an order.

(2) By clicking the "Buy now" button, the customer places a binding order. The order can only be placed if the customer accepts these terms and conditions.

(3) The Provider sends an automatic order confirmation by email. This confirmation does not yet constitute acceptance of the offer. The contract is concluded only upon dispatch confirmation or delivery of the goods.

## § 4 Prices and Shipping Costs

(1) All prices in the online shop include the applicable statutory value-added tax (currently 19%).

(2) Shipping costs are clearly communicated before placing the order. Within Germany, shipping is via DHL. Free shipping within Germany for orders over €100.00.

(3) For deliveries to other EU countries, separate shipping costs apply, which are transparently displayed during the ordering process.

## § 5 Delivery

(1) Delivery is made to the delivery address specified by the customer.

(2) Delivery within Germany usually takes 2–5 business days after receipt of payment. Deliveries to other EU countries may take longer.

(3) If a product cannot be delivered, the Provider will inform the customer immediately. Payments already made will be refunded promptly.

## § 6 Payment Methods

(1) The customer can choose from the following payment methods:

- Credit card (Visa, Mastercard) via Stripe
- PayPal
- Klarna
- SumUp
- Bank transfer (prepayment)

(2) For bank transfer payments, the purchase price must be transferred within the deadline stated in the order confirmation. Goods will only be shipped after receipt of payment.

(3) When paying via Klarna, PayPal, or Stripe, the respective terms of the payment service provider also apply.

## § 7 Retention of Title

The goods remain the property of the Provider until full payment has been made.

## § 8 Warranty

(1) Statutory warranty rights apply.

(2) The customer is asked to inspect the goods upon delivery for obvious defects and to report these to the Provider immediately.

(3) The warranty period is two years from delivery of the goods.

## § 9 Liability

(1) The Provider is fully liable for damages resulting from injury to life, body, or health, as well as for damages caused intentionally or through gross negligence.

(2) Otherwise, liability is limited to foreseeable, contract-typical damage in the event of a breach of essential contractual obligations.

## § 10 Right of Withdrawal

Consumers have a statutory right of withdrawal. The full withdrawal policy can be found under "Withdrawal Policy".

## § 11 Data Protection

The Provider collects and processes personal data only in accordance with applicable data protection regulations. Details can be found in our Privacy Policy.

## § 12 Online Dispute Resolution

(1) The European Commission provides a platform for online dispute resolution (ODR): https://ec.europa.eu/consumers/odr/

(2) We are neither obliged nor willing to participate in dispute resolution proceedings before a consumer arbitration board.

## § 13 Final Provisions

(1) The law of the Federal Republic of Germany applies, excluding the UN Convention on Contracts for the International Sale of Goods. For consumers, this choice of law only applies insofar as the protection granted by mandatory provisions of the law of the consumer's country of residence is not withdrawn.

(2) Should individual provisions of these Terms be invalid, the validity of the contract as a whole shall remain unaffected.

Last updated: April 2026`

LEGAL.agb_ar = `# الشروط والأحكام العامة

## المادة 1 — نطاق التطبيق

تسري هذه الشروط والأحكام العامة حصرياً على العلاقة التجارية بين Malak Bekleidung (يُشار إليه فيما بعد بـ "المزود") والعميل بالصيغة السارية وقت الطلب.

## المادة 2 — الطرف المتعاقد

يُبرم عقد الشراء مع:

Malak Bekleidung
المالك: محمد البراقي
Pannierstr. 4, 12047 Berlin, ألمانيا
البريد الإلكتروني: info@malak-bekleidung.com
الهاتف: +49 157 78413511
الرقم الضريبي: DE327937542

## المادة 3 — إبرام العقد

(1) عرض المنتجات في المتجر الإلكتروني لا يُشكل عرضاً ملزماً قانونياً، بل دعوة لتقديم طلب.

(2) بالنقر على زر "اشترِ الآن"، يقدم العميل طلباً ملزماً. لا يمكن تقديم الطلب إلا إذا وافق العميل على هذه الشروط والأحكام.

(3) يرسل المزود تأكيد طلب تلقائي عبر البريد الإلكتروني. هذا التأكيد لا يُشكل قبولاً للعرض. يُبرم العقد فقط عند إرسال تأكيد الشحن أو تسليم البضاعة.

## المادة 4 — الأسعار وتكاليف الشحن

(1) جميع الأسعار في المتجر تشمل ضريبة القيمة المضافة القانونية (حالياً 19%).

(2) يتم إبلاغ العميل بتكاليف الشحن قبل تقديم الطلب. يتم الشحن داخل ألمانيا عبر DHL. الشحن مجاني للطلبات التي تزيد قيمتها عن 100 يورو داخل ألمانيا.

## المادة 5 — شروط التسليم

(1) يتم التسليم إلى عنوان التسليم المحدد من قبل العميل.

(2) مدة التسليم داخل ألمانيا عادةً 2-5 أيام عمل بعد استلام الدفع.

(3) إذا تعذر تسليم منتج، يقوم المزود بإبلاغ العميل فوراً وإعادة المبالغ المدفوعة.

## المادة 6 — طرق الدفع

يمكن للعميل الاختيار من طرق الدفع التالية:

- بطاقة ائتمان (Visa, Mastercard) عبر Stripe
- PayPal
- Klarna
- SumUp
- تحويل بنكي مسبق

## المادة 7 — الاحتفاظ بالملكية

تبقى البضاعة ملكاً للمزود حتى السداد الكامل.

## المادة 8 — الضمان

(1) تسري حقوق الضمان القانونية.

(2) يُرجى من العميل فحص البضاعة عند الاستلام والإبلاغ عن أي عيوب ظاهرة فوراً.

(3) مدة الضمان سنتان من تاريخ تسليم البضاعة.

## المادة 9 — حق الانسحاب

يحق للمستهلكين حق الانسحاب القانوني. يمكنك الاطلاع على سياسة الانسحاب الكاملة تحت "سياسة الإرجاع".

## المادة 10 — حماية البيانات

يقوم المزود بجمع ومعالجة البيانات الشخصية وفقاً لقوانين حماية البيانات المعمول بها. التفاصيل في سياسة الخصوصية.

## المادة 11 — تسوية النزاعات

توفر المفوضية الأوروبية منصة لتسوية النزاعات عبر الإنترنت: https://ec.europa.eu/consumers/odr/

نحن غير ملزمين وغير مستعدين للمشاركة في إجراءات تسوية النزاعات.

## المادة 12 — أحكام ختامية

يسري قانون جمهورية ألمانيا الاتحادية مع استبعاد اتفاقية الأمم المتحدة بشأن البيع الدولي للبضائع.

آخر تحديث: أبريل 2026`

// ═══════════════════════════════════════════════════════════
// WIDERRUF
// ═══════════════════════════════════════════════════════════

LEGAL.widerruf_de = `# Widerrufsbelehrung

## Widerrufsrecht

Du hast das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.

Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag, an dem du oder ein von dir benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen hast bzw. hat.

Um dein Widerrufsrecht auszuüben, musst du uns:

Malak Bekleidung
Inhaber: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Deutschland
E-Mail: info@malak-bekleidung.com
Telefon: +49 157 78413511

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder E-Mail) über deinen Entschluss, diesen Vertrag zu widerrufen, informieren. Du kannst dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.

Zur Wahrung der Widerrufsfrist reicht es aus, dass du die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absendest.

## Folgen des Widerrufs

Wenn du diesen Vertrag widerrufst, haben wir dir alle Zahlungen, die wir von dir erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass du eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt hast), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über deinen Widerruf dieses Vertrags bei uns eingegangen ist.

Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das du bei der ursprünglichen Transaktion eingesetzt hast, es sei denn, mit dir wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden dir wegen dieser Rückzahlung Entgelte berechnet.

Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis du den Nachweis erbracht hast, dass du die Waren zurückgesandt hast, je nachdem, welches der frühere Zeitpunkt ist.

Du hast die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem du uns über den Widerruf dieses Vertrags unterrichtest, an uns zurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn du die Waren vor Ablauf der Frist von vierzehn Tagen absendest.

**Du trägst die unmittelbaren Kosten der Rücksendung der Waren.**

Du musst für einen etwaigen Wertverlust der Waren nur aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.

## Ausschluss des Widerrufsrechts

Das Widerrufsrecht besteht nicht bei folgenden Verträgen:

- Verträge zur Lieferung von Waren, die nicht vorgefertigt sind und für deren Herstellung eine individuelle Auswahl oder Bestimmung durch den Verbraucher maßgeblich ist oder die eindeutig auf die persönlichen Bedürfnisse des Verbrauchers zugeschnitten sind.

- Verträge zur Lieferung versiegelter Waren, die aus Gründen des Gesundheitsschutzes oder der Hygiene nicht zur Rückgabe geeignet sind, wenn ihre Versiegelung nach der Lieferung entfernt wurde (z. B. versiegelte Unterwäsche oder Bademode).

## Muster-Widerrufsformular

(Wenn du den Vertrag widerrufen willst, dann fülle bitte dieses Formular aus und sende es zurück.)

An:
Malak Bekleidung, Inhaber: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Deutschland
E-Mail: info@malak-bekleidung.com

Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren:

- Bestellt am / erhalten am:
- Name des Verbrauchers:
- Anschrift des Verbrauchers:
- Datum:

(*) Unzutreffendes streichen.

Stand: April 2026`

LEGAL.widerruf_en = `# Withdrawal Policy

## Right of Withdrawal

You have the right to withdraw from this contract within fourteen days without giving any reason.

The withdrawal period is fourteen days from the day on which you or a third party named by you, who is not the carrier, took possession of the goods.

To exercise your right of withdrawal, you must inform us:

Malak Bekleidung
Owner: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Germany
Email: info@malak-bekleidung.com
Phone: +49 157 78413511

by means of a clear declaration (e.g. a letter sent by post or email) of your decision to withdraw from this contract. You may use the enclosed model withdrawal form, but this is not mandatory.

To meet the withdrawal deadline, it is sufficient for you to send the communication concerning your exercise of the right of withdrawal before the withdrawal period has expired.

## Effects of Withdrawal

If you withdraw from this contract, we shall reimburse all payments received from you, including delivery costs (with the exception of additional costs resulting from your choice of a type of delivery other than the least expensive standard delivery offered by us), without undue delay and no later than fourteen days from the day on which we receive notice of your withdrawal.

We will use the same means of payment as you used for the original transaction, unless expressly agreed otherwise; in no case will you be charged any fees for this refund.

We may refuse reimbursement until we have received the goods back or until you have provided proof that you have returned the goods, whichever is earlier.

You must return the goods to us without undue delay and in any case no later than fourteen days from the day on which you inform us of the withdrawal. The deadline is met if you send the goods before the fourteen-day period has expired.

**You bear the direct costs of returning the goods.**

You only need to pay for any loss in value of the goods if this loss in value is due to handling that was not necessary to examine the nature, characteristics, and functioning of the goods.

## Exclusions from the Right of Withdrawal

The right of withdrawal does not apply to the following contracts:

- Contracts for the delivery of goods that are not prefabricated and for whose production an individual selection or determination by the consumer is decisive, or which are clearly tailored to the personal needs of the consumer.

- Contracts for the delivery of sealed goods that are not suitable for return for health protection or hygiene reasons if their seal has been removed after delivery (e.g. sealed underwear or swimwear).

## Model Withdrawal Form

(If you wish to withdraw from the contract, please fill out this form and return it.)

To:
Malak Bekleidung, Owner: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Germany
Email: info@malak-bekleidung.com

I/We (*) hereby withdraw from the contract concluded by me/us (*) for the purchase of the following goods:

- Ordered on / received on:
- Name of consumer(s):
- Address of consumer(s):
- Date:

(*) Delete as applicable.

Last updated: April 2026`

LEGAL.widerruf_ar = `# سياسة الإرجاع والانسحاب

## حق الانسحاب

يحق لك الانسحاب من هذا العقد خلال أربعة عشر يوماً دون إبداء أي سبب.

تبدأ مهلة الانسحاب بعد أربعة عشر يوماً من اليوم الذي استلمت فيه أنت أو طرف ثالث تحدده (غير شركة الشحن) البضاعة.

لممارسة حق الانسحاب، يجب عليك إبلاغنا:

Malak Bekleidung
المالك: محمد البراقي
Pannierstr. 4, 12047 Berlin, ألمانيا
البريد الإلكتروني: info@malak-bekleidung.com
الهاتف: +49 157 78413511

بإعلان واضح (مثل رسالة بريدية أو بريد إلكتروني) عن قرارك بالانسحاب من هذا العقد. يمكنك استخدام نموذج الانسحاب المرفق، ولكن هذا ليس إلزامياً.

للالتزام بمهلة الانسحاب، يكفي أن ترسل الإشعار بممارسة حق الانسحاب قبل انتهاء المهلة.

## نتائج الانسحاب

في حال انسحابك من هذا العقد، سنقوم برد جميع المبالغ التي استلمناها منك، بما في ذلك تكاليف التوصيل (باستثناء التكاليف الإضافية الناتجة عن اختيارك لطريقة توصيل غير الطريقة القياسية الأقل تكلفة)، فوراً وفي موعد أقصاه أربعة عشر يوماً من تاريخ استلامنا لإشعار الانسحاب.

سنستخدم نفس وسيلة الدفع التي استخدمتها في المعاملة الأصلية. لن يتم تحميلك أي رسوم مقابل هذا الاسترداد.

يجب عليك إعادة البضاعة فوراً وفي موعد أقصاه أربعة عشر يوماً من إبلاغنا بالانسحاب.

**يتحمل العميل التكاليف المباشرة لإعادة البضاعة.**

## استثناءات حق الانسحاب

لا ينطبق حق الانسحاب على:

- المنتجات المصنوعة حسب الطلب أو المخصصة لاحتياجات العميل الشخصية.
- المنتجات المختومة التي لا يمكن إرجاعها لأسباب صحية إذا تم فتح ختمها بعد التسليم (مثل الملابس الداخلية المختومة).

## نموذج الانسحاب

إلى:
Malak Bekleidung، المالك: محمد البراقي
Pannierstr. 4, 12047 Berlin, ألمانيا
البريد الإلكتروني: info@malak-bekleidung.com

أنا/نحن (*) نعلن بموجبه الانسحاب من العقد المبرم لشراء البضائع التالية:

- تاريخ الطلب / الاستلام:
- اسم المستهلك:
- عنوان المستهلك:
- التاريخ:

(*) يُشطب ما لا ينطبق.

آخر تحديث: أبريل 2026`

// ═══════════════════════════════════════════════════════════
// DATENSCHUTZ
// ═══════════════════════════════════════════════════════════

LEGAL.datenschutz_de = `# Datenschutzerklärung

## 1. Verantwortlicher

Malak Bekleidung
Inhaber: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Deutschland
E-Mail: info@malak-bekleidung.com
Telefon: +49 157 78413511

## 2. Erhebung und Speicherung personenbezogener Daten

Beim Besuch unserer Website werden automatisch folgende Daten durch den Webserver erfasst: IP-Adresse, Datum und Uhrzeit der Anfrage, aufgerufene Seite, Browsertyp und -version, Betriebssystem. Diese Daten werden zur Sicherstellung eines reibungslosen Betriebs erhoben und nach 30 Tagen gelöscht. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO.

## 3. Bestellungen und Kundenkonto

Zur Vertragsabwicklung erheben wir: Name, Adresse, E-Mail, Telefonnummer, Zahlungsdaten, Bestellhistorie. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO (Vertragserfüllung). Wir speichern Bestelldaten 10 Jahre gemäß § 147 AO und § 257 HGB.

## 4. Zahlungsdienstleister

Wir nutzen folgende Zahlungsdienstleister, an die Daten zur Zahlungsabwicklung übermittelt werden:

- **Stripe** (Stripe Payments Europe, Ltd., Dublin, Irland) — Kreditkartenzahlung. Datenschutz: https://stripe.com/de/privacy
- **PayPal** (PayPal (Europe) S.à r.l. et Cie, Luxemburg) — Datenschutz: https://www.paypal.com/de/webapps/mpp/ua/privacy-full
- **Klarna** (Klarna Bank AB, Stockholm, Schweden) — Datenschutz: https://www.klarna.com/de/datenschutz/
- **SumUp** (SumUp Limited, Dublin, Irland) — Datenschutz: https://www.sumup.com/de-de/datenschutzbestimmungen/

## 5. Versanddienstleister

Wir nutzen **DHL** (Deutsche Post DHL Group) für den Versand. Zur Abwicklung übermitteln wir Name, Adresse und ggf. Telefonnummer/E-Mail an DHL. Datenschutz: https://www.dhl.de/de/toolbar/footer/datenschutz.html

## 6. E-Mail-Versand

Für den Versand von Bestätigungs-, Status- und Service-E-Mails nutzen wir **Resend** (Resend Inc., San Francisco, USA). E-Mail-Adressen werden ausschließlich für den Versand transaktionaler E-Mails verwendet. Die Datenübermittlung in die USA erfolgt auf Basis der EU-Standardvertragsklauseln.

## 7. Hosting und Datenspeicherung

- **Supabase** (Supabase Inc., San Francisco, USA) — Datenbank-Hosting. Server-Standort: Frankfurt (EU). Datenschutz: https://supabase.com/privacy
- **Cloudflare R2** (Cloudflare Inc., San Francisco, USA) — Bildspeicherung. Datenschutz: https://www.cloudflare.com/de-de/privacypolicy/
- **Vercel** (Vercel Inc., San Francisco, USA) — Website-Hosting. Datenschutz: https://vercel.com/legal/privacy-policy

## 8. Analyse und Tracking

Wir nutzen **PostHog** (PostHog Inc.) für die Webanalyse, ausschließlich mit deiner ausdrücklichen Einwilligung (Art. 6 Abs. 1 lit. a DSGVO). PostHog-Server stehen in der EU (Frankfurt). Es werden keine Daten an Dritte weitergegeben. Du kannst deine Einwilligung jederzeit über die Cookie-Einstellungen widerrufen.

## 9. Cookies

Wir verwenden:

- **Technisch notwendige Cookies** (Warenkorb, Sprachauswahl, Authentifizierung) — Rechtsgrundlage: Art. 6 Abs. 1 lit. f DSGVO
- **Analyse-Cookies** (PostHog) — nur mit Einwilligung, Art. 6 Abs. 1 lit. a DSGVO

Du kannst deine Cookie-Einstellungen jederzeit über den „Cookie-Einstellungen"-Link im Footer ändern.

## 10. Deine Rechte

Du hast gegenüber uns folgende Rechte bezüglich deiner personenbezogenen Daten:

- **Auskunft** (Art. 15 DSGVO) — Welche Daten wir über dich gespeichert haben
- **Berichtigung** (Art. 16 DSGVO) — Korrektur unrichtiger Daten
- **Löschung** (Art. 17 DSGVO) — Löschung deiner Daten (Recht auf Vergessenwerden)
- **Einschränkung** (Art. 18 DSGVO) — Einschränkung der Verarbeitung
- **Datenübertragbarkeit** (Art. 20 DSGVO) — Export deiner Daten
- **Widerspruch** (Art. 21 DSGVO) — Widerspruch gegen die Verarbeitung

Du kannst dein Konto und alle personenbezogenen Daten jederzeit in deinen Kontoeinstellungen löschen. Zur Ausübung deiner Rechte wende dich an: info@malak-bekleidung.com

## 11. Beschwerderecht

Du hast das Recht, dich bei einer Datenschutz-Aufsichtsbehörde zu beschweren. Zuständig für uns ist:

Berliner Beauftragte für Datenschutz und Informationsfreiheit
Alt-Moabit 59-61, 10555 Berlin
https://www.datenschutz-berlin.de

## 12. SSL-Verschlüsselung

Diese Website nutzt aus Sicherheitsgründen und zum Schutz der Übertragung personenbezogener Daten eine SSL-Verschlüsselung. Du erkennst eine verschlüsselte Verbindung am Schloss-Symbol in der Adresszeile deines Browsers.

Stand: April 2026`

LEGAL.datenschutz_en = `# Privacy Policy

## 1. Data Controller

Malak Bekleidung
Owner: Mohammad Albraqi
Pannierstr. 4, 12047 Berlin, Germany
Email: info@malak-bekleidung.com
Phone: +49 157 78413511

## 2. Collection and Storage of Personal Data

When you visit our website, the web server automatically collects: IP address, date and time of request, page accessed, browser type and version, operating system. This data is collected to ensure smooth operation and is deleted after 30 days. Legal basis: Art. 6(1)(f) GDPR.

## 3. Orders and Customer Account

For contract processing, we collect: name, address, email, phone number, payment data, order history. Legal basis: Art. 6(1)(b) GDPR (contract fulfillment). We store order data for 10 years in accordance with German tax law.

## 4. Payment Service Providers

We use the following payment providers to whom data is transmitted for payment processing:

- **Stripe** (Stripe Payments Europe, Ltd., Dublin, Ireland) — Credit card payments. Privacy: https://stripe.com/privacy
- **PayPal** (PayPal (Europe) S.à r.l. et Cie, Luxembourg) — Privacy: https://www.paypal.com/webapps/mpp/ua/privacy-full
- **Klarna** (Klarna Bank AB, Stockholm, Sweden) — Privacy: https://www.klarna.com/international/privacy-policy/
- **SumUp** (SumUp Limited, Dublin, Ireland) — Privacy: https://www.sumup.com/privacy/

## 5. Shipping Provider

We use **DHL** (Deutsche Post DHL Group) for shipping. We transmit name, address, and if applicable, phone/email to DHL for delivery.

## 6. Email Service

For sending confirmation, status, and service emails, we use **Resend** (Resend Inc., San Francisco, USA). Data transfer to the US is based on EU Standard Contractual Clauses.

## 7. Hosting and Data Storage

- **Supabase** — Database hosting. Server location: Frankfurt (EU)
- **Cloudflare R2** — Image storage
- **Vercel** — Website hosting

## 8. Analytics and Tracking

We use **PostHog** for web analytics, exclusively with your explicit consent (Art. 6(1)(a) GDPR). PostHog servers are located in the EU (Frankfurt). No data is shared with third parties. You can revoke your consent at any time via the cookie settings.

## 9. Cookies

We use:

- **Strictly necessary cookies** (cart, language, authentication) — Legal basis: Art. 6(1)(f) GDPR
- **Analytics cookies** (PostHog) — only with consent, Art. 6(1)(a) GDPR

You can change your cookie settings at any time via the "Cookie Settings" link in the footer.

## 10. Your Rights

You have the following rights regarding your personal data:

- **Access** (Art. 15 GDPR)
- **Rectification** (Art. 16 GDPR)
- **Erasure** (Art. 17 GDPR) — Right to be forgotten
- **Restriction of processing** (Art. 18 GDPR)
- **Data portability** (Art. 20 GDPR)
- **Objection** (Art. 21 GDPR)

You can delete your account and all personal data at any time in your account settings. To exercise your rights, contact: info@malak-bekleidung.com

## 11. Right to Complain

You have the right to lodge a complaint with a data protection supervisory authority.

## 12. SSL Encryption

This website uses SSL encryption for security purposes and to protect the transmission of personal data.

Last updated: April 2026`

LEGAL.datenschutz_ar = `# سياسة الخصوصية

## 1. المسؤول عن البيانات

Malak Bekleidung
المالك: محمد البراقي
Pannierstr. 4, 12047 Berlin, ألمانيا
البريد الإلكتروني: info@malak-bekleidung.com
الهاتف: +49 157 78413511

## 2. جمع وتخزين البيانات الشخصية

عند زيارة موقعنا، يقوم خادم الويب تلقائياً بجمع: عنوان IP، تاريخ ووقت الطلب، الصفحة المطلوبة، نوع المتصفح ونظام التشغيل. تُجمع هذه البيانات لضمان التشغيل السلس وتُحذف بعد 30 يوماً. الأساس القانوني: المادة 6(1)(و) من اللائحة العامة لحماية البيانات.

## 3. الطلبات وحساب العميل

لتنفيذ العقد نجمع: الاسم، العنوان، البريد الإلكتروني، رقم الهاتف، بيانات الدفع، سجل الطلبات. الأساس القانوني: المادة 6(1)(ب) من اللائحة العامة لحماية البيانات. نحتفظ ببيانات الطلبات لمدة 10 سنوات وفقاً لقانون الضرائب الألماني.

## 4. مزودو خدمات الدفع

نستخدم مزودي الدفع التاليين:

- **Stripe** — مدفوعات البطاقات الائتمانية
- **PayPal** — مدفوعات PayPal
- **Klarna** — خدمات Klarna
- **SumUp** — مدفوعات البطاقات

## 5. مزود خدمة الشحن

نستخدم **DHL** للشحن. نرسل الاسم والعنوان إلى DHL لتنفيذ التوصيل.

## 6. خدمة البريد الإلكتروني

نستخدم **Resend** لإرسال رسائل التأكيد والحالة. يتم نقل البيانات إلى الولايات المتحدة بناءً على البنود التعاقدية القياسية للاتحاد الأوروبي.

## 7. الاستضافة وتخزين البيانات

- **Supabase** — استضافة قاعدة البيانات. موقع الخادم: فرانكفورت (الاتحاد الأوروبي)
- **Cloudflare R2** — تخزين الصور
- **Vercel** — استضافة الموقع

## 8. التحليلات والتتبع

نستخدم **PostHog** لتحليل الويب، حصرياً بموافقتك الصريحة. تقع خوادم PostHog في الاتحاد الأوروبي (فرانكفورت). لا تتم مشاركة أي بيانات مع أطراف ثالثة. يمكنك سحب موافقتك في أي وقت عبر إعدادات الكوكيز.

## 9. ملفات تعريف الارتباط (الكوكيز)

نستخدم:

- **كوكيز ضرورية تقنياً** (سلة التسوق، اللغة، المصادقة)
- **كوكيز التحليل** (PostHog) — فقط بموافقتك

يمكنك تغيير إعدادات الكوكيز في أي وقت عبر رابط "إعدادات الكوكيز" في أسفل الصفحة.

## 10. حقوقك

لديك الحقوق التالية فيما يتعلق ببياناتك الشخصية:

- **الاطلاع** (المادة 15) — معرفة البيانات المخزنة عنك
- **التصحيح** (المادة 16) — تصحيح البيانات غير الصحيحة
- **الحذف** (المادة 17) — حق النسيان
- **تقييد المعالجة** (المادة 18)
- **نقل البيانات** (المادة 20)
- **الاعتراض** (المادة 21)

يمكنك حذف حسابك وجميع بياناتك الشخصية في أي وقت من إعدادات حسابك.
للتواصل: info@malak-bekleidung.com

## 11. حق الشكوى

يحق لك تقديم شكوى لدى هيئة حماية البيانات المختصة.

## 12. تشفير SSL

يستخدم هذا الموقع تشفير SSL لحماية نقل البيانات الشخصية.

آخر تحديث: أبريل 2026`

// ═══════════════════════════════════════════════════════════
// INSTALL
// ═══════════════════════════════════════════════════════════

async function main() {
  console.log('Installing legal content into shop_settings...\n')

  for (const [key, value] of Object.entries(LEGAL)) {
    await prisma.shopSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    })
    console.log(`  ✅ ${key} (${value.length} chars)`)
  }

  console.log(`\n✅ Done. ${Object.keys(LEGAL).length} keys written.`)
  await prisma.$disconnect()
}

main().catch((e) => { console.error(e); process.exit(1) })
