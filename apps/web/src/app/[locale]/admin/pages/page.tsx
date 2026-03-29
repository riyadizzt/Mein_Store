'use client'

import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { FileText, Check, Loader2 } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const PAGES = [
  { key: 'impressum', label: 'Impressum' },
  { key: 'agb', label: 'AGB' },
  { key: 'datenschutz', label: 'Datenschutz' },
  { key: 'widerruf', label: 'Widerrufsbelehrung' },
]

const LANGS = ['de', 'en', 'ar'] as const

export default function AdminPagesPage() {
  useTranslations('admin') // loaded for breadcrumb
  const queryClient = useQueryClient()
  const [activePage, setActivePage] = useState('impressum')
  const [activeLang, setActiveLang] = useState<'de' | 'en' | 'ar'>('de')
  const [content, setContent] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  const { data: settings } = useQuery({
    queryKey: ['shop-settings-public'],
    queryFn: async () => { const { data } = await api.get('/settings/public'); return data },
  })

  useEffect(() => {
    if (!settings?.legal) return
    const all: Record<string, string> = {}
    for (const page of PAGES) {
      for (const lang of LANGS) {
        const val = settings.legal[page.key]?.[lang] ?? ''
        all[`${page.key}_${lang}`] = val
      }
    }
    setContent(all)
  }, [settings])

  const saveMutation = useMutation({
    mutationFn: () => api.patch('/admin/settings', content),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shop-settings-public'] })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    },
  })

  const currentKey = `${activePage}_${activeLang}`

  return (
    <div>
      <AdminBreadcrumb items={[{ label: 'Seiten' }]} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold flex items-center gap-2"><FileText className="h-6 w-6" />Rechtliche Seiten</h1>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="gap-2">
          {saveMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saved ? 'Gespeichert ✓' : 'Alle speichern'}
        </Button>
      </div>

      <div className="flex gap-6">
        {/* Page selector */}
        <div className="w-48 flex-shrink-0 space-y-1">
          {PAGES.map((page) => (
            <button
              key={page.key}
              onClick={() => setActivePage(page.key)}
              className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                activePage === page.key ? 'bg-accent text-accent-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
              }`}
            >
              {page.label}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="flex-1 bg-background border rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{PAGES.find((p) => p.key === activePage)?.label}</h2>
            <div className="flex gap-1">
              {LANGS.map((lang) => (
                <button key={lang} onClick={() => setActiveLang(lang)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${activeLang === lang ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                  {lang.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <textarea
            value={content[currentKey] ?? ''}
            onChange={(e) => setContent((prev) => ({ ...prev, [currentKey]: e.target.value }))}
            className="w-full h-[500px] px-4 py-3 rounded-lg border bg-background text-sm font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/20"
            dir={activeLang === 'ar' ? 'rtl' : 'ltr'}
            placeholder={`${PAGES.find((p) => p.key === activePage)?.label} Inhalt (${activeLang.toUpperCase()})...`}
          />

          <p className="text-xs text-muted-foreground mt-2">
            HTML erlaubt. Änderungen werden sofort im Store sichtbar nach dem Speichern.
          </p>
        </div>
      </div>
    </div>
  )
}
