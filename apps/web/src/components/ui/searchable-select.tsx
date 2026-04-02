'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, ChevronDown } from 'lucide-react'

interface Option {
  value: string
  label: string
  sublabel?: string
}

interface Props {
  options: Option[]
  value: string
  onChange: (val: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyLabel?: string
}

export function SearchableSelect({ options, value, onChange, placeholder = 'Select...', searchPlaceholder = 'Search...', emptyLabel = 'All' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50)
  }, [open])

  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()) || (o.sublabel ?? '').toLowerCase().includes(query.toLowerCase()))
    : options

  const selected = options.find((o) => o.value === value)

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between w-full h-10 px-3 rounded-xl border bg-background text-sm cursor-pointer hover:border-[#d4a853]/50 transition-colors text-start"
      >
        <span className={selected ? 'text-foreground truncate' : 'text-muted-foreground'}>
          {selected ? selected.label : placeholder}
        </span>
        <div className="flex items-center gap-1 flex-shrink-0">
          {value && (
            <button onClick={(e) => { e.stopPropagation(); onChange(''); setQuery('') }}
              className="p-0.5 hover:bg-muted rounded">
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-180' : ''}`} />
        </div>
      </button>

      {open && (
        <div className="absolute top-full mt-1 z-50 w-full bg-background border rounded-xl shadow-xl overflow-hidden"
          style={{ animation: 'fadeIn 150ms ease-out' }}>
          {/* Search */}
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute ltr:left-2.5 rtl:right-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input ref={inputRef} value={query} onChange={(e) => setQuery(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full h-8 ltr:pl-8 rtl:pr-8 ltr:pr-2 rtl:pl-2 rounded-lg bg-muted/50 text-sm focus:outline-none" />
            </div>
          </div>

          {/* Options */}
          <div className="max-h-[200px] overflow-y-auto">
            {/* "All" option */}
            <button onClick={() => { onChange(''); setOpen(false); setQuery('') }}
              className={`w-full flex items-center px-3 py-2 text-sm text-start hover:bg-muted/50 transition-colors ${!value ? 'bg-[#d4a853]/10 text-[#d4a853] font-medium' : ''}`}>
              {emptyLabel}
            </button>

            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-muted-foreground">Keine Ergebnisse</div>
            ) : (
              filtered.map((opt) => (
                <button key={opt.value} onClick={() => { onChange(opt.value); setOpen(false); setQuery('') }}
                  className={`w-full flex flex-col px-3 py-2 text-start hover:bg-muted/50 transition-colors ${value === opt.value ? 'bg-[#d4a853]/10' : ''}`}>
                  <span className={`text-sm ${value === opt.value ? 'text-[#d4a853] font-medium' : ''}`}>{opt.label}</span>
                  {opt.sublabel && <span className="text-[10px] text-muted-foreground">{opt.sublabel}</span>}
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <style>{`@keyframes fadeIn{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}`}</style>
    </div>
  )
}
