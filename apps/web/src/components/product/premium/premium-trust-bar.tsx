import { Truck, RotateCcw, ShieldCheck, Lock } from 'lucide-react'

interface PremiumTrustBarProps {
  locale: string
}

export function PremiumTrustBar({ locale }: PremiumTrustBarProps) {
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const items = [
    { icon: Truck, text: t3('Kostenloser Versand ab €100', 'Free shipping over €100', 'شحن مجاني فوق 100€') },
    { icon: RotateCcw, text: t3('14 Tage Rückgaberecht', '14-day returns', '14 يوم للإرجاع') },
    { icon: ShieldCheck, text: t3('Sichere Zahlung', 'Secure payment', 'دفع آمن') },
    { icon: Lock, text: t3('DSGVO-konform', 'GDPR compliant', 'متوافق مع حماية البيانات') },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-6 gap-x-8 py-14">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-3">
          <item.icon className="h-[18px] w-[18px] text-[#d4a853] flex-shrink-0" strokeWidth={1.5} />
          <span className={`text-[#0f1419]/40 leading-snug ${locale === 'ar' ? 'text-[13px]' : 'text-[12px] tracking-[0.04em]'}`}>{item.text}</span>
        </div>
      ))}
    </div>
  )
}
