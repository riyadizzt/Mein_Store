'use client'

import Link from 'next/link'
import type { LucideIcon } from 'lucide-react'
import { Truck, RotateCcw, AlertTriangle, FileText, ChevronRight, Check } from 'lucide-react'

type Severity = 'red' | 'amber' | 'blue'

interface TaskItem {
  label: string
  count: number
  href: string
  Icon: LucideIcon
  severity: Severity
}

const SEVERITY_STYLES: Record<Severity, { badge: string; count: string }> = {
  red: {
    badge: 'bg-red-100 text-red-600 ring-red-200/50 dark:bg-red-500/20 dark:text-red-300 dark:ring-red-500/20',
    count: 'text-red-600 dark:text-red-400',
  },
  amber: {
    badge: 'bg-amber-100 text-amber-700 ring-amber-200/50 dark:bg-amber-500/20 dark:text-amber-300 dark:ring-amber-500/20',
    count: 'text-amber-700 dark:text-amber-300',
  },
  blue: {
    badge: 'bg-sky-100 text-sky-600 ring-sky-200/50 dark:bg-sky-500/20 dark:text-sky-300 dark:ring-sky-500/20',
    count: 'text-sky-600 dark:text-sky-400',
  },
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
    pendingShip > 0
      ? {
          label: t3('warten auf Versand', 'awaiting shipment', 'تنتظر الشحن'),
          count: pendingShip,
          href: `/${locale}/admin/orders?status=confirmed`,
          Icon: Truck,
          severity: pendingShip > 10 ? 'red' : 'amber',
        }
      : null,
    pendingReturns > 0
      ? {
          label: t3('Retouren zu prüfen', 'returns to review', 'مرتجعات للمراجعة'),
          count: pendingReturns,
          href: `/${locale}/admin/returns`,
          Icon: RotateCcw,
          severity: 'amber',
        }
      : null,
    lowStock > 0
      ? {
          label: t3('unter Mindestbestand', 'below minimum stock', 'تحت الحد الأدنى'),
          count: lowStock,
          href: `/${locale}/admin/inventory?lowStockOnly=true`,
          Icon: AlertTriangle,
          severity: lowStock > 20 ? 'red' : 'amber',
        }
      : null,
    disputes > 0
      ? {
          label: t3(
            `offene Streitfälle (€${data?.disputes?.totalAmount ?? '0'})`,
            `open disputes (€${data?.disputes?.totalAmount ?? '0'})`,
            `نزاعات مفتوحة (€${data?.disputes?.totalAmount ?? '0'})`,
          ),
          count: disputes,
          href: `/${locale}/admin/orders?status=disputed`,
          Icon: FileText,
          severity: 'red',
        }
      : null,
  ].filter(Boolean) as TaskItem[]

  return (
    <div className="bg-background border border-border/60 rounded-2xl p-5 h-full shadow-sm">
      {/* Header with gold accent bar (consistent with other dashboard cards) */}
      <div className="flex items-center gap-2.5 mb-5">
        <span className="h-4 w-1 rounded-full bg-[#d4a853]" aria-hidden="true" />
        <h3 className="font-semibold text-[15px] tracking-tight">
          {t3('Offene Aufgaben', 'Open Tasks', 'المهام المفتوحة')}
        </h3>
      </div>

      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 text-center">
          <div className="h-12 w-12 rounded-full bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center mb-3 ring-1 ring-emerald-200/60 dark:ring-emerald-500/20">
            <Check className="h-6 w-6 text-emerald-600 dark:text-emerald-400" strokeWidth={2.5} />
          </div>
          <p className="text-sm font-medium text-foreground/80">
            {t3('Alles erledigt', 'All done', 'كل شيء تم')}
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t3('Keine offenen Aufgaben', 'No open tasks', 'لا توجد مهام معلقة')}
          </p>
        </div>
      ) : (
        <div className="-mx-2 space-y-0.5">
          {tasks.map((task, i) => {
            const styles = SEVERITY_STYLES[task.severity]
            const Icon = task.Icon
            return (
              <Link
                key={i}
                href={task.href}
                className="group flex items-center gap-3 px-2 py-3 rounded-xl transition-colors duration-150 hover:bg-muted/40"
              >
                {/* Circular colored badge with icon */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ring-1 ${styles.badge}`}
                >
                  <Icon className="h-4 w-4" strokeWidth={2} />
                </div>

                {/* Big count + label stacked */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className={`text-xl font-bold tabular-nums leading-none ${styles.count}`}>
                      {task.count}
                    </span>
                    <span className="text-[13px] text-foreground/80 truncate">{task.label}</span>
                  </div>
                </div>

                {/* Chevron — rtl:rotate-180 mirrors it to point in reading direction */}
                <ChevronRight
                  className="h-4 w-4 flex-shrink-0 text-muted-foreground/40 rtl:rotate-180 transition-colors group-hover:text-muted-foreground/70"
                  strokeWidth={2}
                />
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
