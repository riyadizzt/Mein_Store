'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Eye, Send, Loader2, X, Mail } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const LANG_FLAGS: Record<string, string> = { de: '🇩🇪', en: '🇬🇧', ar: '🇸🇦' }

export default function AdminEmailsPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const [previewKey, setPreviewKey] = useState<string | null>(null)
  const [previewLang, setPreviewLang] = useState('de')
  const [toast, setToast] = useState<string | null>(null)

  const { data: templates, isLoading } = useQuery({
    queryKey: ['admin-email-templates'],
    queryFn: async () => { const { data } = await api.get('/admin/emails/templates'); return data },
  })

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ['admin-email-preview', previewKey, previewLang],
    queryFn: async () => { const { data } = await api.get(`/admin/emails/preview/${previewKey}`, { params: { lang: previewLang } }); return data },
    enabled: !!previewKey,
  })

  const testMutation = useMutation({
    mutationFn: async (key: string) => { const { data } = await api.post('/admin/emails/test-send', { templateKey: key, lang: previewLang }); return data },
    onSuccess: (data) => {
      if (data.success) {
        setToast(t('emails.testSent', { email: data.sentTo }))
      } else {
        setToast(t('emails.testFailed'))
      }
      setTimeout(() => setToast(null), 4000)
    },
  })

  const getName = (template: any) => {
    if (typeof template.name === 'object') {
      return template.name[locale] ?? template.name.de ?? template.key
    }
    return template.name ?? template.key
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('emails.title') }]} />
      <h1 className="text-2xl font-bold mb-6">{t('emails.title')}</h1>

      {/* Toast */}
      {toast && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-sm text-green-800 flex items-center justify-between">
          {toast}
          <button onClick={() => setToast(null)}><X className="h-4 w-4" /></button>
        </div>
      )}

      {/* Template Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-32 bg-muted rounded-xl animate-pulse" />
          ))
        ) : (templates ?? []).length === 0 ? (
          <div className="col-span-full text-center py-12 text-muted-foreground">{t('emails.noTemplates')}</div>
        ) : (
          (templates ?? []).map((tpl: any) => (
            <div key={tpl.key} className="bg-background border rounded-xl p-5 hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-semibold">{getName(tpl)}</h3>
                </div>
              </div>

              {/* Language Badges */}
              <div className="flex gap-1.5 mb-4">
                {(tpl.languages ?? []).map((lang: string) => (
                  <span key={lang} className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                    lang === 'de' ? 'bg-yellow-100 text-yellow-800' :
                    lang === 'en' ? 'bg-blue-100 text-blue-800' :
                    'bg-green-100 text-green-800'
                  }`}>
                    {LANG_FLAGS[lang]} {lang.toUpperCase()}
                  </span>
                ))}
              </div>

              {/* Actions */}
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 gap-1.5"
                  onClick={() => { setPreviewKey(tpl.key); setPreviewLang('de') }}
                >
                  <Eye className="h-3.5 w-3.5" />{t('emails.preview')}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => testMutation.mutate(tpl.key)}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Preview Modal */}
      {previewKey && (
        <>
          <div className="fixed inset-0 z-50 bg-black/50" onClick={() => setPreviewKey(null)} />
          <div className="fixed inset-4 sm:inset-8 lg:inset-12 z-50 bg-background rounded-xl shadow-2xl flex flex-col overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b bg-muted/30">
              <div className="flex items-center gap-4">
                <h3 className="font-bold text-lg">{t('emails.preview')}</h3>
                {/* Language Tabs */}
                <div className="flex gap-1 bg-muted rounded-lg p-1">
                  {['de', 'en', 'ar'].map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setPreviewLang(lang)}
                      className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                        previewLang === lang ? 'bg-background shadow-sm' : 'hover:bg-background/50'
                      }`}
                    >
                      {LANG_FLAGS[lang]} {lang.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => testMutation.mutate(previewKey)}
                  disabled={testMutation.isPending}
                >
                  {testMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {t('emails.testSend')}
                </Button>
                <button onClick={() => setPreviewKey(null)} className="p-2 hover:bg-muted rounded-lg">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Subject */}
            {preview?.subject && (
              <div className="px-6 py-2 border-b bg-muted/10 text-sm">
                <span className="text-muted-foreground">{t('emails.subject')}:</span>{' '}
                <span className="font-medium">{preview.subject}</span>
              </div>
            )}

            {/* Email HTML Preview */}
            <div className="flex-1 overflow-y-auto">
              {previewLoading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : preview?.html ? (
                <div className="max-w-2xl mx-auto py-8 px-4">
                  <div
                    className="bg-white rounded-lg shadow-sm border"
                    dangerouslySetInnerHTML={{ __html: preview.html }}
                  />
                </div>
              ) : (
                <div className="text-center py-20 text-muted-foreground">
                  {t('emails.noTemplates')}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
