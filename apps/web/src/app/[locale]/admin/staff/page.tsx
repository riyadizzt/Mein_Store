'use client'

import { useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Search, Plus, Loader2, Shield, ShieldCheck, Key, Power, PowerOff, History, X, Copy } from 'lucide-react'
import { api } from '@/lib/api'
import { formatDateTime } from '@/lib/locale-utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

const ROLE_COLORS: Record<string, string> = {
  super_admin: 'bg-purple-100 text-purple-800',
  admin: 'bg-blue-100 text-blue-800',
}

export default function AdminStaffPage() {
  const locale = useLocale()
  const t = useTranslations('admin')
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [showActivity, setShowActivity] = useState<string | null>(null)
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null)

  // Create form
  const [email, setEmail] = useState('')
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [role, setRole] = useState<'admin' | 'super_admin'>('admin')
  const [password, setPassword] = useState('')

  const { data: staff, isLoading } = useQuery({
    queryKey: ['admin-staff', search],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (search) params.search = search
      const { data } = await api.get('/admin/staff', { params })
      return data
    },
  })

  const { data: activity } = useQuery({
    queryKey: ['admin-staff-activity', showActivity],
    queryFn: async () => { const { data } = await api.get(`/admin/staff/${showActivity}/activity`); return data },
    enabled: !!showActivity,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/admin/staff', { email, firstName, lastName, role, password }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      setShowCreate(false); setEmail(''); setFirstName(''); setLastName(''); setPassword('')
    },
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, newRole }: { id: string; newRole: string }) => api.patch(`/admin/staff/${id}/role`, { role: newRole }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-staff'] }),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/staff/${id}/activate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-staff'] }),
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/staff/${id}/deactivate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-staff'] }),
  })

  const resetPwMutation = useMutation({
    mutationFn: async (id: string) => { const { data } = await api.post(`/admin/staff/${id}/reset-password`); return data },
    onSuccess: (data) => {
      setTempPw({ email: data.email, password: data.tempPassword })
    },
  })

  const handleDeactivate = (id: string) => {
    if (confirm(t('staff.deactivateConfirm'))) deactivateMutation.mutate(id)
  }

  const handleResetPw = (id: string) => {
    if (confirm(t('staff.resetConfirm'))) resetPwMutation.mutate(id)
  }

  const handleRoleChange = (id: string, currentRole: string) => {
    const newRole = currentRole === 'admin' ? 'super_admin' : 'admin'
    roleMutation.mutate({ id, newRole })
  }

  return (
    <div>
      <AdminBreadcrumb items={[{ label: t('staff.title') }]} />

      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t('staff.title')}</h1>
        <Button size="sm" className="gap-1.5" onClick={() => setShowCreate(true)}>
          <Plus className="h-3.5 w-3.5" />{t('staff.newStaff')}
        </Button>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowCreate(false)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-md mx-auto bg-background rounded-xl p-6 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{t('staff.newStaff')}</h3>
              <button onClick={() => setShowCreate(false)}><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-muted-foreground">{t('staff.firstName')}</label><Input value={firstName} onChange={(e) => setFirstName(e.target.value)} /></div>
                <div><label className="text-xs text-muted-foreground">{t('staff.lastName')}</label><Input value={lastName} onChange={(e) => setLastName(e.target.value)} /></div>
              </div>
              <div><label className="text-xs text-muted-foreground">{t('staff.email')}</label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div><label className="text-xs text-muted-foreground">{t('staff.password')}</label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min. 8 Zeichen" /></div>
              <div>
                <label className="text-xs text-muted-foreground">{t('staff.role')}</label>
                <select value={role} onChange={(e) => setRole(e.target.value as any)} className="w-full h-9 px-3 rounded-lg border bg-background text-sm">
                  <option value="admin">Admin</option>
                  <option value="super_admin">Super Admin</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <Button variant="outline" onClick={() => setShowCreate(false)} className="flex-1">{t('staff.cancel')}</Button>
                <Button onClick={() => createMutation.mutate()} disabled={!email || !firstName || !password || password.length < 8 || createMutation.isPending} className="flex-1">
                  {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}{t('staff.create')}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Temp Password Modal */}
      {tempPw && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setTempPw(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto bg-background rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-bold mb-2">{t('staff.tempPassword')}</h3>
            <p className="text-sm text-muted-foreground mb-4">{t('staff.tempPasswordHint')}</p>
            <p className="text-xs text-muted-foreground mb-1">{tempPw.email}</p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 bg-muted px-4 py-3 rounded-lg font-mono text-lg font-bold">{tempPw.password}</code>
              <button onClick={() => navigator.clipboard.writeText(tempPw.password)} className="p-2 hover:bg-muted rounded"><Copy className="h-4 w-4" /></button>
            </div>
            <Button className="w-full" onClick={() => setTempPw(null)}>{t('staff.close')}</Button>
          </div>
        </>
      )}

      {/* Activity Modal */}
      {showActivity && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowActivity(null)} />
          <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-lg mx-auto bg-background rounded-xl p-6 shadow-xl max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">{t('staff.activity')}</h3>
              <button onClick={() => setShowActivity(null)}><X className="h-4 w-4" /></button>
            </div>
            {(activity ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t('staff.noActivity')}</p>
            ) : (
              <div className="space-y-2">
                {(activity ?? []).map((a: any) => (
                  <div key={a.id} className="flex items-start gap-3 text-sm border-b pb-2">
                    <div className="flex-1">
                      <p className="font-medium">{a.action}</p>
                      <p className="text-xs text-muted-foreground">{a.entityType} · {a.entityId?.slice(0, 8)}...</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>{formatDateTime(a.createdAt, locale)}</p>
                      <p>{a.ipAddress}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Search */}
      <div className="mb-6">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder={t('staff.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="pl-10" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-background border rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-4 py-3 font-medium">{t('staff.name')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('staff.email')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('staff.role')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('staff.lastLogin')}</th>
                <th className="text-left px-4 py-3 font-medium">{t('staff.status')}</th>
                <th className="text-right px-4 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <tr key={i} className="border-b">{Array.from({ length: 6 }).map((_, j) => <td key={j} className="px-4 py-3"><div className="h-4 bg-muted rounded animate-pulse" /></td>)}</tr>
                ))
              ) : (staff ?? []).length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-muted-foreground">{t('staff.noStaff')}</td></tr>
              ) : (
                (staff ?? []).map((s: any) => (
                  <tr key={s.id} className="border-b hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-3 font-medium">{s.firstName} {s.lastName}</td>
                    <td className="px-4 py-3 text-muted-foreground">{s.email}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[s.role] ?? 'bg-gray-100'}`}>
                        {s.role === 'super_admin' ? 'Super Admin' : 'Admin'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground text-sm">
                      {s.lastLoginAt ? formatDateTime(s.lastLoginAt, locale) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                        s.isBlocked ? 'bg-red-100 text-red-700' : s.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {s.isBlocked ? t('staff.status_blocked') : s.isActive ? t('staff.status_active') : t('staff.status_inactive')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-1">
                        <button onClick={() => handleRoleChange(s.id, s.role)} className="p-1.5 hover:bg-muted rounded" title={t('staff.editRole')}>
                          {s.role === 'super_admin' ? <ShieldCheck className="h-3.5 w-3.5 text-purple-600" /> : <Shield className="h-3.5 w-3.5 text-blue-600" />}
                        </button>
                        <button onClick={() => handleResetPw(s.id)} className="p-1.5 hover:bg-muted rounded" title={t('staff.resetPassword')}>
                          <Key className="h-3.5 w-3.5" />
                        </button>
                        {s.isActive ? (
                          <button onClick={() => handleDeactivate(s.id)} className="p-1.5 hover:bg-muted rounded text-red-500" title={t('staff.deactivate')}>
                            <PowerOff className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button onClick={() => activateMutation.mutate(s.id)} className="p-1.5 hover:bg-muted rounded text-green-600" title={t('staff.activate')}>
                            <Power className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button onClick={() => setShowActivity(s.id)} className="p-1.5 hover:bg-muted rounded" title={t('staff.activity')}>
                          <History className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
