'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Plus, Trash2, Save, Loader2, Ruler, ChevronDown, ChevronRight,
} from 'lucide-react'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

const CHART_TYPES = [
  { value: 'tops', de: 'Oberbekleidung', en: 'Tops', ar: 'ملابس علوية' },
  { value: 'bottoms', de: 'Hosen', en: 'Bottoms', ar: 'بنطلونات' },
  { value: 'dresses', de: 'Kleider', en: 'Dresses', ar: 'فساتين' },
  { value: 'shoes', de: 'Schuhe', en: 'Shoes', ar: 'أحذية' },
  { value: 'kids', de: 'Kinder', en: 'Kids', ar: 'أطفال' },
  { value: 'accessories', de: 'Accessoires', en: 'Accessories', ar: 'إكسسوارات' },
]

const MEASUREMENT_FIELDS: Record<string, string[]> = {
  tops: ['bust', 'waist', 'length', 'shoulder', 'sleeve'],
  bottoms: ['waist', 'hip', 'inseam', 'length'],
  dresses: ['bust', 'waist', 'hip', 'length'],
  shoes: ['footLength', 'euSize'],
  kids: ['bodyHeight', 'bust', 'waist'],
  accessories: [],
}

const FIELD_LABELS: Record<string, Record<string, string>> = {
  bust: { de: 'Brust', en: 'Bust', ar: 'الصدر' },
  waist: { de: 'Taille', en: 'Waist', ar: 'الخصر' },
  hip: { de: 'Hüfte', en: 'Hip', ar: 'الورك' },
  length: { de: 'Länge', en: 'Length', ar: 'الطول' },
  inseam: { de: 'Innenbein', en: 'Inseam', ar: 'طول الساق' },
  shoulder: { de: 'Schulter', en: 'Shoulder', ar: 'الكتف' },
  sleeve: { de: 'Ärmel', en: 'Sleeve', ar: 'الكم' },
  footLength: { de: 'Fußlänge', en: 'Foot Length', ar: 'طول القدم' },
  bodyHeight: { de: 'Körpergröße', en: 'Height', ar: 'الطول' },
  euSize: { de: 'EU-Größe', en: 'EU Size', ar: 'مقاس EU' },
}

export default function AdminSizingPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const [showCreate, setShowCreate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data: charts, isLoading } = useQuery({
    queryKey: ['admin-sizing-charts'],
    queryFn: async () => { const { data } = await api.get('/sizing/charts'); return data },
  })

  const { data: suppliers } = useQuery({
    queryKey: ['admin-suppliers-list'],
    queryFn: async () => { const { data } = await api.get('/admin/suppliers'); return data?.data ?? data ?? [] },
  })

  const { data: categories } = useQuery({
    queryKey: ['admin-categories-list'],
    queryFn: async () => { const { data } = await api.get('/categories'); return data ?? [] },
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/sizing/charts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-sizing-charts'] }),
  })

  const catName = (cat: any) => cat?.translations?.find((t: any) => t.language === locale)?.name ?? cat?.translations?.[0]?.name ?? ''

  return (
    <div className="space-y-6">
      <AdminBreadcrumb items={[{ label: t3(locale, 'Größentabellen', 'Size Charts', 'جداول المقاسات') }]} />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Ruler className="h-6 w-6 text-[#d4a853]" />
            {t3(locale, 'Größentabellen', 'Size Charts', 'جداول المقاسات')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{t3(locale, 'Größentabellen pro Lieferant und Kategorie verwalten', 'Manage size charts per supplier and category', 'إدارة جداول المقاسات حسب المورد والفئة')}</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          {t3(locale, 'Neue Tabelle', 'New Chart', 'جدول جديد')}
        </Button>
      </div>

      {/* Create Form */}
      {showCreate && (
        <CreateChartForm
          locale={locale}
          suppliers={suppliers ?? []}
          categories={categories ?? []}
          onClose={() => setShowCreate(false)}
          onSuccess={() => { setShowCreate(false); qc.invalidateQueries({ queryKey: ['admin-sizing-charts'] }) }}
        />
      )}

      {/* Charts List */}
      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <div key={i} className="h-20 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : (charts ?? []).length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Ruler className="h-12 w-12 mx-auto mb-4 opacity-20" />
          <p>{t3(locale, 'Noch keine Größentabellen erstellt', 'No size charts yet', 'لا توجد جداول مقاسات بعد')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {(charts ?? []).map((chart: any) => (
            <div key={chart.id} className="bg-background border rounded-xl overflow-hidden">
              {/* Header */}
              <button
                onClick={() => setExpandedId(expandedId === chart.id ? null : chart.id)}
                className="w-full flex items-center justify-between px-5 py-4 hover:bg-muted/30 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {expandedId === chart.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <div className="text-start">
                    <p className="font-semibold">{chart.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                      {chart.supplier && <span className="px-2 py-0.5 rounded bg-blue-50 text-blue-700">{chart.supplier.name}</span>}
                      {chart.category && <span className="px-2 py-0.5 rounded bg-green-50 text-green-700">{catName(chart.category)}</span>}
                      <span className="px-2 py-0.5 rounded bg-muted">{CHART_TYPES.find(t => t.value === chart.chartType)?.[locale === 'ar' ? 'ar' : 'de'] ?? chart.chartType}</span>
                      {chart.isDefault && <span className="px-2 py-0.5 rounded bg-[#d4a853]/10 text-[#d4a853]">Standard</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <span>{chart.entries?.length ?? 0} {t3(locale, 'Größen', 'sizes', 'مقاسات')}</span>
                  {chart.fitNote && <span className="px-2 py-0.5 rounded bg-orange-50 text-orange-700 text-xs">{chart.fitNote}</span>}
                </div>
              </button>

              {/* Expanded: Entries Table */}
              {expandedId === chart.id && (
                <div className="border-t px-5 py-4">
                  <ChartEntriesEditor chart={chart} locale={locale} onUpdate={() => qc.invalidateQueries({ queryKey: ['admin-sizing-charts'] })} />
                  <div className="flex justify-end mt-3">
                    <button onClick={() => deleteMut.mutate(chart.id)} className="text-xs text-red-500 hover:text-red-700">
                      <Trash2 className="h-3 w-3 inline mr-1" />{t3(locale, 'Löschen', 'Delete', 'حذف')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── CREATE CHART FORM ─────────────────────────────────────

function CreateChartForm({ locale, suppliers, categories, onClose, onSuccess }: {
  locale: string; suppliers: any[]; categories: any[]; onClose: () => void; onSuccess: () => void
}) {
  const [form, setForm] = useState({ name: '', supplierId: '', categoryId: '', chartType: 'tops', fitNote: '', fitNoteAr: '', isDefault: false })
  const [saving, setSaving] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await api.post('/sizing/charts', { ...form, supplierId: form.supplierId || undefined, categoryId: form.categoryId || undefined })
      onSuccess()
    } catch { setSaving(false) }
  }

  const catName = (cat: any) => cat?.translations?.find((t: any) => t.language === locale)?.name ?? cat?.translations?.[0]?.name ?? cat?.slug ?? ''

  return (
    <form onSubmit={handleSubmit} className="bg-background border rounded-xl p-6 space-y-4">
      <h3 className="font-semibold">{t3(locale, 'Neue Größentabelle', 'New Size Chart', 'جدول مقاسات جديد')}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Name', 'Name', 'الاسم')}</label>
          <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="z.B. Özdemir Textil — Damenkleider" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Typ', 'Type', 'النوع')}</label>
          <select value={form.chartType} onChange={e => setForm({ ...form, chartType: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm">
            {CHART_TYPES.map(t => <option key={t.value} value={t.value}>{locale === 'ar' ? t.ar : t.de}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Lieferant', 'Supplier', 'المورد')}</label>
          <select value={form.supplierId} onChange={e => setForm({ ...form, supplierId: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm">
            <option value="">{t3(locale, 'Kein Lieferant', 'No supplier', 'بدون مورد')}</option>
            {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Kategorie', 'Category', 'الفئة')}</label>
          <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })} className="w-full h-10 px-3 rounded-lg border bg-background text-sm">
            <option value="">{t3(locale, 'Keine Kategorie', 'No category', 'بدون فئة')}</option>
            {categories.map((c: any) => <option key={c.id} value={c.id}>{catName(c)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Passform-Hinweis (DE)', 'Fit Note (DE)', 'ملاحظة المقاس (ألماني)')}</label>
          <Input value={form.fitNote} onChange={e => setForm({ ...form, fitNote: e.target.value })} placeholder="z.B. Fällt klein aus" />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">{t3(locale, 'Passform-Hinweis (AR)', 'Fit Note (AR)', 'ملاحظة المقاس (عربي)')}</label>
          <Input value={form.fitNoteAr} onChange={e => setForm({ ...form, fitNoteAr: e.target.value })} placeholder="مثال: يأتي بمقاس أصغر" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.isDefault} onChange={e => setForm({ ...form, isDefault: e.target.checked })} className="rounded" />
        {t3(locale, 'Standard-Tabelle für diese Kategorie', 'Default chart for this category', 'جدول افتراضي لهذه الفئة')}
      </label>
      <div className="flex gap-2 justify-end">
        <Button variant="ghost" onClick={onClose} type="button">{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</Button>
        <Button type="submit" disabled={saving || !form.name} className="gap-2">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {t3(locale, 'Erstellen', 'Create', 'إنشاء')}
        </Button>
      </div>
    </form>
  )
}

// ── CHART ENTRIES EDITOR ──────────────────────────────────

function ChartEntriesEditor({ chart, locale, onUpdate }: { chart: any; locale: string; onUpdate: () => void }) {
  const fields = MEASUREMENT_FIELDS[chart.chartType] ?? []
  const [entries, setEntries] = useState<any[]>(chart.entries ?? [])
  const [saving, setSaving] = useState(false)

  const addRow = () => {
    setEntries([...entries, { size: '', sortOrder: entries.length, bust: null, waist: null, hip: null, length: null, inseam: null, shoulder: null, sleeve: null, footLength: null, bodyHeight: null, euSize: '' }])
  }

  const updateField = (idx: number, field: string, value: any) => {
    const updated = [...entries]
    updated[idx] = { ...updated[idx], [field]: value === '' ? null : field === 'euSize' || field === 'size' ? value : Number(value) || null }
    setEntries(updated)
  }

  const removeRow = (idx: number) => setEntries(entries.filter((_, i) => i !== idx))

  const save = async () => {
    setSaving(true)
    try {
      await api.post(`/sizing/charts/${chart.id}/entries/bulk`, { entries })
      onUpdate()
    } finally { setSaving(false) }
  }

  const fieldLabel = (f: string) => FIELD_LABELS[f]?.[locale === 'ar' ? 'ar' : 'de'] ?? f

  return (
    <div className="space-y-3">
      {fields.length > 0 && (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            {/* Header */}
            <div className="grid gap-2 text-xs font-semibold text-muted-foreground mb-2" style={{ gridTemplateColumns: `80px repeat(${fields.length}, 1fr) 40px` }}>
              <div>{t3(locale, 'Größe', 'Size', 'المقاس')}</div>
              {fields.map(f => <div key={f} className="text-center">{fieldLabel(f)} (cm)</div>)}
              <div />
            </div>
            {/* Rows */}
            {entries.map((entry, idx) => (
              <div key={idx} className="grid gap-2 mb-1.5" style={{ gridTemplateColumns: `80px repeat(${fields.length}, 1fr) 40px` }}>
                <Input value={entry.size} onChange={e => updateField(idx, 'size', e.target.value)} className="h-8 text-sm font-bold" placeholder="S" />
                {fields.map(f => (
                  <Input key={f} type="number" step="0.1" value={entry[f] ?? ''} onChange={e => updateField(idx, f, e.target.value)} className="h-8 text-sm text-center" placeholder="—" />
                ))}
                <button onClick={() => removeRow(idx)} className="h-8 flex items-center justify-center text-red-400 hover:text-red-600"><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button onClick={addRow} className="text-xs text-[#d4a853] hover:text-[#c49b45] flex items-center gap-1">
          <Plus className="h-3 w-3" />{t3(locale, 'Größe hinzufügen', 'Add size', 'إضافة مقاس')}
        </button>
        <div className="flex-1" />
        <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {t3(locale, 'Speichern', 'Save', 'حفظ')}
        </Button>
      </div>
    </div>
  )
}
