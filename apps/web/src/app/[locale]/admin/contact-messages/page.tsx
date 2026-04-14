'use client'

/**
 * Admin — Contact Messages inbox (premium redesign).
 *
 * Features:
 *   - Two-pane layout: filterable list + detail view
 *   - Status filter chips with live counts
 *   - Individual delete + bulk delete + one-click spam/old cleanup
 *   - Auto mark-as-read on open
 *   - Relative time ("vor 3h") instead of timestamps
 *   - Time-bucket grouping ("Heute" / "Diese Woche" / "Älter")
 */

import { useState, useMemo } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { useConfirm } from '@/components/ui/confirm-modal'
import {
  Mail, CheckCheck, Flag, Loader2, ExternalLink, RefreshCw, Trash2,
  Inbox, Sparkles, Search, X,
} from 'lucide-react'

type ContactMessage = {
  id: string
  name: string
  email: string
  subject: string
  message: string
  locale: string
  status: 'new' | 'read' | 'replied' | 'spam'
  createdAt: string
  readAt: string | null
}

const STATUS_STYLES: Record<string, { bg: string; text: string; ring: string; dot: string; label: Record<string, string> }> = {
  new: {
    bg: 'bg-amber-500/15',
    text: 'text-amber-300',
    ring: 'ring-amber-500/30',
    dot: 'bg-amber-400',
    label: { de: 'Neu', en: 'New', ar: 'جديد' },
  },
  read: {
    bg: 'bg-white/5',
    text: 'text-white/60',
    ring: 'ring-white/10',
    dot: 'bg-white/30',
    label: { de: 'Gelesen', en: 'Read', ar: 'مقروء' },
  },
  replied: {
    bg: 'bg-emerald-500/15',
    text: 'text-emerald-300',
    ring: 'ring-emerald-500/30',
    dot: 'bg-emerald-400',
    label: { de: 'Beantwortet', en: 'Replied', ar: 'تم الرد' },
  },
  spam: {
    bg: 'bg-red-500/15',
    text: 'text-red-300',
    ring: 'ring-red-500/30',
    dot: 'bg-red-400',
    label: { de: 'Spam', en: 'Spam', ar: 'سبام' },
  },
}

const L = {
  de: {
    title: 'Kontakt-Nachrichten',
    subtitle: 'Eingehende Anfragen vom Kontaktformular',
    filterAll: 'Alle',
    filterNew: 'Neu',
    filterRead: 'Gelesen',
    filterReplied: 'Beantwortet',
    filterSpam: 'Spam',
    empty: 'Keine Nachrichten',
    emptyHint: 'Neue Anfragen vom Kontaktformular erscheinen hier',
    selectOne: 'Nachricht auswählen',
    selectHint: 'Wähle eine Nachricht links, um sie zu lesen',
    reply: 'Per E-Mail antworten',
    markReplied: 'Beantwortet',
    markSpam: 'Spam',
    deleteOne: 'Löschen',
    deleteConfirm: 'Diese Nachricht endgültig löschen?',
    cleanup: 'Aufräumen',
    cleanupConfirm: 'Spam + Gelesene älter als 30 Tage endgültig löschen?',
    cleanupDone: 'Nachrichten gelöscht',
    bulkDelete: 'Ausgewählte löschen',
    bulkConfirm: (n: number) => `${n} Nachrichten endgültig löschen?`,
    selected: (n: number) => `${n} ausgewählt`,
    refresh: 'Aktualisieren',
    timeJust: 'gerade eben',
    timeMinutes: (n: number) => `vor ${n} Min`,
    timeHours: (n: number) => `vor ${n} Std`,
    timeDays: (n: number) => `vor ${n} Tag${n === 1 ? '' : 'en'}`,
    bucketToday: 'Heute',
    bucketWeek: 'Diese Woche',
    bucketOlder: 'Älter',
  },
  en: {
    title: 'Contact Messages',
    subtitle: 'Inbound requests from the contact form',
    filterAll: 'All',
    filterNew: 'New',
    filterRead: 'Read',
    filterReplied: 'Replied',
    filterSpam: 'Spam',
    empty: 'No messages',
    emptyHint: 'New requests from the contact form appear here',
    selectOne: 'Select a message',
    selectHint: 'Choose a message on the left to read it',
    reply: 'Reply via email',
    markReplied: 'Mark replied',
    markSpam: 'Mark spam',
    deleteOne: 'Delete',
    deleteConfirm: 'Permanently delete this message?',
    cleanup: 'Cleanup',
    cleanupConfirm: 'Permanently delete spam + read/replied older than 30 days?',
    cleanupDone: 'messages deleted',
    bulkDelete: 'Delete selected',
    bulkConfirm: (n: number) => `Permanently delete ${n} messages?`,
    selected: (n: number) => `${n} selected`,
    refresh: 'Refresh',
    timeJust: 'just now',
    timeMinutes: (n: number) => `${n}m ago`,
    timeHours: (n: number) => `${n}h ago`,
    timeDays: (n: number) => `${n}d ago`,
    bucketToday: 'Today',
    bucketWeek: 'This week',
    bucketOlder: 'Older',
  },
  ar: {
    title: 'رسائل التواصل',
    subtitle: 'الطلبات الواردة من نموذج التواصل',
    filterAll: 'الكل',
    filterNew: 'جديد',
    filterRead: 'مقروء',
    filterReplied: 'تم الرد',
    filterSpam: 'سبام',
    empty: 'لا توجد رسائل',
    emptyHint: 'تظهر الطلبات الجديدة من نموذج التواصل هنا',
    selectOne: 'اختر رسالة',
    selectHint: 'اختر رسالة من اليسار لقراءتها',
    reply: 'الرد عبر البريد',
    markReplied: 'تم الرد',
    markSpam: 'سبام',
    deleteOne: 'حذف',
    deleteConfirm: 'حذف هذه الرسالة نهائياً؟',
    cleanup: 'تنظيف',
    cleanupConfirm: 'حذف السبام والمقروءة الأقدم من 30 يوماً نهائياً؟',
    cleanupDone: 'تم حذف الرسائل',
    bulkDelete: 'حذف المحدد',
    bulkConfirm: (n: number) => `حذف ${n} رسائل نهائياً؟`,
    selected: (n: number) => `تم تحديد ${n}`,
    refresh: 'تحديث',
    timeJust: 'الآن',
    timeMinutes: (n: number) => `قبل ${n} د`,
    timeHours: (n: number) => `قبل ${n} س`,
    timeDays: (n: number) => `قبل ${n} يوم`,
    bucketToday: 'اليوم',
    bucketWeek: 'هذا الأسبوع',
    bucketOlder: 'أقدم',
  },
}

function formatRelativeTime(iso: string, locale: 'de' | 'en' | 'ar'): string {
  const t = L[locale]
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return t.timeJust
  if (mins < 60) return t.timeMinutes(mins)
  const hours = Math.floor(mins / 60)
  if (hours < 24) return t.timeHours(hours)
  const days = Math.floor(hours / 24)
  return t.timeDays(days)
}

function getBucket(iso: string): 'today' | 'week' | 'older' {
  const ageH = (Date.now() - new Date(iso).getTime()) / 3600000
  if (ageH < 24) return 'today'
  if (ageH < 7 * 24) return 'week'
  return 'older'
}

// Deterministic avatar color so the same email always has the same hue.
function avatarColor(email: string): string {
  const hash = email.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)
  const colors = [
    'from-amber-500 to-orange-600',
    'from-emerald-500 to-teal-600',
    'from-blue-500 to-indigo-600',
    'from-fuchsia-500 to-pink-600',
    'from-rose-500 to-red-600',
    'from-violet-500 to-purple-600',
  ]
  return colors[hash % colors.length]
}

export default function ContactMessagesPage() {
  const locale = (useLocale() as 'de' | 'en' | 'ar') || 'de'
  const qc = useQueryClient()
  const confirmDialog = useConfirm()
  const t = L[locale] ?? L.de
  const [filter, setFilter] = useState<string>('')
  const [selected, setSelected] = useState<ContactMessage | null>(null)
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['admin-contact-messages', filter],
    queryFn: async () => {
      const { data } = await api.get('/contact/admin', {
        params: filter ? { status: filter } : {},
      })
      return data as { data: ContactMessage[]; meta: { total: number; unread: number } }
    },
    refetchInterval: 60000,
  })

  // Status counters for the filter chips — fetched once per filter change via the list endpoint
  const { data: allCounts } = useQuery({
    queryKey: ['admin-contact-counts'],
    queryFn: async () => {
      const { data } = await api.get('/contact/admin', { params: { limit: 500 } })
      const list = (data?.data ?? []) as ContactMessage[]
      return {
        all: list.length,
        new: list.filter((m) => m.status === 'new').length,
        read: list.filter((m) => m.status === 'read').length,
        replied: list.filter((m) => m.status === 'replied').length,
        spam: list.filter((m) => m.status === 'spam').length,
      }
    },
    refetchInterval: 60000,
  })

  const updateMut = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await api.patch(`/contact/admin/${id}/status`, { status })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  const deleteOneMut = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/contact/admin/${id}`)
    },
    onSuccess: () => {
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      await api.post('/contact/admin/bulk-delete', { ids })
    },
    onSuccess: () => {
      setCheckedIds(new Set())
      setSelected(null)
      qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  const cleanupMut = useMutation({
    mutationFn: async () => {
      const { data } = await api.post('/contact/admin/cleanup', { olderThanDays: 30 })
      return data as { data?: { deleted: number }; deleted?: number }
    },
    onSuccess: async (data: any) => {
      const count = data?.data?.deleted ?? data?.deleted ?? 0
      // Inform via a lightweight confirm (single OK button, not blocking)
      await confirmDialog({
        title: t.cleanup,
        description: `${count} ${t.cleanupDone}`,
        variant: 'default',
        confirmLabel: 'OK',
        cancelLabel: '',
      })
      qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    },
  })

  const openMessage = async (m: ContactMessage) => {
    setSelected(m)
    if (m.status === 'new') {
      await api.patch(`/contact/admin/${m.id}/read`, {}).catch(() => {})
      qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
      qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
      qc.invalidateQueries({ queryKey: ['admin-notifications'] })
    }
  }

  const toggleCheck = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setCheckedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const filteredAndSearched = useMemo(() => {
    const list = data?.data ?? []
    if (!search.trim()) return list
    const q = search.toLowerCase()
    return list.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.email.toLowerCase().includes(q) ||
        m.subject.toLowerCase().includes(q) ||
        m.message.toLowerCase().includes(q),
    )
  }, [data, search])

  // Group messages into time buckets for the list view
  const grouped = useMemo(() => {
    const groups: Record<string, ContactMessage[]> = { today: [], week: [], older: [] }
    for (const m of filteredAndSearched) {
      groups[getBucket(m.createdAt)].push(m)
    }
    return groups
  }, [filteredAndSearched])

  const counts = allCounts ?? { all: 0, new: 0, read: 0, replied: 0, spam: 0 }
  const hasSelection = checkedIds.size > 0

  return (
    <div className="p-6 max-w-[1440px] mx-auto">
      {/* ── Header ── */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{t.title}</h1>
          <p className="text-sm text-white/50">{t.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          {hasSelection ? (
            <button
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t.bulkDelete,
                  description: t.bulkConfirm(checkedIds.size),
                  variant: 'destructive',
                  confirmLabel: t.deleteOne,
                })
                if (ok) bulkDeleteMut.mutate(Array.from(checkedIds))
              }}
              disabled={bulkDeleteMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/15 text-red-300 text-sm font-semibold border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              {t.bulkDelete} ({checkedIds.size})
            </button>
          ) : (
            <button
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t.cleanup,
                  description: t.cleanupConfirm,
                  variant: 'danger',
                  confirmLabel: t.cleanup,
                })
                if (ok) cleanupMut.mutate()
              }}
              disabled={cleanupMut.isPending}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 text-white/70 text-sm font-semibold border border-white/10 hover:bg-white/10 transition-colors disabled:opacity-50"
            >
              {cleanupMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {t.cleanup}
            </button>
          )}
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['admin-contact-messages'] })
              qc.invalidateQueries({ queryKey: ['admin-contact-counts'] })
            }}
            title={t.refresh}
            className="inline-flex items-center justify-center h-10 w-10 rounded-lg bg-white/5 text-white/70 hover:bg-white/10 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Filter chips + search ── */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {[
          { k: '', label: t.filterAll, count: counts.all },
          { k: 'new', label: t.filterNew, count: counts.new },
          { k: 'read', label: t.filterRead, count: counts.read },
          { k: 'replied', label: t.filterReplied, count: counts.replied },
          { k: 'spam', label: t.filterSpam, count: counts.spam },
        ].map((f) => {
          const active = filter === f.k
          return (
            <button
              key={f.k || 'all'}
              onClick={() => {
                setFilter(f.k)
                setCheckedIds(new Set())
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-all ${
                active
                  ? 'bg-[#d4a853] text-[#1a1a2e] shadow-lg shadow-[#d4a853]/20'
                  : 'bg-white/5 text-white/70 hover:bg-white/10 border border-white/5'
              }`}
            >
              {f.label}
              {f.count > 0 && (
                <span
                  className={`min-w-[20px] px-1.5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center ${
                    active ? 'bg-black/20 text-[#1a1a2e]' : 'bg-white/10 text-white/80'
                  }`}
                >
                  {f.count}
                </span>
              )}
            </button>
          )
        })}

        <div className="relative ltr:ml-auto rtl:mr-auto flex-1 min-w-[200px] max-w-[320px]">
          <Search className="absolute ltr:left-3 rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/40" />
          <input
            type="text"
            placeholder={locale === 'ar' ? 'بحث...' : locale === 'en' ? 'Search...' : 'Suchen...'}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full h-10 ltr:pl-10 ltr:pr-9 rtl:pr-10 rtl:pl-9 rounded-full bg-white/5 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-[#d4a853]/50 focus:bg-white/10 transition-colors"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute ltr:right-3 rtl:left-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── Split layout ── */}
      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-5 min-h-[calc(100vh-280px)]">
        {/* List pane */}
        <div className="bg-[#0f0f1e] rounded-2xl border border-white/5 overflow-hidden flex flex-col max-h-[calc(100vh-240px)]">
          <div className="flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="p-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-[#d4a853] mx-auto" />
              </div>
            ) : filteredAndSearched.length === 0 ? (
              <div className="p-12 text-center">
                <div className="h-16 w-16 mx-auto mb-4 rounded-full bg-white/5 flex items-center justify-center">
                  <Inbox className="h-8 w-8 text-white/20" />
                </div>
                <p className="text-sm text-white/60 font-semibold mb-1">{t.empty}</p>
                <p className="text-xs text-white/30">{t.emptyHint}</p>
              </div>
            ) : (
              (['today', 'week', 'older'] as const).map((bucket) => {
                const items = grouped[bucket]
                if (items.length === 0) return null
                const bucketLabel =
                  bucket === 'today' ? t.bucketToday : bucket === 'week' ? t.bucketWeek : t.bucketOlder
                return (
                  <div key={bucket}>
                    <div className="px-4 py-2 text-[10px] font-bold uppercase tracking-wider text-white/30 bg-black/20 sticky top-0 backdrop-blur-sm">
                      {bucketLabel}
                    </div>
                    {items.map((m) => {
                      const active = selected?.id === m.id
                      const checked = checkedIds.has(m.id)
                      const sty = STATUS_STYLES[m.status] ?? STATUS_STYLES.read
                      return (
                        <div
                          key={m.id}
                          onClick={() => openMessage(m)}
                          className={`group relative cursor-pointer border-b border-white/5 transition-all ${
                            active ? 'bg-[#d4a853]/10 ltr:border-l-2 rtl:border-r-2 border-l-[#d4a853] rtl:border-r-[#d4a853]' : 'hover:bg-white/5'
                          }`}
                        >
                          <div className="flex items-start gap-3 px-4 py-3.5">
                            {/* Checkbox */}
                            <button
                              onClick={(e) => toggleCheck(m.id, e)}
                              className={`mt-0.5 h-5 w-5 rounded flex-shrink-0 border-2 flex items-center justify-center transition-all ${
                                checked
                                  ? 'bg-[#d4a853] border-[#d4a853]'
                                  : 'border-white/20 hover:border-white/40'
                              }`}
                              aria-label="select"
                            >
                              {checked && <CheckCheck className="h-3 w-3 text-[#1a1a2e]" strokeWidth={3} />}
                            </button>

                            {/* Avatar */}
                            <div
                              className={`h-9 w-9 rounded-full bg-gradient-to-br ${avatarColor(m.email)} flex items-center justify-center flex-shrink-0 text-white text-xs font-bold shadow-md`}
                            >
                              {m.name[0]?.toUpperCase() ?? '?'}
                            </div>

                            {/* Content */}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between gap-2 mb-0.5">
                                <p className={`text-sm font-semibold truncate ${m.status === 'new' ? 'text-white' : 'text-white/70'}`}>
                                  {m.name}
                                </p>
                                <span className="text-[10px] text-white/40 flex-shrink-0 tabular-nums">
                                  {formatRelativeTime(m.createdAt, locale)}
                                </span>
                              </div>
                              <p className={`text-xs truncate mb-1.5 ${m.status === 'new' ? 'text-white/80 font-medium' : 'text-white/50'}`}>
                                {m.subject}
                              </p>
                              <div className="flex items-center gap-2">
                                <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${sty.bg} ${sty.text} ${sty.ring}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${sty.dot}`} />
                                  {sty.label[locale]}
                                </span>
                                <span className="text-[9px] text-white/30 uppercase">{m.locale}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div className="bg-[#0f0f1e] rounded-2xl border border-white/5 overflow-hidden flex flex-col max-h-[calc(100vh-240px)]">
          {!selected ? (
            <div className="flex-1 flex items-center justify-center p-12 text-center">
              <div>
                <div className="h-20 w-20 mx-auto mb-5 rounded-2xl bg-white/5 flex items-center justify-center">
                  <Mail className="h-10 w-10 text-white/15" />
                </div>
                <p className="text-base font-semibold text-white/60 mb-1">{t.selectOne}</p>
                <p className="text-sm text-white/30">{t.selectHint}</p>
              </div>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="px-6 py-5 border-b border-white/5">
                <div className="flex items-start justify-between gap-4 mb-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1">
                      {new Date(selected.createdAt).toLocaleString(
                        locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE',
                      )}
                    </p>
                    <h2 className="text-xl font-bold text-white leading-tight break-words">
                      {selected.subject}
                    </h2>
                  </div>
                  <span
                    className={`flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 ${
                      STATUS_STYLES[selected.status].bg
                    } ${STATUS_STYLES[selected.status].text} ${STATUS_STYLES[selected.status].ring}`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${STATUS_STYLES[selected.status].dot}`} />
                    {STATUS_STYLES[selected.status].label[locale]}
                  </span>
                </div>

                {/* Sender */}
                <div className="flex items-center gap-3">
                  <div
                    className={`h-11 w-11 rounded-full bg-gradient-to-br ${avatarColor(selected.email)} flex items-center justify-center text-white text-sm font-bold shadow-md`}
                  >
                    {selected.name[0]?.toUpperCase() ?? '?'}
                  </div>
                  <div className="min-w-0">
                    <p className="text-white font-semibold text-sm truncate">{selected.name}</p>
                    <a
                      href={`mailto:${selected.email}`}
                      className="text-xs text-[#d4a853] hover:underline truncate block"
                      dir="ltr"
                    >
                      {selected.email}
                    </a>
                  </div>
                </div>
              </div>

              {/* Body */}
              <div className="flex-1 overflow-y-auto px-6 py-5">
                <div className="bg-white/[0.03] rounded-xl p-5 border border-white/5">
                  <p className="text-white/90 text-sm leading-relaxed whitespace-pre-wrap break-words">
                    {selected.message}
                  </p>
                </div>
              </div>

              {/* Action bar */}
              <div className="px-6 py-4 border-t border-white/5 bg-black/20 flex items-center gap-2 flex-wrap">
                <a
                  href={`mailto:${selected.email}?subject=Re: ${encodeURIComponent(selected.subject)}`}
                  className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-[#d4a853] text-[#1a1a2e] text-sm font-semibold hover:bg-[#c29945] transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                  {t.reply}
                </a>
                {selected.status !== 'replied' && selected.status !== 'spam' && (
                  <button
                    onClick={() => updateMut.mutate({ id: selected.id, status: 'replied' })}
                    disabled={updateMut.isPending}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-emerald-500/15 text-emerald-300 text-sm font-semibold border border-emerald-500/30 hover:bg-emerald-500/25 transition-colors disabled:opacity-50"
                  >
                    <CheckCheck className="h-4 w-4" />
                    {t.markReplied}
                  </button>
                )}
                {selected.status !== 'spam' && (
                  <button
                    onClick={() => updateMut.mutate({ id: selected.id, status: 'spam' })}
                    disabled={updateMut.isPending}
                    className="inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-orange-500/15 text-orange-300 text-sm font-semibold border border-orange-500/30 hover:bg-orange-500/25 transition-colors disabled:opacity-50"
                  >
                    <Flag className="h-4 w-4" />
                    {t.markSpam}
                  </button>
                )}
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t.deleteOne,
                      description: t.deleteConfirm,
                      variant: 'destructive',
                      confirmLabel: t.deleteOne,
                    })
                    if (ok) deleteOneMut.mutate(selected.id)
                  }}
                  disabled={deleteOneMut.isPending}
                  className="ltr:ml-auto rtl:mr-auto inline-flex items-center gap-2 h-10 px-4 rounded-lg bg-red-500/15 text-red-300 text-sm font-semibold border border-red-500/30 hover:bg-red-500/25 transition-colors disabled:opacity-50"
                >
                  {deleteOneMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  {t.deleteOne}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
