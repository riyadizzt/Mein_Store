'use client'

import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { DayPicker } from 'react-day-picker'
import { format, isValid } from 'date-fns'
import { de, enUS, ar } from 'date-fns/locale'
import { Calendar } from 'lucide-react'
import 'react-day-picker/style.css'

const LOCALES = { de, en: enUS, ar }

interface AdminDatePickerProps {
  value: string // ISO date string or 'YYYY-MM-DD'
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  withTime?: boolean
}

export function AdminDatePicker({ value, onChange, label, placeholder, withTime = false }: AdminDatePickerProps) {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const [open, setOpen] = useState(false)
  const [time, setTime] = useState('00:00')
  const ref = useRef<HTMLDivElement>(null)

  const selectedDate = value ? new Date(value) : undefined
  const displayValue = selectedDate && isValid(selectedDate)
    ? format(selectedDate, withTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy')
    : ''

  useEffect(() => {
    if (selectedDate && isValid(selectedDate)) {
      setTime(format(selectedDate, 'HH:mm'))
    }
  }, [value])

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const handleDaySelect = (day: Date | undefined) => {
    if (!day) return
    if (withTime) {
      const [h, m] = time.split(':').map(Number)
      day.setHours(h || 0, m || 0, 0, 0)
    }
    onChange(day.toISOString())
    if (!withTime) setOpen(false)
  }

  const handleTimeChange = (newTime: string) => {
    setTime(newTime)
    if (selectedDate && isValid(selectedDate)) {
      const [h, m] = newTime.split(':').map(Number)
      const updated = new Date(selectedDate)
      updated.setHours(h || 0, m || 0, 0, 0)
      onChange(updated.toISOString())
    }
  }

  return (
    <div ref={ref} className="relative">
      {label && <label className="text-sm font-medium text-white/70 mb-1.5 block">{label}</label>}

      {/* Input Trigger */}
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full h-10 px-3 rounded-xl border bg-white/[0.05] text-sm flex items-center justify-between gap-2 transition-all ${
          open ? 'border-[#d4a853]/50 ring-1 ring-[#d4a853]/20' : 'border-white/[0.08]'
        } ${displayValue ? 'text-white' : 'text-white/30'}`}
      >
        <span className="tabular-nums">{displayValue || placeholder || (locale === 'ar' ? 'تاريخ البدء' : 'Datum wählen')}</span>
        <Calendar className="h-4 w-4 text-white/30 flex-shrink-0" />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full mt-2 z-50 bg-[#1e1e32] border border-white/[0.1] rounded-2xl shadow-2xl p-4 min-w-[300px]"
          style={{ [locale === 'ar' ? 'right' : 'left']: 0 }}
        >
          <style>{`
            .rdp {
              --rdp-accent-color: #d4a853;
              --rdp-accent-background-color: rgba(212, 168, 83, 0.15);
              --rdp-range_middle-background-color: rgba(212, 168, 83, 0.1);
              --rdp-day-width: 36px;
              --rdp-day-height: 36px;
              margin: 0;
              color: white;
              font-size: 13px;
            }
            .rdp-nav { gap: 4px; }
            .rdp-button_previous, .rdp-button_next {
              color: white !important;
              width: 28px; height: 28px;
              border-radius: 8px;
            }
            .rdp-button_previous:hover, .rdp-button_next:hover {
              background: rgba(255,255,255,0.05) !important;
            }
            .rdp-month_caption { font-size: 14px; font-weight: 600; color: white; }
            .rdp-weekday { color: rgba(255,255,255,0.35); font-size: 11px; font-weight: 500; }
            .rdp-day { border-radius: 10px; transition: all 0.15s; color: rgba(255,255,255,0.7); }
            .rdp-day:hover { background: rgba(212, 168, 83, 0.1) !important; color: white; }
            .rdp-selected .rdp-day_button { background: #d4a853 !important; color: white !important; border-radius: 10px; font-weight: 600; }
            .rdp-today:not(.rdp-selected) .rdp-day_button { border: 1.5px solid rgba(212,168,83,0.4); border-radius: 10px; }
            .rdp-outside { color: rgba(255,255,255,0.15) !important; }
            .rdp-disabled { color: rgba(255,255,255,0.1) !important; }
          `}</style>

          <DayPicker
            mode="single"
            selected={selectedDate}
            onSelect={handleDaySelect}
            locale={LOCALES[locale] ?? LOCALES.de}
            dir={locale === 'ar' ? 'rtl' : 'ltr'}
            showOutsideDays
          />

          {/* Time Picker */}
          {withTime && (
            <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-xs text-white/40">{locale === 'ar' ? 'الوقت' : 'Uhrzeit'}</span>
              <input
                type="time"
                value={time}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-8 px-2 rounded-lg bg-white/[0.05] border border-white/[0.08] text-white text-sm tabular-nums [color-scheme:dark]"
              />
            </div>
          )}

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-white/[0.06] flex items-center justify-between">
            <button
              onClick={() => { onChange(''); setOpen(false) }}
              className="text-xs text-white/30 hover:text-white/60 transition-colors"
            >
              {locale === 'ar' ? 'مسح' : 'Löschen'}
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => { handleDaySelect(new Date()); }}
                className="text-xs text-[#d4a853] hover:text-[#e8d5b8] transition-colors"
              >
                {locale === 'ar' ? 'الآن' : 'Heute'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-3 py-1 rounded-lg bg-[#d4a853] text-white text-xs font-medium hover:bg-[#b8953f] transition-colors"
              >
                {locale === 'ar' ? 'تم' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
