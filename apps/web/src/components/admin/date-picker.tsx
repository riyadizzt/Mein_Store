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
  value: string
  onChange: (value: string) => void
  label?: string
  placeholder?: string
  withTime?: boolean
}

export function AdminDatePicker({ value, onChange, label, placeholder, withTime = false }: AdminDatePickerProps) {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const isRTL = locale === 'ar'
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

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`w-full h-10 px-3 rounded-xl border bg-white/[0.05] text-sm flex items-center justify-between gap-2 transition-all ${
          open ? 'border-[#d4a853]/50 ring-1 ring-[#d4a853]/20' : 'border-white/[0.08]'
        } ${displayValue ? 'text-white' : 'text-white/30'}`}
      >
        <span className="tabular-nums">{displayValue || placeholder || (isRTL ? 'اختر التاريخ' : 'Datum wählen')}</span>
        <Calendar className="h-4 w-4 text-white/30 flex-shrink-0" />
      </button>

      {open && (
        <div
          className="absolute top-full mt-2 z-50 bg-[#161625] border border-white/[0.08] rounded-2xl shadow-2xl p-5"
          style={{
            [isRTL ? 'right' : 'left']: 0,
            minWidth: 340,
          }}
        >
          <style>{`
            .admin-dp .rdp {
              --rdp-accent-color: #d4a853;
              --rdp-accent-background-color: rgba(212, 168, 83, 0.15);
              --rdp-range_middle-background-color: rgba(212, 168, 83, 0.1);
              --rdp-day-width: 42px;
              --rdp-day-height: 42px;
              margin: 0;
              color: white;
              font-size: 14px;
              width: 100%;
            }

            /* Month grid takes full width */
            .admin-dp .rdp-month { width: 100%; }
            .admin-dp .rdp-month_grid { width: 100%; border-collapse: separate; border-spacing: 2px; }

            /* Header: month caption + nav */
            .admin-dp .rdp-month_caption {
              font-size: 16px;
              font-weight: 700;
              color: white;
              letter-spacing: 0.01em;
              padding-bottom: 12px;
            }
            .admin-dp .rdp-nav {
              gap: 2px;
            }
            .admin-dp .rdp-button_previous,
            .admin-dp .rdp-button_next {
              color: white !important;
              width: 32px;
              height: 32px;
              border-radius: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
              transition: background 0.15s;
            }
            .admin-dp .rdp-button_previous:hover,
            .admin-dp .rdp-button_next:hover {
              background: rgba(212, 168, 83, 0.12) !important;
            }
            .admin-dp .rdp-chevron {
              fill: white !important;
              width: 16px;
              height: 16px;
            }

            /* Weekday headers */
            .admin-dp .rdp-weekday {
              color: rgba(255, 255, 255, 0.3);
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              padding-bottom: 8px;
              width: 42px;
              text-align: center;
            }
            /* Abbreviate weekday to 1 char for Arabic */
            .admin-dp .rdp-weekdays { width: 100%; }

            /* Day cells */
            .admin-dp .rdp-day {
              border-radius: 12px;
              transition: all 0.15s ease;
              color: rgba(255, 255, 255, 0.75);
              font-weight: 500;
              width: 42px;
              height: 42px;
              text-align: center;
              vertical-align: middle;
            }
            .admin-dp .rdp-day_button {
              width: 42px;
              height: 42px;
              border-radius: 12px;
              display: flex;
              align-items: center;
              justify-content: center;
              font-variant-numeric: tabular-nums;
            }
            .admin-dp .rdp-day:hover {
              background: rgba(212, 168, 83, 0.1) !important;
              color: white;
            }

            /* Selected day */
            .admin-dp .rdp-selected .rdp-day_button {
              background: #d4a853 !important;
              color: #161625 !important;
              border-radius: 12px;
              font-weight: 700;
              box-shadow: 0 0 16px rgba(212, 168, 83, 0.3);
            }

            /* Today ring */
            .admin-dp .rdp-today:not(.rdp-selected) .rdp-day_button {
              border: 2px solid rgba(212, 168, 83, 0.4);
              border-radius: 12px;
            }

            /* Outside days */
            .admin-dp .rdp-outside { color: rgba(255, 255, 255, 0.12) !important; }
            .admin-dp .rdp-disabled { color: rgba(255, 255, 255, 0.08) !important; }
          `}</style>

          <div className="admin-dp">
            <DayPicker
              mode="single"
              selected={selectedDate}
              onSelect={handleDaySelect}
              locale={LOCALES[locale] ?? LOCALES.de}
              dir={isRTL ? 'rtl' : 'ltr'}
              showOutsideDays
              formatters={{
                formatWeekdayName: (date) => {
                  const dayStr = format(date, 'EEEEEE', { locale: LOCALES[locale] ?? LOCALES.de })
                  return dayStr.slice(0, isRTL ? 1 : 2)
                },
              }}
            />
          </div>

          {/* Time Picker */}
          {withTime && (
            <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between">
              <span className="text-sm text-white/40 font-medium">{isRTL ? 'الوقت' : 'Uhrzeit'}</span>
              <input
                type="time"
                value={time}
                onChange={(e) => handleTimeChange(e.target.value)}
                className="h-9 px-3 rounded-xl bg-white/[0.05] border border-white/[0.08] text-white text-sm tabular-nums [color-scheme:dark] focus:border-[#d4a853]/50 focus:ring-1 focus:ring-[#d4a853]/20 outline-none transition-all"
              />
            </div>
          )}

          {/* Footer */}
          <div className="mt-4 pt-4 border-t border-white/[0.06] flex items-center justify-between">
            <button
              onClick={() => { onChange(''); setOpen(false) }}
              className="text-xs text-white/25 hover:text-white/50 transition-colors"
            >
              {isRTL ? 'مسح' : 'Löschen'}
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleDaySelect(new Date())}
                className="text-xs font-medium text-[#d4a853] hover:text-[#e8d5b8] transition-colors"
              >
                {isRTL ? 'اليوم' : 'Heute'}
              </button>
              <button
                onClick={() => setOpen(false)}
                className="px-4 py-1.5 rounded-xl bg-[#d4a853] text-[#161625] text-xs font-bold hover:bg-[#c49b45] transition-colors"
              >
                {isRTL ? 'تم' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
