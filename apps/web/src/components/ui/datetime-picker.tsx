'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useLocale } from 'next-intl'
import { Calendar, ChevronLeft, ChevronRight, X, Clock } from 'lucide-react'

interface Props {
  value: string
  onChange: (val: string) => void
  placeholder?: string
  showTime?: boolean
}

const MONTHS: Record<string, string[]> = {
  de: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
  en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
  ar: ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'],
}
const DAYS: Record<string, string[]> = {
  de: ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'],
  en: ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'],
  ar: ['اث', 'ثل', 'أر', 'خم', 'جم', 'سب', 'أح'],
}

export function DateTimePicker({ value, onChange, placeholder, showTime = true }: Props) {
  const locale = useLocale() as 'de' | 'en' | 'ar'
  const [open, setOpen] = useState(false)
  const [openUp, setOpenUp] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const defaultPh = locale === 'ar' ? 'اختر التاريخ والوقت' : locale === 'en' ? 'Select date & time' : 'Datum & Uhrzeit'
  const parsed = value ? new Date(value) : null
  const [viewYear, setViewYear] = useState(parsed?.getFullYear() ?? new Date().getFullYear())
  const [viewMonth, setViewMonth] = useState(parsed?.getMonth() ?? new Date().getMonth())
  const [hour, setHour] = useState(parsed?.getHours() ?? 10)
  const [minute, setMinute] = useState(parsed?.getMinutes() ?? 0)

  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setOpenUp(window.innerHeight - rect.bottom < 400)
    }
  }, [open])

  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate()
  const firstDow = (new Date(viewYear, viewMonth, 1).getDay() + 6) % 7

  const commitDate = useCallback((day: number, h: number, m: number) => {
    const d = new Date(viewYear, viewMonth, day, h, m)
    onChange(d.toISOString().slice(0, 16))
  }, [viewYear, viewMonth, onChange])

  const selectDay = (day: number) => {
    commitDate(day, hour, minute)
    if (!showTime) setOpen(false)
  }

  const isSelected = (day: number) => parsed && parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth && parsed.getDate() === day
  const isToday = (day: number) => { const n = new Date(); return n.getFullYear() === viewYear && n.getMonth() === viewMonth && n.getDate() === day }

  const prevMonth = () => { if (viewMonth === 0) { setViewMonth(11); setViewYear(viewYear - 1) } else setViewMonth(viewMonth - 1) }
  const nextMonth = () => { if (viewMonth === 11) { setViewMonth(0); setViewYear(viewYear + 1) } else setViewMonth(viewMonth + 1) }

  const formatDisplay = () => {
    if (!parsed) return ''
    const d = parsed.getDate().toString().padStart(2, '0')
    const mo = (parsed.getMonth() + 1).toString().padStart(2, '0')
    const y = parsed.getFullYear()
    const time = showTime ? ` ${parsed.getHours().toString().padStart(2, '0')}:${parsed.getMinutes().toString().padStart(2, '0')}` : ''
    return locale === 'ar' ? `${y}/${mo}/${d}${time}` : `${d}.${mo}.${y}${time}`
  }

  const monthNames = MONTHS[locale] ?? MONTHS.de
  const dayNames = DAYS[locale] ?? DAYS.de

  return (
    <div ref={ref} className="relative">
      <button ref={triggerRef} type="button" onClick={() => setOpen(!open)}
        className={`flex items-center w-full h-10 px-3 rounded-xl border bg-background text-sm transition-all gap-2 ${
          open ? 'border-[#d4a853] ring-2 ring-[#d4a853]/20' : 'hover:border-[#d4a853]/50'
        }`}>
        <Calendar className="h-4 w-4 text-[#d4a853] flex-shrink-0" />
        <span className={`flex-1 text-start truncate ${parsed ? 'text-foreground' : 'text-muted-foreground'}`}>
          {formatDisplay() || placeholder || defaultPh}
        </span>
        {value && (
          <span onClick={(e) => { e.stopPropagation(); onChange(''); setOpen(false) }} className="p-0.5 hover:bg-muted rounded-full">
            <X className="h-3.5 w-3.5 text-muted-foreground" />
          </span>
        )}
      </button>

      {open && (
        <div className={`absolute z-[60] bg-background border rounded-2xl shadow-2xl overflow-hidden ${
          openUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
        } ltr:left-0 rtl:right-0`}
          style={{ animation: openUp ? 'dtpUp 200ms ease-out' : 'dtpDown 200ms ease-out', width: showTime ? '360px' : '280px' }}>

          <div className="flex">
            {/* Calendar */}
            <div className="flex-1 p-3">
              <div className="flex items-center justify-between mb-2">
                <button type="button" onClick={prevMonth} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center">
                  <ChevronLeft className="h-4 w-4 rtl:rotate-180" />
                </button>
                <span className="text-sm font-bold">{monthNames[viewMonth]} {viewYear}</span>
                <button type="button" onClick={nextMonth} className="h-7 w-7 rounded-lg hover:bg-muted flex items-center justify-center">
                  <ChevronRight className="h-4 w-4 rtl:rotate-180" />
                </button>
              </div>

              <div className="grid grid-cols-7 mb-1">
                {dayNames.map((d) => <div key={d} className="text-center text-[10px] font-semibold text-muted-foreground/50 py-1">{d}</div>)}
              </div>

              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstDow }).map((_, i) => <div key={`e${i}`} className="h-8" />)}
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                  <button key={day} type="button" onClick={() => selectDay(day)}
                    className={`h-8 w-8 mx-auto rounded-lg text-xs font-medium transition-all ${
                      isSelected(day) ? 'bg-[#d4a853] text-white shadow-sm font-bold' :
                      isToday(day) ? 'ring-1 ring-[#d4a853]/40 text-[#d4a853] font-bold' :
                      'hover:bg-muted'
                    }`}>
                    {day}
                  </button>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between mt-2 pt-2 border-t">
                <button type="button" onClick={() => {
                  const now = new Date()
                  setViewYear(now.getFullYear()); setViewMonth(now.getMonth())
                  setHour(now.getHours()); setMinute(now.getMinutes())
                  commitDate(now.getDate(), now.getHours(), now.getMinutes())
                  setOpen(false)
                }} className="text-xs text-[#d4a853] font-semibold hover:underline">
                  {locale === 'ar' ? 'الآن' : locale === 'en' ? 'Now' : 'Jetzt'}
                </button>
                <button type="button" onClick={() => setOpen(false)}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#d4a853] text-white hover:bg-[#c49843] transition-colors">
                  {locale === 'ar' ? 'تم' : locale === 'en' ? 'Done' : 'Fertig'}
                </button>
              </div>
            </div>

            {/* Time — always visible next to calendar */}
            {showTime && (
              <div className="w-[90px] border-s flex flex-col bg-muted/20">
                <div className="flex items-center justify-center gap-1 py-2 border-b">
                  <Clock className="h-3 w-3 text-[#d4a853]" />
                  <span className="text-[10px] font-bold text-muted-foreground">
                    {locale === 'ar' ? 'الوقت' : locale === 'en' ? 'Time' : 'Uhrzeit'}
                  </span>
                </div>
                <div className="flex-1 overflow-y-auto" style={{ maxHeight: '260px' }}>
                  {Array.from({ length: 24 * 4 }, (_, i) => {
                    const h = Math.floor(i / 4)
                    const m = (i % 4) * 15
                    const active = hour === h && minute === m
                    return (
                      <button key={i} type="button" onClick={() => {
                        setHour(h); setMinute(m)
                        if (parsed) commitDate(parsed.getDate(), h, m)
                        else { const now = new Date(); commitDate(now.getDate(), h, m) }
                      }}
                        className={`w-full py-1.5 text-xs font-mono text-center transition-all ${
                          active ? 'bg-[#d4a853] text-white font-bold' : 'hover:bg-muted'
                        }`}>
                        {h.toString().padStart(2, '0')}:{m.toString().padStart(2, '0')}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <style>{`
        @keyframes dtpDown{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes dtpUp{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
      `}</style>
    </div>
  )
}
