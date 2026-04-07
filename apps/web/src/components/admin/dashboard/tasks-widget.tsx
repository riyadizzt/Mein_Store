'use client'

import Link from 'next/link'
import { Truck, RotateCcw, AlertTriangle, FileText } from 'lucide-react'

interface TaskItem {
  label: string
  count: number
  href: string
  icon: React.ReactNode
  severity: 'red' | 'orange' | 'gray'
}

export function TasksWidget({ data, locale }: { data: any; locale: string }) {
  const t3 = (d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

  const pendingShip = data?.ordersByStatus
    ?.filter((s: any) => ['confirmed', 'processing'].includes(s.status))
    .reduce((sum: number, s: any) => sum + s.count, 0) ?? 0

  const pendingReturns = data?.pendingReturns?.count ?? 0
  const lowStock = (data?.lowStock ?? []).length
  const disputes = data?.disputes?.count ?? 0

  const tasks: TaskItem[] = [
    pendingShip > 0 ? {
      label: `${pendingShip} ${t3('Bestellungen warten auf Versand', 'orders awaiting shipment', 'طلبات تنتظر الشحن')}`,
      count: pendingShip, href: `/${locale}/admin/orders?status=confirmed`,
      icon: <Truck className="h-4 w-4" />, severity: pendingShip > 10 ? 'red' : 'orange',
    } : null,
    pendingReturns > 0 ? {
      label: `${pendingReturns} ${t3('Retouren warten auf Prüfung', 'returns awaiting review', 'مرتجعات تنتظر المراجعة')}`,
      count: pendingReturns, href: `/${locale}/admin/returns`,
      icon: <RotateCcw className="h-4 w-4" />, severity: 'orange',
    } : null,
    lowStock > 0 ? {
      label: `${lowStock} ${t3('Produkte unter Mindestbestand', 'products below minimum stock', 'منتجات تحت الحد الأدنى')}`,
      count: lowStock, href: `/${locale}/admin/inventory?lowStockOnly=true`,
      icon: <AlertTriangle className="h-4 w-4" />, severity: lowStock > 20 ? 'red' : 'orange',
    } : null,
    disputes > 0 ? {
      label: `${disputes} ${t3('offene Streitfälle', 'open disputes', 'نزاعات مفتوحة')} (€${data?.disputes?.totalAmount ?? '0'})`,
      count: disputes, href: `/${locale}/admin/orders?status=disputed`,
      icon: <FileText className="h-4 w-4" />, severity: 'red',
    } : null,
  ].filter(Boolean) as TaskItem[]

  const SEVERITY_STYLES = {
    red: 'bg-red-500/10 text-red-600 dark:text-red-400',
    orange: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
    gray: 'bg-muted text-muted-foreground',
  }

  return (
    <div className="bg-background border rounded-2xl p-5 h-full">
      <h3 className="font-semibold text-sm mb-4">{t3('Offene Aufgaben', 'Open Tasks', 'المهام المفتوحة')}</h3>
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <div className="h-10 w-10 rounded-full bg-green-500/10 flex items-center justify-center mb-2">
            <svg className="h-5 w-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          </div>
          <p className="text-sm text-muted-foreground">{t3('Alles erledigt!', 'All done!', 'كل شيء تم!')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {tasks.map((task, i) => (
            <Link key={i} href={task.href} className={`flex items-center gap-3 p-3 rounded-xl transition-all hover:scale-[1.01] ${SEVERITY_STYLES[task.severity]}`}>
              <div className="flex-shrink-0">{task.icon}</div>
              <span className="text-xs font-medium flex-1">{task.label}</span>
              <svg className="h-4 w-4 flex-shrink-0 ltr:rotate-0 rtl:rotate-180 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
