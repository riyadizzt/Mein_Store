'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Loader2,
  Save,
  ShoppingBag,
  RotateCcw,
  Users,
  Package,
  CreditCard,
  HelpCircle,
  ChevronDown,
  Check,
  AlertCircle,
} from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/store/toast-store'
import { t3, t3all, WEBHOOK_EVENT_GROUPS } from './event-catalog'

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  ShoppingBag, RotateCcw, Users, Package, CreditCard,
}

interface FormValues {
  url: string
  description: string
  events: string[]
  isActive: boolean
}

interface WebhookFormProps {
  mode: 'create' | 'edit'
  locale: string
  initial?: Partial<FormValues> & { id?: string }
}

export function WebhookForm({ mode, locale, initial }: WebhookFormProps) {
  const router = useRouter()
  const qc = useQueryClient()

  const [values, setValues] = useState<FormValues>({
    url: initial?.url ?? '',
    description: initial?.description ?? '',
    events: initial?.events ?? [],
    isActive: initial?.isActive ?? true,
  })
  const [openGroup, setOpenGroup] = useState<string | null>(
    WEBHOOK_EVENT_GROUPS[0]?.id ?? null,
  )

  // Re-sync when `initial` changes (edit-mode: data loaded after mount)
  useEffect(() => {
    if (!initial) return
    setValues({
      url: initial.url ?? '',
      description: initial.description ?? '',
      events: initial.events ?? [],
      isActive: initial.isActive ?? true,
    })
  }, [initial?.id, initial?.url, initial?.events?.join(','), initial?.isActive])

  const createMut = useMutation({
    mutationFn: async (body: FormValues) => {
      const { data } = await api.post('/admin/webhooks', body)
      return data
    },
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['admin-webhooks'] })
      toast.success(t3(locale, 'Webhook erstellt', 'تم إنشاء الويب هوك'))
      router.push(`/${locale}/admin/webhooks/${created.id}`)
    },
    onError: (err: any) => {
      const msg = extractMsg(err, locale)
      toast.error(msg || t3(locale, 'Erstellen fehlgeschlagen', 'فشل الإنشاء'))
    },
  })

  const updateMut = useMutation({
    mutationFn: async (body: FormValues) => {
      const { data } = await api.patch(`/admin/webhooks/${initial?.id}`, body)
      return data
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-webhooks'] })
      qc.invalidateQueries({ queryKey: ['admin-webhook', initial?.id] })
      toast.success(t3(locale, 'Änderungen gespeichert', 'تم حفظ التغييرات'))
    },
    onError: (err: any) => {
      const msg = extractMsg(err, locale)
      toast.error(msg || t3(locale, 'Speichern fehlgeschlagen', 'فشل الحفظ'))
    },
  })

  const pending = createMut.isPending || updateMut.isPending

  function toggleEvent(type: string) {
    setValues((v) => ({
      ...v,
      events: v.events.includes(type)
        ? v.events.filter((e) => e !== type)
        : [...v.events, type],
    }))
  }

  function toggleGroupAll(groupId: string) {
    const g = WEBHOOK_EVENT_GROUPS.find((x) => x.id === groupId)
    if (!g) return
    const types = g.events.map((e) => e.type)
    const allSelected = types.every((t) => values.events.includes(t))
    setValues((v) => ({
      ...v,
      events: allSelected
        ? v.events.filter((e) => !types.includes(e))
        : Array.from(new Set([...v.events, ...types])),
    }))
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!values.url.trim()) {
      toast.error(t3(locale, 'URL ist erforderlich', 'الرابط مطلوب'))
      return
    }
    if (values.events.length === 0) {
      toast.error(t3(locale, 'Mindestens ein Ereignis auswählen', 'اختر حدثاً واحداً على الأقل'))
      return
    }
    if (mode === 'create') createMut.mutate(values)
    else updateMut.mutate(values)
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      {/* ── Connection card ─────────────────────────────────── */}
      <section className="rounded-xl border border-border/60 bg-background p-6">
        <h2 className="text-lg font-semibold mb-1">
          {t3(locale, 'Verbindung', 'الاتصال')}
        </h2>
        <p className="text-xs text-muted-foreground mb-5">
          {t3(
            locale,
            'Die URL, an die dein Shop die Benachrichtigungen schickt.',
            'الرابط الذي يرسل متجرك الإشعارات إليه.',
          )}
        </p>

        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {t3(locale, 'Webhook-URL', 'رابط الويب هوك')}
              <span className="text-red-500 ms-1">*</span>
            </label>
            <Input
              type="url"
              dir="ltr"
              placeholder="https://n8n.example.com/webhook/xxx"
              value={values.url}
              onChange={(e) => setValues((v) => ({ ...v, url: e.target.value }))}
              required
            />
            <p className="text-[11px] text-muted-foreground mt-1.5">
              {t3(
                locale,
                'Muss mit https:// (oder http:// in Entwicklung) beginnen.',
                'يجب أن يبدأ بـ https:// (أو http:// في بيئة التطوير).',
              )}
            </p>
          </div>

          <div>
            <label className="text-sm font-medium mb-1.5 block">
              {t3(locale, 'Name / Beschreibung', 'الاسم / الوصف')}
              <span className="text-muted-foreground ms-1 font-normal">
                ({t3(locale, 'optional', 'اختياري')})
              </span>
            </label>
            <Input
              placeholder={t3(
                locale,
                'z.B. "n8n — Instagram Auto-Post"',
                'مثل "n8n — نشر تلقائي إنستجرام"',
              )}
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="button"
              onClick={() => setValues((v) => ({ ...v, isActive: !v.isActive }))}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                values.isActive ? 'bg-[#d4a853]' : 'bg-muted'
              }`}
              aria-pressed={values.isActive}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
                  values.isActive ? 'ltr:left-5 rtl:right-5' : 'ltr:left-0.5 rtl:right-0.5'
                }`}
              />
            </button>
            <div>
              <div className="text-sm font-medium">
                {values.isActive
                  ? t3(locale, 'Aktiv', 'نشط')
                  : t3(locale, 'Pausiert', 'متوقف')}
              </div>
              <div className="text-[11px] text-muted-foreground">
                {values.isActive
                  ? t3(locale, 'Webhook empfängt Ereignisse.', 'يستقبل الويب هوك الأحداث.')
                  : t3(locale, 'Ereignisse werden nicht gesendet.', 'لن تُرسَل الأحداث.')}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Event matrix ─────────────────────────────────────── */}
      <section className="rounded-xl border border-border/60 bg-background p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-lg font-semibold">
              {t3(locale, 'Ereignisse auswählen', 'اختر الأحداث')}
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              {t3(
                locale,
                'Wähle welche Ereignisse an diese URL gesendet werden sollen.',
                'اختر الأحداث التي سيتم إرسالها إلى هذا الرابط.',
              )}
            </p>
          </div>
          <span className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#d4a853]/10 text-[#d4a853] text-xs font-semibold">
            {values.events.length} {t3(locale, 'ausgewählt', 'محدد')}
          </span>
        </div>

        <div className="space-y-3">
          {WEBHOOK_EVENT_GROUPS.map((g) => {
            const Icon = ICON_MAP[g.icon] ?? HelpCircle
            const types = g.events.map((e) => e.type)
            const selected = types.filter((t) => values.events.includes(t)).length
            const allSelected = selected === types.length
            const isOpen = openGroup === g.id
            return (
              <div
                key={g.id}
                className="rounded-lg border border-border/60 overflow-hidden"
              >
                <div className="flex items-center bg-muted/40 hover:bg-muted/60 transition-colors">
                  <button
                    type="button"
                    onClick={() => setOpenGroup(isOpen ? null : g.id)}
                    className="flex-1 flex items-center gap-3 px-4 py-3 text-start"
                  >
                    <div className="h-8 w-8 rounded-lg bg-[#d4a853]/15 flex items-center justify-center shrink-0">
                      <Icon className="h-4 w-4 text-[#d4a853]" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm">{t3all(locale, g.label)}</div>
                      <div className="text-[11px] text-muted-foreground tabular-nums">
                        {selected} / {types.length} {t3(locale, 'ausgewählt', 'محدد')}
                      </div>
                    </div>
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleGroupAll(g.id)}
                    className={`shrink-0 mx-2 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-colors ${
                      allSelected
                        ? 'bg-[#d4a853] text-white hover:bg-[#c49943]'
                        : 'bg-background border border-border hover:border-[#d4a853]/60'
                    }`}
                  >
                    {allSelected
                      ? t3(locale, 'Alle abwählen', 'إلغاء الكل')
                      : t3(locale, 'Alle wählen', 'اختيار الكل')}
                  </button>
                </div>

                {isOpen && (
                  <ul className="divide-y divide-border/40">
                    {g.events.map((ev) => {
                      const checked = values.events.includes(ev.type)
                      return (
                        <li key={ev.type}>
                          <button
                            type="button"
                            onClick={() => toggleEvent(ev.type)}
                            className="w-full px-4 py-3 text-start hover:bg-muted/30 transition-colors flex items-start gap-3"
                          >
                            <span
                              className={`mt-0.5 h-5 w-5 rounded-md flex items-center justify-center shrink-0 border-2 transition-colors ${
                                checked
                                  ? 'bg-[#d4a853] border-[#d4a853]'
                                  : 'bg-background border-border'
                              }`}
                            >
                              {checked && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block font-medium text-sm">
                                {t3all(locale, ev.label)}
                              </span>
                              <span className="block text-xs text-muted-foreground leading-snug mt-0.5">
                                {t3all(locale, ev.desc)}
                              </span>
                              <span
                                dir="ltr"
                                className="inline-block mt-1 text-[10px] font-mono text-muted-foreground/70"
                              >
                                {ev.type}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── Submit bar ───────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 sticky bottom-0 bg-background/95 backdrop-blur-sm border-t border-border/60 -mx-4 px-4 py-3 sm:mx-0 sm:px-0 sm:border-0 sm:py-0 sm:static sm:bg-transparent">
        {values.events.length === 0 ? (
          <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
            <AlertCircle className="h-3.5 w-3.5" />
            {t3(locale, 'Mindestens 1 Ereignis auswählen', 'اختر حدثاً واحداً على الأقل')}
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            {t3(
              locale,
              'Beim Speichern wird automatisch ein geheimer Signatur-Schlüssel generiert.',
              'عند الحفظ سيتم إنشاء مفتاح توقيع سري تلقائياً.',
            )}
          </p>
        )}
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={() => router.back()}
            disabled={pending}
          >
            {t3(locale, 'Abbrechen', 'إلغاء')}
          </Button>
          <Button type="submit" disabled={pending || values.events.length === 0} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {mode === 'create'
              ? t3(locale, 'Webhook erstellen', 'إنشاء الويب هوك')
              : t3(locale, 'Speichern', 'حفظ')}
          </Button>
        </div>
      </div>
    </form>
  )
}

function extractMsg(err: any, locale: string): string | null {
  const raw = err?.response?.data?.message ?? err?.message
  if (!raw) return null
  if (typeof raw === 'string') return raw
  if (typeof raw === 'object') {
    if (locale === 'ar' && raw.ar) return raw.ar
    if (locale === 'en' && raw.en) return raw.en
    return raw.de ?? raw.en ?? raw.ar ?? null
  }
  return null
}
