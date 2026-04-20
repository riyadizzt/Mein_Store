'use client'

import { useToastStore } from '@/store/toast-store'
import { useLocale } from 'next-intl'
import { AnimatePresence, motion } from 'motion/react'
import { Check, X, Info, AlertCircle, Undo2 } from 'lucide-react'

const ICONS = {
  success: Check,
  info: Info,
  error: AlertCircle,
} as const

const COLORS = {
  success: 'bg-green-600',
  info: 'bg-foreground',
  error: 'bg-destructive',
} as const

export function Toaster() {
  const { toasts, remove } = useToastStore()
  const locale = useLocale()
  const undoLabel = locale === 'ar' ? 'تراجع' : locale === 'en' ? 'Undo' : 'Rückgängig'
  const dismissLabel = locale === 'ar' ? 'إغلاق' : locale === 'en' ? 'Dismiss' : 'Schließen'

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="fixed bottom-6 inset-x-4 sm:left-1/2 sm:inset-x-auto sm:-translate-x-1/2 z-[200] flex flex-col-reverse items-stretch sm:items-center gap-2 pointer-events-none lg:bottom-8"
    >
      <AnimatePresence mode="popLayout">
        {toasts.map((t) => {
          const Icon = ICONS[t.type ?? 'info']
          const bg = COLORS[t.type ?? 'info']

          return (
            <motion.div
              key={t.id}
              layout
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -10, scale: 0.95 }}
              transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              className={`pointer-events-auto flex items-start gap-2.5 px-4 py-3 rounded-xl text-white text-sm font-medium shadow-elevated w-full sm:max-w-md ${bg}`}
            >
              <Icon className="h-4 w-4 flex-shrink-0 mt-0.5" />
              <span className="flex-1 min-w-0 leading-relaxed break-words">{t.message}</span>

              {t.undo && (
                <button
                  onClick={() => {
                    t.undo?.()
                    remove(t.id)
                  }}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-md bg-white/20 hover:bg-white/30 transition-colors text-xs font-semibold flex-shrink-0"
                >
                  <Undo2 className="h-3 w-3" />
                  {undoLabel}
                </button>
              )}

              <button
                onClick={() => remove(t.id)}
                className="p-1 rounded hover:bg-white/20 transition-colors flex-shrink-0 mt-[-2px]"
                aria-label={dismissLabel}
              >
                <X className="h-4 w-4" />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
