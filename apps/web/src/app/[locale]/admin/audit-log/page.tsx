'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery } from '@tanstack/react-query'
import { ScrollText, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const ACTION_COLORS: Record<string, string> = {
  CREATED: 'bg-green-100 text-green-800',
  UPDATED: 'bg-blue-100 text-blue-800',
  DELETED: 'bg-red-100 text-red-800',
  STATUS: 'bg-purple-100 text-purple-800',
  ACTIVATED: 'bg-green-100 text-green-800',
  DEACTIVATED: 'bg-orange-100 text-orange-800',
  RESET: 'bg-yellow-100 text-yellow-800',
  RECEIVED: 'bg-teal-100 text-teal-800',
  TRANSFERRED: 'bg-indigo-100 text-indigo-800',
}

function getActionColor(action: string) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color
  }
  return 'bg-muted'
}

export default function AuditLogPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const [adminFilter, setAdminFilter] = useState('')
  const [actionFilter, setActionFilter] = useState('')
  const [page, setPage] = useState(1)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['admin-audit-log', adminFilter, actionFilter, page],
    queryFn: async () => {
      const params: Record<string, string> = { page: String(page), limit: '30' }
      if (adminFilter) params.adminId = adminFilter
      if (actionFilter) params.action = actionFilter
      const { data } = await api.get('/admin/audit-log', { params })
      return data
    },
  })

  const { data: admins } = useQuery({
    queryKey: ['admin-audit-admins'],
    queryFn: async () => { const { data } = await api.get('/admin/audit-log/admins'); return data },
  })

  const { data: actionTypes } = useQuery({
    queryKey: ['admin-audit-actions'],
    queryFn: async () => { const { data } = await api.get('/admin/audit-log/actions'); return data },
  })

  const logs = data?.data ?? []
  const meta = data?.meta ?? { total: 0, page: 1, totalPages: 1 }

  const entityLink = (type: string, id: string) => {
    const links: Record<string, string> = {
      order: `/${locale}/admin/orders/${id}`,
      product: `/${locale}/admin/products/${id}`,
      user: `/${locale}/admin/customers/${id}`,
      return: `/${locale}/admin/returns`,
      shipment: `/${locale}/admin/shipments`,
      inventory: `/${locale}/admin/inventory`,
    }
    return links[type]
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('auditLog.title') }]} />
      <h1 className="text-2xl font-bold mb-2 flex items-center gap-2">
        <ScrollText className="h-6 w-6" />
        {t('auditLog.title')}
      </h1>
      <p className="text-sm text-muted-foreground mb-6">{t('auditLog.description')}</p>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <select value={adminFilter} onChange={(e) => { setAdminFilter(e.target.value); setPage(1) }} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[180px]">
          <option value="">{t('auditLog.allAdmins')}</option>
          {(admins ?? []).map((a: any) => (
            <option key={a.id} value={a.id}>{a.firstName} {a.lastName}</option>
          ))}
        </select>
        <select value={actionFilter} onChange={(e) => { setActionFilter(e.target.value); setPage(1) }} className="h-10 px-3 rounded-lg border bg-background text-sm min-w-[180px]">
          <option value="">{t('auditLog.allActions')}</option>
          {(actionTypes ?? []).map((a: string) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.timestamp')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.admin')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.action')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.object')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.changes')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('auditLog.ip')}</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i} className="border-b">{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                ))
              ) : logs.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('auditLog.noEntries')}</td></tr>
              ) : logs.map((log: any) => {
                const link = entityLink(log.entityType, log.entityId)
                const changes = log.changes as any
                const isExpanded = expandedId === log.id
                return (
                  <tr key={log.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString(locale === 'ar' ? 'ar-EG-u-nu-latn' : locale === 'en' ? 'en-GB' : 'de-DE')}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">{log.adminName}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded text-xs font-medium ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {link ? (
                        <a href={link} className="text-primary hover:underline flex items-center gap-1">
                          {log.entityType}:{log.entityId?.slice(0, 8)}
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      ) : (
                        <span>{log.entityType}{log.entityId ? `:${log.entityId.slice(0, 8)}` : ''}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {changes ? (
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : log.id)}
                          className="text-left hover:text-primary transition-colors"
                        >
                          {isExpanded ? (
                            <div className="space-y-1 max-w-[300px]">
                              {changes.before && (
                                <div><span className="text-red-500 font-medium">{t('auditLog.before')}:</span> <code className="text-[11px] bg-red-50 px-1 rounded">{JSON.stringify(changes.before)}</code></div>
                              )}
                              {changes.after && (
                                <div><span className="text-green-600 font-medium">{t('auditLog.after')}:</span> <code className="text-[11px] bg-green-50 px-1 rounded">{JSON.stringify(changes.after)}</code></div>
                              )}
                            </div>
                          ) : (
                            <span className="text-muted-foreground truncate block max-w-[200px]">
                              {JSON.stringify(changes).slice(0, 60)}...
                            </span>
                          )}
                        </button>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground font-mono">{log.ipAddress ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {meta.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-muted-foreground">
            {t('auditLog.page', { page: meta.page, total: meta.totalPages })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
              className="gap-1"
            >
              <ChevronLeft className="h-4 w-4" />{t('auditLog.prev')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= meta.totalPages}
              onClick={() => setPage(page + 1)}
              className="gap-1"
            >
              {t('auditLog.next')}<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
