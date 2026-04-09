'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { Ruler, Save, Loader2, Check } from 'lucide-react'
import { api } from '@/lib/api'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

export function MyMeasurements() {
  const locale = useLocale()
  const [form, setForm] = useState({
    heightCm: '', weightKg: '', bustCm: '', waistCm: '', hipCm: '',
    footLengthCm: '', usualSizeTop: '', usualSizeBottom: '', usualShoeSize: '', bodyType: 'regular',
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get('/sizing/me/measurements').then(({ data }) => {
      if (data) {
        setForm({
          heightCm: data.heightCm ? String(Number(data.heightCm)) : '',
          weightKg: data.weightKg ? String(Number(data.weightKg)) : '',
          bustCm: data.bustCm ? String(Number(data.bustCm)) : '',
          waistCm: data.waistCm ? String(Number(data.waistCm)) : '',
          hipCm: data.hipCm ? String(Number(data.hipCm)) : '',
          footLengthCm: data.footLengthCm ? String(Number(data.footLengthCm)) : '',
          usualSizeTop: data.usualSizeTop ?? '',
          usualSizeBottom: data.usualSizeBottom ?? '',
          usualShoeSize: data.usualShoeSize ?? '',
          bodyType: data.bodyType ?? 'regular',
        })
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const handleSave = async () => {
    setSaving(true)
    try {
      const data: Record<string, any> = {}
      if (form.heightCm) data.heightCm = Number(form.heightCm)
      if (form.weightKg) data.weightKg = Number(form.weightKg)
      if (form.bustCm) data.bustCm = Number(form.bustCm)
      if (form.waistCm) data.waistCm = Number(form.waistCm)
      if (form.hipCm) data.hipCm = Number(form.hipCm)
      if (form.footLengthCm) data.footLengthCm = Number(form.footLengthCm)
      if (form.usualSizeTop) data.usualSizeTop = form.usualSizeTop
      if (form.usualSizeBottom) data.usualSizeBottom = form.usualSizeBottom
      if (form.usualShoeSize) data.usualShoeSize = form.usualShoeSize
      if (form.bodyType) data.bodyType = form.bodyType

      await api.patch('/sizing/me/measurements', data)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ }
    setSaving(false)
  }

  if (loading) return <div className="h-40 animate-shimmer rounded-xl" />

  const Field = ({ label, value, field, unit, type = 'number' }: { label: string; value: string; field: string; unit?: string; type?: string }) => (
    <div>
      <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{label}</label>
      <div className="relative">
        <input
          type={type} value={value}
          onChange={e => setForm({ ...form, [field]: e.target.value })}
          className="w-full h-10 px-3 rounded-xl border bg-background text-sm focus:border-[#d4a853] focus:ring-1 focus:ring-[#d4a853]/20 outline-none transition-colors"
          placeholder="—"
        />
        {unit && <span className="absolute top-1/2 -translate-y-1/2 ltr:right-3 rtl:left-3 text-xs text-muted-foreground">{unit}</span>}
      </div>
    </div>
  )

  return (
    <div className="bg-background border rounded-2xl p-6">
      <h3 className="text-lg font-bold mb-1 flex items-center gap-2">
        <Ruler className="h-5 w-5 text-[#d4a853]" />
        {t3(locale, 'Meine Maße', 'My Measurements', 'مقاساتي')}
      </h3>
      <p className="text-sm text-muted-foreground mb-6">
        {t3(locale,
          'Speichere deine Maße für personalisierte Größenempfehlungen auf jeder Produktseite.',
          'Save your measurements for personalized size recommendations on every product page.',
          'احفظ مقاساتك للحصول على توصيات مقاسات مخصصة في كل صفحة منتج.'
        )}
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <Field label={t3(locale, 'Körpergröße', 'Height', 'الطول')} value={form.heightCm} field="heightCm" unit="cm" />
        <Field label={t3(locale, 'Gewicht', 'Weight', 'الوزن')} value={form.weightKg} field="weightKg" unit="kg" />
        <Field label={t3(locale, 'Brust', 'Bust', 'الصدر')} value={form.bustCm} field="bustCm" unit="cm" />
        <Field label={t3(locale, 'Taille', 'Waist', 'الخصر')} value={form.waistCm} field="waistCm" unit="cm" />
        <Field label={t3(locale, 'Hüfte', 'Hip', 'الورك')} value={form.hipCm} field="hipCm" unit="cm" />
        <Field label={t3(locale, 'Fußlänge', 'Foot Length', 'طول القدم')} value={form.footLengthCm} field="footLengthCm" unit="cm" />
        <Field label={t3(locale, 'Übliche Größe (Oben)', 'Usual Size (Top)', 'المقاس المعتاد (أعلى)')} value={form.usualSizeTop} field="usualSizeTop" type="text" />
        <Field label={t3(locale, 'Übliche Größe (Unten)', 'Usual Size (Bottom)', 'المقاس المعتاد (أسفل)')} value={form.usualSizeBottom} field="usualSizeBottom" type="text" />
        <div>
          <label className="text-sm font-medium text-muted-foreground mb-1.5 block">{t3(locale, 'Körpertyp', 'Body Type', 'نوع الجسم')}</label>
          <select value={form.bodyType} onChange={e => setForm({ ...form, bodyType: e.target.value })} className="w-full h-10 px-3 rounded-xl border bg-background text-sm">
            <option value="slim">{t3(locale, 'Schlank', 'Slim', 'نحيف')}</option>
            <option value="regular">{t3(locale, 'Normal', 'Regular', 'عادي')}</option>
            <option value="athletic">{t3(locale, 'Sportlich', 'Athletic', 'رياضي')}</option>
            <option value="plus">{t3(locale, 'Kräftig', 'Plus', 'ممتلئ')}</option>
          </select>
        </div>
      </div>

      <button
        onClick={handleSave}
        disabled={saving}
        className="mt-6 h-11 px-6 rounded-xl bg-[#d4a853] text-white font-medium hover:bg-[#c49b45] transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
        {saved ? t3(locale, 'Gespeichert!', 'Saved!', 'تم الحفظ!') : t3(locale, 'Speichern', 'Save', 'حفظ')}
      </button>
    </div>
  )
}
