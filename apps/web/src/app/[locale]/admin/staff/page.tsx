'use client'

import { useState, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Search, Plus, Loader2, X, Copy, ChevronRight,
  Shield, ShieldCheck, ShieldAlert, UserCog, Users, Warehouse, Store, Settings2,
  Power, PowerOff, KeyRound, Clock, Mail, Calendar, User, Check, AlertTriangle, Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useConfirm } from '@/components/ui/confirm-modal'
import { formatDateTime, formatDate } from '@/lib/locale-utils'
import { useAuthStore } from '@/store/auth-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { AdminBreadcrumb } from '@/components/admin/breadcrumb'

// ── Types ────────────────────────────────────────────────────
interface StaffMember {
  id: string
  email: string
  firstName: string
  lastName: string
  role: string
  staffRole: string
  permissions: string[]
  lastLoginAt: string | null
  isActive: boolean
  isBlocked: boolean
  profileImageUrl: string | null
  createdAt: string
  invitedBy: string | null
}

interface PermissionGroup {
  key: string
  label: string
  permissions: { key: string; label: string; description?: string }[]
}

interface PermissionsData {
  groups: PermissionGroup[]
  presets: Record<string, string[]>
}

interface ActivityEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  createdAt: string
  ipAddress: string
}

type StaffRoleValue = 'seller' | 'warehouse' | 'manager' | 'full_access' | 'custom'

// ── Trilingual labels ────────────────────────────────────────
function t3(locale: string, de: string, en: string, ar: string): string {
  return locale === 'ar' ? ar : locale === 'en' ? en : de
}

const ROLE_LABELS: Record<string, { de: string; en: string; ar: string }> = {
  seller:      { de: 'Verkäufer',       en: 'Sales',        ar: 'مبيعات' },
  warehouse:   { de: 'Lagerarbeiter',   en: 'Warehouse',    ar: 'مستودع' },
  manager:     { de: 'Manager',         en: 'Manager',      ar: 'مدير' },
  full_access: { de: 'Vollzugriff',     en: 'Full Access',  ar: 'وصول كامل' },
  custom:      { de: 'Benutzerdefiniert', en: 'Custom',     ar: 'مخصص' },
  super_admin: { de: 'Super-Admin',     en: 'Super Admin',  ar: 'مدير عام' },
}

const ROLE_DESCRIPTIONS: Record<string, { de: string; en: string; ar: string }> = {
  seller: {
    de: 'Kann Bestellungen sehen, Kunden verwalten und Verkäufe abwickeln',
    en: 'Can view orders, manage customers and process sales',
    ar: 'يمكنه عرض الطلبات وإدارة العملاء ومعالجة المبيعات',
  },
  warehouse: {
    de: 'Kann Lagerbestände verwalten, Inventur durchführen und Lieferungen bearbeiten',
    en: 'Can manage inventory, perform stocktakes and process shipments',
    ar: 'يمكنه إدارة المخزون وإجراء الجرد ومعالجة الشحنات',
  },
  manager: {
    de: 'Kann Produkte, Bestellungen, Kunden und Berichte verwalten',
    en: 'Can manage products, orders, customers and reports',
    ar: 'يمكنه إدارة المنتجات والطلبات والعملاء والتقارير',
  },
  full_access: {
    de: 'Hat Zugriff auf alle Funktionen außer Mitarbeiterverwaltung',
    en: 'Has access to all features except staff management',
    ar: 'لديه وصول لجميع الميزات باستثناء إدارة الموظفين',
  },
  custom: {
    de: 'Benutzerdefinierte Berechtigungen für spezielle Anforderungen',
    en: 'Custom permissions for specific requirements',
    ar: 'أذونات مخصصة لمتطلبات محددة',
  },
}

const ROLE_BADGE_COLORS: Record<string, string> = {
  seller:      'bg-blue-100 text-blue-800 border-blue-200',
  warehouse:   'bg-orange-100 text-orange-800 border-orange-200',
  manager:     'bg-purple-100 text-purple-800 border-purple-200',
  full_access: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  custom:      'bg-slate-100 text-slate-800 border-slate-200',
  super_admin: 'bg-amber-100 text-amber-800 border-amber-200',
}

const ROLE_ICONS: Record<string, typeof Store> = {
  seller:      Store,
  warehouse:   Warehouse,
  manager:     UserCog,
  full_access: ShieldCheck,
  custom:      Settings2,
  super_admin: ShieldAlert,
}

const STATUS_BADGE: Record<string, { colors: string; de: string; en: string; ar: string }> = {
  active:   { colors: 'bg-emerald-100 text-emerald-700 border-emerald-200', de: 'Aktiv', en: 'Active', ar: 'نشط' },
  inactive: { colors: 'bg-gray-100 text-gray-600 border-gray-200', de: 'Inaktiv', en: 'Inactive', ar: 'غير نشط' },
  pending:  { colors: 'bg-yellow-100 text-yellow-700 border-yellow-200', de: 'Ausstehend', en: 'Pending', ar: 'معلّق' },
  blocked:  { colors: 'bg-red-100 text-red-700 border-red-200', de: 'Gesperrt', en: 'Blocked', ar: 'محظور' },
}

const ACTION_TRANSLATIONS: Record<string, { de: string; ar: string }> = {
  ADMIN_LOGIN: { de: 'Admin-Anmeldung', ar: 'تسجيل دخول' },
  ADMIN_LOGIN_FAILED: { de: 'Anmeldung fehlgeschlagen', ar: 'فشل تسجيل الدخول' },
  ORDER_CREATED: { de: 'Bestellung erstellt', ar: 'طلب جديد' },
  ORDER_STATUS_CHANGED: { de: 'Bestellstatus geändert', ar: 'تغيير حالة الطلب' },
  ORDER_CANCELLED: { de: 'Bestellung storniert', ar: 'إلغاء الطلب' },
  ORDER_AUTO_CANCELLED: { de: 'Automatisch storniert', ar: 'إلغاء تلقائي' },
  ORDER_FULFILLMENT_CHANGED: { de: 'Lager geändert', ar: 'تغيير المستودع' },
  PRODUCT_CREATED: { de: 'Produkt erstellt', ar: 'منتج جديد' },
  PRODUCT_UPDATED: { de: 'Produkt bearbeitet', ar: 'تعديل المنتج' },
  PRODUCT_DELETED: { de: 'Produkt gelöscht', ar: 'حذف المنتج' },
  PRODUCT_RESTORED: { de: 'Produkt wiederhergestellt', ar: 'استعادة المنتج' },
  PRODUCT_DUPLICATED: { de: 'Produkt dupliziert', ar: 'نسخ المنتج' },
  PRODUCT_PRICE_CHANGED: { de: 'Preis geändert', ar: 'تغيير السعر' },
  PRODUCTS_ACTIVATED: { de: 'Produkte aktiviert', ar: 'تفعيل المنتجات' },
  PRODUCTS_DEACTIVATED: { de: 'Produkte deaktiviert', ar: 'تعطيل المنتجات' },
  PRODUCTS_DELETED: { de: 'Produkte gelöscht', ar: 'حذف المنتجات' },
  INVENTORY_INTAKE: { de: 'Wareneingang', ar: 'استلام بضاعة' },
  INVENTORY_OUTPUT: { de: 'Warenausgang', ar: 'صرف بضاعة' },
  INVENTORY_ADJUSTED: { de: 'Bestand korrigiert', ar: 'تعديل المخزون' },
  INVENTORY_TRANSFER: { de: 'Bestandstransfer', ar: 'نقل المخزون' },
  INVENTORY_TRANSFERRED: { de: 'Bestand transferiert', ar: 'تم نقل المخزون' },
  INVENTORY_BATCH_TRANSFER: { de: 'Sammel-Transfer', ar: 'نقل جماعي' },
  SETTINGS_UPDATED: { de: 'Einstellungen geändert', ar: 'تحديث الإعدادات' },
  RETURN_APPROVED: { de: 'Retoure genehmigt', ar: 'موافقة الإرجاع' },
  RETURN_REJECTED: { de: 'Retoure abgelehnt', ar: 'رفض المرتجع' },
  RETURN_SCANNED: { de: 'Retoure gescannt', ar: 'مسح المرتجع' },
  RETURN_LABEL_UPDATED: { de: 'Label erstellt', ar: 'إنشاء ملصق' },
  RETURN_STATUS_REJECTED: { de: 'Retoure abgelehnt', ar: 'رفض المرتجع' },
  RETURN_STATUS_APPROVED: { de: 'Retoure genehmigt', ar: 'موافقة الإرجاع' },
  RETURN_STATUS_LABEL_SENT: { de: 'Label gesendet', ar: 'إرسال الملصق' },
  RETURN_STATUS_RECEIVED: { de: 'Retoure eingetroffen', ar: 'استلام المرتجع' },
  RETURN_STATUS_INSPECTED: { de: 'Retoure geprüft', ar: 'فحص المرتجع' },
  RETURN_STATUS_REFUNDED: { de: 'Erstattet', ar: 'تم الاسترداد' },
  STAFF_INVITED: { de: 'Mitarbeiter eingeladen', ar: 'دعوة موظف' },
  STAFF_ROLE_CHANGED: { de: 'Rolle geändert', ar: 'تغيير الدور' },
  STAFF_CREATED: { de: 'Mitarbeiter erstellt', ar: 'إنشاء موظف' },
  STAFF_ACTIVATED: { de: 'Mitarbeiter aktiviert', ar: 'تفعيل الموظف' },
  STAFF_DEACTIVATED: { de: 'Mitarbeiter deaktiviert', ar: 'تعطيل الموظف' },
  STAFF_DELETED: { de: 'Mitarbeiter gelöscht', ar: 'حذف الموظف' },
  STAFF_PASSWORD_RESET: { de: 'Passwort zurückgesetzt', ar: 'إعادة تعيين كلمة المرور' },
  VARIANT_COLOR_ADDED: { de: 'Farbe hinzugefügt', ar: 'إضافة لون' },
  VARIANT_SIZE_ADDED: { de: 'Größe hinzugefügt', ar: 'إضافة مقاس' },
  VARIANT_UPDATED: { de: 'Variante aktualisiert', ar: 'تحديث المتغير' },
  VARIANT_DELETED: { de: 'Variante gelöscht', ar: 'حذف المتغير' },
  COUPON_CREATED: { de: 'Gutschein erstellt', ar: 'إنشاء قسيمة' },
  SUPPLIER_CREATED: { de: 'Lieferant erstellt', ar: 'إنشاء مورد' },
  SUPPLIER_DELIVERY_RECEIVED: { de: 'Wareneingang', ar: 'استلام بضاعة' },
  SUPPLIER_DELIVERY_CANCELLED: { de: 'Lieferung storniert', ar: 'إلغاء التوريد' },
  REFUND_RETRY_SUCCEEDED: { de: 'Erstattung wiederholt', ar: 'إعادة الاسترداد بنجاح' },
  REFUND_RETRY_FAILED: { de: 'Erstattung fehlgeschlagen', ar: 'فشل إعادة الاسترداد' },
  REFUND_MARKED_MANUAL: { de: 'Manuell erstattet', ar: 'استرداد يدوي' },
}

function translateAction(action: string, locale: string): string {
  const labels = ACTION_TRANSLATIONS[action]
  if (!labels) return action
  return locale === 'ar' ? labels.ar : labels.de
}

function getStaffStatus(s: StaffMember): 'active' | 'inactive' | 'pending' | 'blocked' {
  if (s.isBlocked) return 'blocked'
  if (!s.firstName) return 'pending'
  if (s.isActive) return 'active'
  return 'inactive'
}

function getInitials(s: StaffMember): string {
  if (!s.firstName) return s.email.charAt(0).toUpperCase()
  return `${s.firstName.charAt(0)}${s.lastName?.charAt(0) ?? ''}`.toUpperCase()
}

function getAvatarColor(id: string): string {
  const colors = [
    'bg-blue-600', 'bg-purple-600', 'bg-emerald-600', 'bg-orange-600',
    'bg-rose-600', 'bg-teal-600', 'bg-indigo-600', 'bg-amber-600',
  ]
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = ((hash << 5) - hash) + id.charCodeAt(i)
  return colors[Math.abs(hash) % colors.length]
}

// ── Main Component ───────────────────────────────────────────
export default function AdminStaffPage() {
  const locale = useLocale()
  const qc = useQueryClient()
  const { adminUser } = useAuthStore()

  const [search, setSearch] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null)
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const showSuccess = (msg: string) => setToast({ message: msg, type: 'success' })
  const showError = (msg: string) => setToast({ message: msg, type: 'error' })

  // ── Queries ─────────────────────────────────────────────
  const { data: staffList, isLoading: staffLoading } = useQuery({
    queryKey: ['admin-staff', search],
    queryFn: async () => {
      const params: Record<string, string> = {}
      if (search) params.search = search
      const { data } = await api.get('/admin/staff', { params })
      return data as StaffMember[]
    },
  })

  const { data: permissionsData } = useQuery({
    queryKey: ['admin-staff-permissions'],
    queryFn: async () => {
      const { data } = await api.get('/admin/staff/permissions')
      return data as PermissionsData
    },
  })

  const selectedStaff = (staffList ?? []).find((s: StaffMember) => s.id === selectedStaffId) ?? null

  const { data: staffDetail } = useQuery({
    queryKey: ['admin-staff-detail', selectedStaffId],
    queryFn: async () => {
      const { data } = await api.get(`/admin/staff/${selectedStaffId}`)
      return data as StaffMember
    },
    enabled: !!selectedStaffId,
  })

  const { data: activityData } = useQuery({
    queryKey: ['admin-staff-activity', selectedStaffId],
    queryFn: async () => {
      const { data } = await api.get(`/admin/staff/${selectedStaffId}/activity`)
      return data as ActivityEntry[]
    },
    enabled: !!selectedStaffId,
  })

  // Merge detail into the list-level object for most up-to-date info
  const detailStaff = staffDetail ?? selectedStaff

  // ── Mutations ───────────────────────────────────────────
  const inviteMutation = useMutation({
    mutationFn: (payload: { email: string; staffRole: StaffRoleValue; customPermissions?: string[] }) =>
      api.post('/admin/staff/invite', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      setShowInviteModal(false)
      showSuccess(t3(locale, 'Einladung gesendet', 'Invitation sent', 'تم إرسال الدعوة'))
    },
    onError: () => showError(t3(locale, 'Einladung fehlgeschlagen', 'Invitation failed', 'فشل إرسال الدعوة')),
  })

  const roleMutation = useMutation({
    mutationFn: ({ id, staffRole, customPermissions, role }: { id: string; staffRole: string; customPermissions?: string[]; role?: string }) =>
      api.patch(`/admin/staff/${id}/role`, { staffRole, customPermissions, role }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      qc.invalidateQueries({ queryKey: ['admin-staff-detail', selectedStaffId] })
      showSuccess(t3(locale, 'Rolle aktualisiert', 'Role updated', 'تم تحديث الدور'))
    },
    onError: () => showError(t3(locale, 'Fehler beim Aktualisieren', 'Update failed', 'فشل التحديث')),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/staff/${id}/activate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      qc.invalidateQueries({ queryKey: ['admin-staff-detail', selectedStaffId] })
      showSuccess(t3(locale, 'Mitarbeiter aktiviert', 'Staff activated', 'تم تفعيل الموظف'))
    },
  })

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/admin/staff/${id}/deactivate`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      qc.invalidateQueries({ queryKey: ['admin-staff-detail', selectedStaffId] })
      showSuccess(t3(locale, 'Mitarbeiter deaktiviert', 'Staff deactivated', 'تم إلغاء تفعيل الموظف'))
    },
  })

  const resetPwMutation = useMutation({
    mutationFn: async (id: string) => {
      const { data } = await api.post(`/admin/staff/${id}/reset-password`)
      return data
    },
    onSuccess: (data: { email: string; tempPassword: string }) => {
      setTempPw({ email: data.email, password: data.tempPassword })
    },
    onError: () => showError(t3(locale, 'Passwort-Reset fehlgeschlagen', 'Password reset failed', 'فشل إعادة تعيين كلمة المرور')),
  })

  const confirmDialog = useConfirm()

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/admin/staff/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-staff'] })
      setSelectedStaffId(null)
      showSuccess(t3(locale, 'Mitarbeiter entfernt', 'Staff removed', 'تم إزالة الموظف'))
    },
    onError: () => showError(t3(locale, 'Entfernen fehlgeschlagen', 'Removal failed', 'فشل الإزالة')),
  })

  // ── Handlers ────────────────────────────────────────────
  const handleDeactivate = async (id: string) => {
    const ok = await confirmDialog({
      title: t3(locale, 'Mitarbeiter deaktivieren', 'Deactivate staff', 'إلغاء تفعيل الموظف'),
      description: t3(locale, 'Der Mitarbeiter kann sich nicht mehr einloggen. Alle aktiven Sessions werden beendet.', 'The staff member will no longer be able to log in. All active sessions will be terminated.', 'لن يتمكن الموظف من تسجيل الدخول. سيتم إنهاء جميع الجلسات النشطة.'),
      confirmLabel: t3(locale, 'Deaktivieren', 'Deactivate', 'إلغاء التفعيل'),
      cancelLabel: t3(locale, 'Abbrechen', 'Cancel', 'إلغاء'),
      variant: 'danger',
    })
    if (ok) deactivateMutation.mutate(id)
  }

  const handleResetPassword = async (id: string) => {
    const ok = await confirmDialog({
      title: t3(locale, 'Passwort zurücksetzen', 'Reset password', 'إعادة تعيين كلمة المرور'),
      description: t3(locale, 'Ein neues temporäres Passwort wird generiert. Der Mitarbeiter muss es beim nächsten Login ändern.', 'A new temporary password will be generated. The staff member must change it at next login.', 'سيتم إنشاء كلمة مرور مؤقتة جديدة. يجب على الموظف تغييرها عند تسجيل الدخول التالي.'),
      confirmLabel: t3(locale, 'Zurücksetzen', 'Reset', 'إعادة تعيين'),
      cancelLabel: t3(locale, 'Abbrechen', 'Cancel', 'إلغاء'),
      variant: 'default',
    })
    if (ok) resetPwMutation.mutate(id)
  }

  const handleDelete = async (id: string) => {
    const staff = (staffList ?? []).find((s: any) => s.id === id)
    const email = staff?.email ?? 'delete'
    const ok = await confirmDialog({
      title: t3(locale, 'Mitarbeiter entfernen', 'Remove staff member', 'إزالة الموظف'),
      description: t3(locale, 'Dieser Vorgang kann nicht rückgängig gemacht werden. Die Daten bleiben im Audit-Log erhalten.', 'This action cannot be undone. Data will be preserved in the audit log.', 'لا يمكن التراجع عن هذا الإجراء. ستبقى البيانات في سجل المراجعة.'),
      confirmLabel: t3(locale, 'Endgültig entfernen', 'Remove permanently', 'إزالة نهائياً'),
      cancelLabel: t3(locale, 'Abbrechen', 'Cancel', 'إلغاء'),
      variant: 'destructive',
      typeToConfirm: email,
      typeToConfirmLabel: t3(
        locale,
        `Tippen Sie "${email}" ein um zu bestätigen:`,
        `Type "${email}" to confirm:`,
        `اكتب "${email}" للتأكيد:`,
      ),
    })
    if (ok) deleteMutation.mutate(id)
  }

  const isSuperAdmin = adminUser?.role === 'super_admin'

  // ── Filtered staff list ─────────────────────────────────
  const filteredStaff = (staffList ?? []) as StaffMember[]

  return (
    <div className="min-h-screen">
      <AdminBreadcrumb items={[{ label: t3(locale, 'Mitarbeiterverwaltung', 'Staff Management', 'إدارة الموظفين') }]} />

      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-[100] flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg border transition-all duration-300 animate-in slide-in-from-top-2 ${
          toast.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {toast.type === 'success' ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
          <span className="text-sm font-medium">{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-2 opacity-60 hover:opacity-100">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {t3(locale, 'Mitarbeiterverwaltung', 'Staff Management', 'إدارة الموظفين')}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {t3(locale,
              `${filteredStaff.length} Mitarbeiter insgesamt`,
              `${filteredStaff.length} staff members total`,
              `${filteredStaff.length} موظف إجمالي`
            )}
          </p>
        </div>
        <Button
          onClick={() => setShowInviteModal(true)}
          className="gap-2 bg-[#1a1a2e] hover:bg-[#1a1a2e]/90 text-white shadow-md"
        >
          <Plus className="h-4 w-4" />
          {t3(locale, 'Mitarbeiter einladen', 'Invite Staff', 'دعوة موظف')}
        </Button>
      </div>

      {/* ── Search Bar ──────────────────────────────────── */}
      <div className="mb-6">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t3(locale, 'Mitarbeiter suchen...', 'Search staff...', 'بحث عن موظف...')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10 h-10 rounded-xl border-gray-200 focus:border-[#d4a853] focus:ring-[#d4a853]/20"
          />
        </div>
      </div>

      {/* ── Main Content Grid ───────────────────────────── */}
      <div className={`grid gap-6 transition-all duration-300 ${selectedStaffId ? 'grid-cols-1 lg:grid-cols-[1fr,420px]' : 'grid-cols-1'}`}>

        {/* ── Staff Table ───────────────────────────────── */}
        <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <colgroup>
                <col style={{ width: '30%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '15%' }} />
              </colgroup>
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    {t3(locale, 'Mitarbeiter', 'Staff', 'الموظف')}
                  </th>
                  <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    {t3(locale, 'Rolle', 'Role', 'الدور')}
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    {t3(locale, 'Status', 'Status', 'الحالة')}
                  </th>
                  <th className="text-start px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground hidden md:table-cell">
                    {t3(locale, 'Letzter Login', 'Last Login', 'آخر تسجيل دخول')}
                  </th>
                  <th className="text-end px-4 py-3 font-semibold text-sm uppercase tracking-wider text-muted-foreground">
                    {t3(locale, 'Aktionen', 'Actions', 'الإجراءات')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {staffLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="border-b border-gray-100">
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 bg-gray-200 rounded-full animate-pulse" />
                          <div className="space-y-2">
                            <div className="h-4 w-32 bg-gray-200 rounded animate-pulse" />
                            <div className="h-3 w-44 bg-gray-100 rounded animate-pulse" />
                          </div>
                        </div>
                      </td>
                      {Array.from({ length: 4 }).map((_, j) => (
                        <td key={j} className="px-4 py-4"><div className="h-4 w-20 bg-gray-200 rounded animate-pulse" /></td>
                      ))}
                    </tr>
                  ))
                ) : filteredStaff.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-16 text-center">
                      <Users className="h-12 w-12 text-gray-300 mx-auto mb-3" />
                      <p className="text-gray-500 font-medium">
                        {t3(locale, 'Keine Mitarbeiter gefunden', 'No staff found', 'لم يتم العثور على موظفين')}
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredStaff.map((s) => {
                    const status = getStaffStatus(s)
                    const statusInfo = STATUS_BADGE[status]
                    const roleLabel = ROLE_LABELS[s.staffRole ?? s.role]
                    const isSelected = selectedStaffId === s.id

                    return (
                      <tr
                        key={s.id}
                        onClick={() => setSelectedStaffId(isSelected ? null : s.id)}
                        className={`border-b border-gray-100 cursor-pointer transition-all duration-200 ${
                          isSelected
                            ? 'bg-[#d4a853]/5 hover:bg-[#d4a853]/10'
                            : 'hover:bg-muted/30'
                        }`}
                      >
                        {/* Name + Email */}
                        <td className="px-4 py-4">
                          <div className="flex items-center gap-3">
                            {s.profileImageUrl ? (
                              <img
                                src={s.profileImageUrl}
                                alt=""
                                className="h-10 w-10 rounded-full object-cover ring-2 ring-white shadow-sm"
                              />
                            ) : (
                              <div className={`h-10 w-10 rounded-full flex items-center justify-center text-white text-sm font-bold shadow-sm ${getAvatarColor(s.id)}`}>
                                {getInitials(s)}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900 truncate">
                                {s.firstName
                                  ? `${s.firstName} ${s.lastName ?? ''}`
                                  : t3(locale, 'Einladung ausstehend', 'Invitation Pending', 'دعوة معلّقة')
                                }
                              </p>
                              <p className="text-xs text-gray-500 truncate">{s.email}</p>
                            </div>
                          </div>
                        </td>

                        {/* Role Badge */}
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${ROLE_BADGE_COLORS[s.staffRole ?? s.role] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
                            {roleLabel ? t3(locale, roleLabel.de, roleLabel.en, roleLabel.ar) : (s.staffRole ?? s.role)}
                          </span>
                        </td>

                        {/* Status Badge */}
                        <td className="px-4 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${statusInfo.colors}`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${
                              status === 'active' ? 'bg-emerald-500' :
                              status === 'pending' ? 'bg-yellow-500' :
                              status === 'blocked' ? 'bg-red-500' : 'bg-gray-400'
                            }`} />
                            {t3(locale, statusInfo.de, statusInfo.en, statusInfo.ar)}
                          </span>
                        </td>

                        {/* Last Login */}
                        <td className="px-4 py-4 text-gray-500 text-sm hidden md:table-cell">
                          {s.lastLoginAt ? formatDateTime(s.lastLoginAt, locale) : '—'}
                        </td>

                        {/* Actions */}
                        <td className="px-4 py-4 text-end">
                          <div className="flex justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            {s.isActive ? (
                              <button
                                onClick={() => handleDeactivate(s.id)}
                                className="p-2 hover:bg-red-50 rounded-lg text-red-500 transition-colors"
                                title={t3(locale, 'Deaktivieren', 'Deactivate', 'إلغاء التفعيل')}
                              >
                                <PowerOff className="h-4 w-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => activateMutation.mutate(s.id)}
                                className="p-2 hover:bg-emerald-50 rounded-lg text-emerald-600 transition-colors"
                                title={t3(locale, 'Aktivieren', 'Activate', 'تفعيل')}
                              >
                                <Power className="h-4 w-4" />
                              </button>
                            )}
                            <button
                              onClick={() => handleResetPassword(s.id)}
                              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                              title={t3(locale, 'Passwort zurücksetzen', 'Reset Password', 'إعادة تعيين كلمة المرور')}
                            >
                              <KeyRound className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setSelectedStaffId(selectedStaffId === s.id ? null : s.id)}
                              className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 transition-colors"
                              title={t3(locale, 'Details', 'Details', 'التفاصيل')}
                            >
                              <ChevronRight className={`h-4 w-4 transition-transform duration-200 ${selectedStaffId === s.id ? 'rotate-90' : ''}`} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ── Detail Panel (slide-in) ───────────────────── */}
        {selectedStaffId && detailStaff && (
          <StaffDetailPanel
            staff={detailStaff}
            locale={locale}
            isSuperAdmin={isSuperAdmin}
            permissionsData={permissionsData ?? null}
            activityData={activityData ?? []}
            onClose={() => setSelectedStaffId(null)}
            onChangeRole={(staffRole, customPermissions, role) => {
              roleMutation.mutate({ id: detailStaff.id, staffRole, customPermissions, role })
            }}
            onActivate={() => activateMutation.mutate(detailStaff.id)}
            onDeactivate={() => handleDeactivate(detailStaff.id)}
            onResetPassword={() => handleResetPassword(detailStaff.id)}
            onDelete={() => handleDelete(detailStaff.id)}
            isRoleUpdating={roleMutation.isPending}
          />
        )}
      </div>

      {/* ── Invite Modal ────────────────────────────────── */}
      {showInviteModal && (
        <InviteModal
          locale={locale}
          permissionsData={permissionsData ?? null}
          onClose={() => setShowInviteModal(false)}
          onInvite={(email, staffRole, customPermissions) => {
            inviteMutation.mutate({ email, staffRole, customPermissions })
          }}
          isPending={inviteMutation.isPending}
        />
      )}

      {/* ── Temp Password Modal ─────────────────────────── */}
      {tempPw && (
        <TempPasswordModal
          locale={locale}
          email={tempPw.email}
          password={tempPw.password}
          onClose={() => setTempPw(null)}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Invite Modal Component ───────────────────────────────────
// ══════════════════════════════════════════════════════════════
function InviteModal({
  locale,
  permissionsData,
  onClose,
  onInvite,
  isPending,
}: {
  locale: string
  permissionsData: PermissionsData | null
  onClose: () => void
  onInvite: (email: string, staffRole: StaffRoleValue, customPermissions?: string[]) => void
  isPending: boolean
}) {
  const [email, setEmail] = useState('')
  const [selectedRole, setSelectedRole] = useState<StaffRoleValue | null>(null)
  const [customPerms, setCustomPerms] = useState<string[]>([])

  const roles: StaffRoleValue[] = ['seller', 'warehouse', 'manager', 'full_access', 'custom']

  const handleInvite = () => {
    if (!email || !selectedRole) return
    onInvite(email, selectedRole, selectedRole === 'custom' ? customPerms : undefined)
  }

  const togglePerm = (key: string) => {
    setCustomPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-4 sm:inset-auto sm:top-1/2 sm:left-1/2 sm:-translate-x-1/2 sm:-translate-y-1/2 z-50 sm:max-w-xl sm:w-full bg-white rounded-2xl shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b bg-[#1a1a2e]">
          <h3 className="text-lg font-bold text-white">
            {t3(locale, 'Mitarbeiter einladen', 'Invite Staff Member', 'دعوة موظف')}
          </h3>
          <button onClick={onClose} className="text-white/60 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6">
          {/* Email Input */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              <Mail className="inline h-4 w-4 mr-1.5 -mt-0.5 text-gray-400" />
              {t3(locale, 'E-Mail-Adresse', 'Email Address', 'البريد الإلكتروني')}
            </label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t3(locale, 'mitarbeiter@malak.de', 'staff@malak.de', 'staff@malak.de')}
              className="h-11 rounded-xl border-gray-200 focus:border-[#d4a853] focus:ring-[#d4a853]/20"
            />
          </div>

          {/* Role Selection Cards */}
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              <Shield className="inline h-4 w-4 mr-1.5 -mt-0.5 text-gray-400" />
              {t3(locale, 'Rolle auswählen', 'Select Role', 'اختيار الدور')}
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {roles.map((role) => {
                const label = ROLE_LABELS[role]
                const desc = ROLE_DESCRIPTIONS[role]
                const Icon = ROLE_ICONS[role]
                const isSelected = selectedRole === role
                const badgeColor = ROLE_BADGE_COLORS[role]

                return (
                  <button
                    key={role}
                    onClick={() => {
                      setSelectedRole(role)
                      if (role !== 'custom') setCustomPerms([])
                    }}
                    className={`relative text-start p-4 rounded-xl border-2 transition-all duration-200 ${
                      isSelected
                        ? 'border-[#d4a853] bg-[#d4a853]/5 shadow-md'
                        : 'border-gray-200 hover:border-gray-300 hover:shadow-sm'
                    }`}
                  >
                    {isSelected && (
                      <div className="absolute top-3 right-3 h-5 w-5 rounded-full bg-[#d4a853] flex items-center justify-center">
                        <Check className="h-3 w-3 text-white" />
                      </div>
                    )}
                    <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold border mb-2 ${badgeColor}`}>
                      <Icon className="h-3 w-3" />
                      {t3(locale, label.de, label.en, label.ar)}
                    </div>
                    <p className="text-xs text-gray-500 leading-relaxed">
                      {t3(locale, desc.de, desc.en, desc.ar)}
                    </p>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Custom Permissions */}
          {selectedRole === 'custom' && permissionsData && (
            <div className="mb-4">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                <Settings2 className="inline h-4 w-4 mr-1.5 -mt-0.5 text-gray-400" />
                {t3(locale, 'Berechtigungen auswählen', 'Select Permissions', 'اختيار الأذونات')}
              </label>
              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-2">
                {permissionsData.groups.map((group) => (
                  <div key={group.key} className="bg-gray-50 rounded-xl p-4">
                    <h4 className="text-xs font-bold text-gray-600 uppercase tracking-wider mb-3">
                      {typeof group.label === 'object' ? (group.label as any)[locale] || (group.label as any).de : group.label}
                    </h4>
                    <div className="space-y-2">
                      {group.permissions.map((perm) => (
                        <label
                          key={perm.key}
                          className="flex items-center gap-3 cursor-pointer group"
                        >
                          <div
                            className={`h-5 w-5 rounded-md border-2 flex items-center justify-center transition-all duration-150 ${
                              customPerms.includes(perm.key)
                                ? 'bg-[#d4a853] border-[#d4a853]'
                                : 'border-gray-300 group-hover:border-gray-400'
                            }`}
                            onClick={() => togglePerm(perm.key)}
                          >
                            {customPerms.includes(perm.key) && (
                              <Check className="h-3 w-3 text-white" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0" onClick={() => togglePerm(perm.key)}>
                            <p className="text-sm font-medium text-gray-700">{typeof perm.label === 'object' ? (perm.label as any)[locale] || (perm.label as any).de : perm.label}</p>
                            {perm.description && (
                              <p className="text-xs text-gray-400">{typeof perm.description === 'object' ? (perm.description as any)[locale] || (perm.description as any).de : perm.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="flex gap-3 px-6 py-4 border-t bg-gray-50">
          <Button
            variant="outline"
            onClick={onClose}
            className="flex-1 h-11 rounded-xl"
          >
            {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
          </Button>
          <Button
            onClick={handleInvite}
            disabled={!email || !selectedRole || isPending}
            className="flex-1 h-11 rounded-xl bg-[#d4a853] hover:bg-[#c49943] text-white shadow-md"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {t3(locale, 'Einladen', 'Invite', 'دعوة')}
          </Button>
        </div>
      </div>
    </>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Staff Detail Panel ───────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function StaffDetailPanel({
  staff,
  locale,
  isSuperAdmin,
  permissionsData,
  activityData,
  onClose,
  onChangeRole,
  onActivate,
  onDeactivate,
  onResetPassword,
  onDelete,
  isRoleUpdating,
}: {
  staff: StaffMember
  locale: string
  isSuperAdmin: boolean
  permissionsData: PermissionsData | null
  activityData: ActivityEntry[]
  onClose: () => void
  onChangeRole: (staffRole: string, customPermissions?: string[], role?: string) => void
  onActivate: () => void
  onDeactivate: () => void
  onResetPassword: () => void
  onDelete: () => void
  isRoleUpdating: boolean
}) {
  const status = getStaffStatus(staff)
  const statusInfo = STATUS_BADGE[status]
  const roleLabel = ROLE_LABELS[staff.staffRole ?? staff.role]

  const [editingRole, setEditingRole] = useState(false)
  const [newStaffRole, setNewStaffRole] = useState(staff.staffRole ?? 'seller')
  const [customPerms, setCustomPerms] = useState<string[]>(staff.permissions ?? [])
  const [showActivity, setShowActivity] = useState(false)

  // Sync when staff changes
  useEffect(() => {
    setNewStaffRole(staff.staffRole ?? 'seller')
    setCustomPerms(staff.permissions ?? [])
    setEditingRole(false)
  }, [staff.id, staff.staffRole, staff.permissions])

  const togglePerm = (key: string) => {
    setCustomPerms((prev) =>
      prev.includes(key) ? prev.filter((p) => p !== key) : [...prev, key]
    )
  }

  const handleSaveRole = () => {
    onChangeRole(newStaffRole, newStaffRole === 'custom' ? customPerms : undefined)
    setEditingRole(false)
  }

  const allRoles: StaffRoleValue[] = ['seller', 'warehouse', 'manager', 'full_access', 'custom']

  return (
    <div className="bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden animate-in slide-in-from-right-4 duration-300">
      {/* Panel Header */}
      <div className="bg-[#1a1a2e] px-4 py-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            {staff.profileImageUrl ? (
              <img
                src={staff.profileImageUrl}
                alt=""
                className="h-12 w-12 rounded-full object-cover ring-2 ring-white/20"
              />
            ) : (
              <div className={`h-12 w-12 rounded-full flex items-center justify-center text-white text-sm font-bold ${getAvatarColor(staff.id)}`}>
                {getInitials(staff)}
              </div>
            )}
            <div>
              <h3 className="text-white font-bold">
                {staff.firstName
                  ? `${staff.firstName} ${staff.lastName ?? ''}`
                  : t3(locale, 'Einladung ausstehend', 'Invitation Pending', 'دعوة معلّقة')
                }
              </h3>
              <p className="text-white/60 text-sm">{staff.email}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-white/40 hover:text-white transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex gap-2 mt-4">
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold border ${ROLE_BADGE_COLORS[staff.staffRole ?? staff.role] ?? 'bg-gray-100 text-gray-800 border-gray-200'}`}>
            {roleLabel ? t3(locale, roleLabel.de, roleLabel.en, roleLabel.ar) : (staff.staffRole ?? staff.role)}
          </span>
          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold border ${statusInfo.colors}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${
              status === 'active' ? 'bg-emerald-500' :
              status === 'pending' ? 'bg-yellow-500' :
              status === 'blocked' ? 'bg-red-500' : 'bg-gray-400'
            }`} />
            {t3(locale, statusInfo.de, statusInfo.en, statusInfo.ar)}
          </span>
        </div>
      </div>

      <div className="p-5 space-y-5 max-h-[calc(100vh-300px)] overflow-y-auto">
        {/* ── Name Edit ─────────────────────────────────── */}
        <NameEditor staffId={staff.id} firstName={staff.firstName ?? ''} lastName={staff.lastName ?? ''} locale={locale} />

        {/* ── Profile Info ─────────────────────────────── */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t3(locale, 'Profil', 'Profile', 'الملف الشخصي')}
          </h4>
          <div className="grid grid-cols-2 gap-3">
            <InfoCard
              icon={<Calendar className="h-4 w-4 text-gray-400" />}
              label={t3(locale, 'Mitglied seit', 'Member Since', 'عضو منذ')}
              value={formatDate(staff.createdAt, locale)}
            />
            <InfoCard
              icon={<Clock className="h-4 w-4 text-gray-400" />}
              label={t3(locale, 'Letzter Login', 'Last Login', 'آخر تسجيل دخول')}
              value={staff.lastLoginAt ? formatDateTime(staff.lastLoginAt, locale) : '—'}
            />
            {staff.invitedBy && (
              <InfoCard
                icon={<User className="h-4 w-4 text-gray-400" />}
                label={t3(locale, 'Eingeladen von', 'Invited By', 'تمت الدعوة بواسطة')}
                value={staff.invitedBy}
              />
            )}
          </div>
        </div>

        {/* ── Role Management ──────────────────────────── */}
        {isSuperAdmin && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                {t3(locale, 'Rolle verwalten', 'Manage Role', 'إدارة الدور')}
              </h4>
              {!editingRole && (
                <button
                  onClick={() => setEditingRole(true)}
                  className="text-xs text-[#d4a853] hover:text-[#c49943] font-semibold transition-colors"
                >
                  {t3(locale, 'Ändern', 'Change', 'تغيير')}
                </button>
              )}
            </div>

            {editingRole ? (
              <div className="bg-gray-50 rounded-xl p-4 space-y-3">
                <select
                  value={newStaffRole}
                  onChange={(e) => setNewStaffRole(e.target.value as StaffRoleValue)}
                  className="w-full h-10 px-3 rounded-xl border border-gray-200 bg-white text-sm font-medium focus:border-[#d4a853] focus:ring-[#d4a853]/20 focus:outline-none"
                >
                  {allRoles.map((r) => {
                    const label = ROLE_LABELS[r]
                    return (
                      <option key={r} value={r}>
                        {t3(locale, label.de, label.en, label.ar)}
                      </option>
                    )
                  })}
                </select>

                {/* Custom permission toggles */}
                {newStaffRole === 'custom' && permissionsData && (
                  <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
                    {permissionsData.groups.map((group) => (
                      <div key={group.key} className="bg-white rounded-lg p-3 border border-gray-100">
                        <h5 className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">
                          {typeof group.label === 'object' ? (group.label as any)[locale] || (group.label as any).de : group.label}
                        </h5>
                        <div className="space-y-1.5">
                          {group.permissions.map((perm) => (
                            <label
                              key={perm.key}
                              className="flex items-center gap-2.5 cursor-pointer group"
                            >
                              <div
                                className={`h-4.5 w-4.5 rounded-md border-2 flex items-center justify-center shrink-0 transition-all duration-150 ${
                                  customPerms.includes(perm.key)
                                    ? 'bg-[#d4a853] border-[#d4a853]'
                                    : 'border-gray-300 group-hover:border-gray-400'
                                }`}
                                onClick={() => togglePerm(perm.key)}
                                style={{ height: 18, width: 18 }}
                              >
                                {customPerms.includes(perm.key) && (
                                  <Check className="h-2.5 w-2.5 text-white" />
                                )}
                              </div>
                              <span
                                className="text-sm text-gray-700 cursor-pointer"
                                onClick={() => togglePerm(perm.key)}
                              >
                                {typeof perm.label === 'object' ? (perm.label as any)[locale] || (perm.label as any).de : perm.label}
                              </span>
                            </label>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setEditingRole(false)
                      setNewStaffRole(staff.staffRole ?? 'seller')
                      setCustomPerms(staff.permissions ?? [])
                    }}
                    className="flex-1 rounded-lg"
                  >
                    {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleSaveRole}
                    disabled={isRoleUpdating}
                    className="flex-1 rounded-lg bg-[#d4a853] hover:bg-[#c49943] text-white"
                  >
                    {isRoleUpdating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                    {t3(locale, 'Speichern', 'Save', 'حفظ')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="bg-gray-50 rounded-xl p-4">
                <div className="flex items-center gap-2">
                  {(() => {
                    const Icon = ROLE_ICONS[staff.staffRole ?? staff.role] ?? Shield
                    return <Icon className="h-4 w-4 text-gray-500" />
                  })()}
                  <span className="text-sm font-medium text-gray-700">
                    {roleLabel ? t3(locale, roleLabel.de, roleLabel.en, roleLabel.ar) : (staff.staffRole ?? staff.role)}
                  </span>
                </div>
                {staff.staffRole === 'custom' && staff.permissions?.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {staff.permissions.map((p) => {
                      const PERM_LABELS: Record<string, { de: string; ar: string }> = {
                        'dashboard.view': { de: 'Dashboard', ar: 'لوحة التحكم' },
                        'orders.view': { de: 'Bestellungen ansehen', ar: 'عرض الطلبات' },
                        'orders.edit': { de: 'Bestellungen bearbeiten', ar: 'تعديل الطلبات' },
                        'orders.cancel': { de: 'Bestellungen stornieren', ar: 'إلغاء الطلبات' },
                        'products.view': { de: 'Produkte ansehen', ar: 'عرض المنتجات' },
                        'products.create': { de: 'Produkte erstellen', ar: 'إنشاء المنتجات' },
                        'products.edit': { de: 'Produkte bearbeiten', ar: 'تعديل المنتجات' },
                        'products.delete': { de: 'Produkte löschen', ar: 'حذف المنتجات' },
                        'inventory.view': { de: 'Bestand ansehen', ar: 'عرض المخزون' },
                        'inventory.intake': { de: 'Wareneingang', ar: 'استلام بضاعة' },
                        'inventory.transfer': { de: 'Lager-Transfer', ar: 'نقل المخزون' },
                        'inventory.stocktake': { de: 'Inventur', ar: 'جرد' },
                        'scanner.view_prices': { de: 'Scanner: Preise', ar: 'الماسح: الأسعار' },
                        'customers.view': { de: 'Kunden ansehen', ar: 'عرض العملاء' },
                        'customers.edit': { de: 'Kunden bearbeiten', ar: 'تعديل العملاء' },
                        'customers.delete': { de: 'Kunden löschen', ar: 'حذف العملاء' },
                        'customers.gdpr': { de: 'DSGVO-Löschung', ar: 'حذف البيانات' },
                        'finance.revenue': { de: 'Umsatz ansehen', ar: 'عرض الإيرادات' },
                        'finance.margins': { de: 'Margen ansehen', ar: 'عرض الهوامش' },
                        'finance.invoices': { de: 'Rechnungen', ar: 'الفواتير' },
                        'finance.vat_report': { de: 'MwSt-Bericht', ar: 'تقرير الضريبة' },
                        'finance.export': { de: 'Export', ar: 'تصدير' },
                        'returns.view': { de: 'Retouren ansehen', ar: 'عرض المرتجعات' },
                        'returns.edit': { de: 'Retouren bearbeiten', ar: 'تعديل المرتجعات' },
                        'returns.approve': { de: 'Retouren genehmigen', ar: 'الموافقة على المرتجعات' },
                        'shipping.view': { de: 'Versand ansehen', ar: 'عرض الشحن' },
                        'shipping.labels': { de: 'Versandlabels', ar: 'بطاقات الشحن' },
                        'shipping.status': { de: 'Versandstatus', ar: 'حالة الشحن' },
                        'emails.view': { de: 'E-Mails ansehen', ar: 'عرض البريد' },
                        'emails.edit': { de: 'E-Mails bearbeiten', ar: 'تعديل البريد' },
                        'emails.test': { de: 'Test-E-Mails', ar: 'بريد تجريبي' },
                        'settings.view': { de: 'Einstellungen ansehen', ar: 'عرض الإعدادات' },
                        'settings.edit': { de: 'Einstellungen bearbeiten', ar: 'تعديل الإعدادات' },
                        'staff.view': { de: 'Mitarbeiter ansehen', ar: 'عرض الموظفين' },
                        'staff.invite': { de: 'Mitarbeiter einladen', ar: 'دعوة موظف' },
                        'staff.roles': { de: 'Rollen verwalten', ar: 'إدارة الأدوار' },
                        'staff.deactivate': { de: 'Mitarbeiter deaktivieren', ar: 'تعطيل الموظف' },
                        'audit.view': { de: 'Audit-Log', ar: 'سجل المراجعة' },
                        'categories.view': { de: 'Kategorien ansehen', ar: 'عرض الفئات' },
                      }
                      const label = PERM_LABELS[p]
                      const displayLabel = label ? (locale === 'ar' ? label.ar : label.de) : p
                      return (
                        <span key={p} className="text-[10px] px-2 py-0.5 bg-white border border-gray-200 rounded-md text-gray-600 font-medium">
                          {displayLabel}
                        </span>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Actions ──────────────────────────────────── */}
        <div className="space-y-3">
          <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
            {t3(locale, 'Aktionen', 'Actions', 'الإجراءات')}
          </h4>
          <div className="grid grid-cols-2 gap-2">
            {staff.isActive ? (
              <Button
                variant="outline"
                size="sm"
                onClick={onDeactivate}
                className="gap-1.5 rounded-xl border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                <PowerOff className="h-3.5 w-3.5" />
                {t3(locale, 'Deaktivieren', 'Deactivate', 'إلغاء التفعيل')}
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                onClick={onActivate}
                className="gap-1.5 rounded-xl border-emerald-200 text-emerald-600 hover:bg-emerald-50 hover:text-emerald-700"
              >
                <Power className="h-3.5 w-3.5" />
                {t3(locale, 'Aktivieren', 'Activate', 'تفعيل')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={onResetPassword}
              className="gap-1.5 rounded-xl"
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t3(locale, 'Passwort reset', 'Reset Password', 'إعادة تعيين')}
            </Button>
          </div>
          {staff.role !== 'super_admin' && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="w-full gap-1.5 rounded-xl border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 mt-2"
            >
              <Trash2 className="h-3.5 w-3.5" />
              {t3(locale, 'Mitarbeiter entfernen', 'Remove staff', 'إزالة الموظف')}
            </Button>
          )}
        </div>

        {/* ── Activity Log ─────────────────────────────── */}
        <div className="space-y-3">
          <button
            onClick={() => setShowActivity(!showActivity)}
            className="flex items-center justify-between w-full group"
          >
            <h4 className="text-xs font-bold text-gray-500 uppercase tracking-wider">
              {t3(locale, 'Aktivitätsprotokoll', 'Activity Log', 'سجل النشاط')}
            </h4>
            <ChevronRight className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${showActivity ? 'rotate-90' : ''}`} />
          </button>

          {showActivity && (
            <div className="space-y-2 animate-in slide-in-from-top-2 duration-200">
              {activityData.length === 0 ? (
                <div className="text-center py-6 bg-gray-50 rounded-xl">
                  <Clock className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                  <p className="text-sm text-gray-400">
                    {t3(locale, 'Keine Aktivität', 'No activity', 'لا يوجد نشاط')}
                  </p>
                </div>
              ) : (
                activityData.slice(0, 20).map((a) => (
                  <div
                    key={a.id}
                    className="flex items-start gap-3 text-sm bg-gray-50 rounded-lg p-3 border border-gray-100"
                  >
                    <div className="h-2 w-2 rounded-full bg-[#d4a853] mt-1.5 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-700 text-xs">{translateAction(a.action, locale)}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">
                        {a.entityType} {a.entityId ? `· ${a.entityId.slice(0, 8)}...` : ''}
                      </p>
                    </div>
                    <div className="text-end shrink-0">
                      <p className="text-[10px] text-gray-400">{formatDateTime(a.createdAt, locale)}</p>
                      {a.ipAddress && <p className="text-[10px] text-gray-300">{a.ipAddress}</p>}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Info Card Sub-Component ──────────────────────────────────
// ══════════════════════════════════════════════════════════════
function NameEditor({ staffId, firstName, lastName, locale }: { staffId: string; firstName: string; lastName: string; locale: string }) {
  const [editing, setEditing] = useState(false)
  const [fn, setFn] = useState(firstName)
  const [ln, setLn] = useState(lastName)
  const qc = useQueryClient()

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/admin/staff/${staffId}/profile`, { firstName: fn.trim(), lastName: ln.trim() }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['admin-staff'] }); setEditing(false) },
  })

  if (!editing) {
    return (
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-muted-foreground">{t3(locale, 'Name', 'Name', 'الاسم')}</p>
          <p className="font-medium text-sm">{firstName} {lastName}</p>
        </div>
        <button onClick={() => { setFn(firstName); setLn(lastName); setEditing(true) }} className="text-xs text-primary hover:underline">
          {t3(locale, 'Bearbeiten', 'Edit', 'تعديل')}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 p-3 rounded-xl border bg-muted/10">
      <div className="grid grid-cols-2 gap-2">
        <Input value={fn} onChange={(e) => setFn(e.target.value)} placeholder={t3(locale, 'Vorname', 'First name', 'الاسم الأول')} className="rounded-lg h-8 text-sm" autoFocus />
        <Input value={ln} onChange={(e) => setLn(e.target.value)} placeholder={t3(locale, 'Nachname', 'Last name', 'اسم العائلة')} className="rounded-lg h-8 text-sm" />
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 rounded-lg text-xs flex-1" disabled={saveMut.isPending || !fn.trim()} onClick={() => saveMut.mutate()}>
          {saveMut.isPending ? '...' : t3(locale, 'Speichern', 'Save', 'حفظ')}
        </Button>
        <Button size="sm" variant="outline" className="h-7 rounded-lg text-xs flex-1" onClick={() => setEditing(false)}>
          {t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}
        </Button>
      </div>
    </div>
  )
}

function InfoCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-xl p-3 border border-gray-100">
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-[10px] text-gray-400 font-semibold uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-sm font-medium text-gray-700 truncate">{value}</p>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// ── Temp Password Modal ──────────────────────────────────────
// ══════════════════════════════════════════════════════════════
function TempPasswordModal({
  locale,
  email,
  password,
  onClose,
}: {
  locale: string
  email: string
  password: string
  onClose: () => void
}) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(password)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 z-50 max-w-sm mx-auto bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-emerald-50 px-6 py-5 border-b border-emerald-100">
          <div className="flex items-center gap-2 text-emerald-700">
            <Check className="h-5 w-5" />
            <h3 className="text-lg font-bold">
              {t3(locale, 'Neues Passwort', 'New Password', 'كلمة مرور جديدة')}
            </h3>
          </div>
        </div>

        <div className="p-6">
          <p className="text-sm text-gray-500 mb-4">
            {t3(locale,
              'Ein temporäres Passwort wurde generiert. Bitte teilen Sie es sicher mit dem Mitarbeiter.',
              'A temporary password was generated. Please share it securely with the staff member.',
              'تم إنشاء كلمة مرور مؤقتة. يرجى مشاركتها بشكل آمن مع الموظف.'
            )}
          </p>

          <p className="text-xs text-gray-400 mb-1">{email}</p>
          <div className="flex items-center gap-2 mb-6">
            <code className="flex-1 bg-gray-100 px-4 py-3 rounded-xl font-mono text-lg font-bold text-gray-800 border border-gray-200">
              {password}
            </code>
            <button
              onClick={handleCopy}
              className={`p-3 rounded-xl border transition-all duration-200 ${
                copied
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                  : 'hover:bg-gray-50 border-gray-200 text-gray-500'
              }`}
            >
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <Button
            className="w-full h-11 rounded-xl bg-[#1a1a2e] hover:bg-[#1a1a2e]/90 text-white"
            onClick={onClose}
          >
            {t3(locale, 'Schließen', 'Close', 'إغلاق')}
          </Button>
        </div>
      </div>
    </>
  )
}
