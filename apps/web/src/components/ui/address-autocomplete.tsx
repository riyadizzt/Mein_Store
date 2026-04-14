'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

interface AddressResult {
  street: string
  houseNumber: string
  postalCode: string
  city: string
  country: string
}

interface AddressAutocompleteProps {
  placeholder?: string
  value: string
  onChange: (value: string) => void
  onSelect: (address: AddressResult) => void
  className?: string
}

interface PhotonFeature {
  properties: {
    name?: string
    housenumber?: string
    street?: string
    postcode?: string
    city?: string
    state?: string
    country?: string
    countrycode?: string
    type?: string
  }
}

/**
 * Address Autocomplete — uses Photon API (by Komoot, based on OpenStreetMap).
 * Completely free, no API key needed, no Google dependency.
 * Optimized for DE/AT/CH/NL/BE addresses.
 */
export function AddressAutocomplete({ placeholder, value, onChange, onSelect, className }: AddressAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<PhotonFeature[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const wrapperRef = useRef<HTMLDivElement>(null)
  const onSelectRef = useRef(onSelect)
  onSelectRef.current = onSelect

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Fetch suggestions from Photon API
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.length < 3) {
      setSuggestions([])
      return
    }

    try {
      // Single query without restrictive osm_tag — let Photon return all address types
      const params = new URLSearchParams({
        q: query,
        limit: '10',
        lang: 'de',
        lat: '52.52',   // Berlin (center of main market)
        lon: '13.405',
        bbox: '5.87,47.27,15.04,55.06',  // Germany bounding box (also covers AT/CH/NL/BE)
      })

      const res = await fetch(`https://photon.komoot.io/api/?${params}`)
      const data = await res.json()

      const allFeatures: PhotonFeature[] = data?.features ?? []

      // Filter: only European countries, must have street or name, skip POIs without street
      const filtered = allFeatures
        .filter(f => {
          const cc = f.properties.countrycode?.toUpperCase()
          const hasAddress = f.properties.street || (f.properties.name && f.properties.postcode)
          return ['DE', 'AT', 'CH', 'NL', 'BE', 'LU', 'FR', 'PL'].includes(cc ?? '') && hasAddress
        })
        .slice(0, 6)

      // Deduplicate by street+city+postcode
      const seen = new Set<string>()
      const unique = filtered.filter(f => {
        const key = `${f.properties.street ?? f.properties.name}-${f.properties.city}-${f.properties.postcode}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })

      setSuggestions(unique)
      setShowDropdown(unique.length > 0)
      setActiveIndex(-1)
    } catch {
      setSuggestions([])
    }
  }, [])

  const handleChange = (val: string) => {
    onChange(val)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => fetchSuggestions(val), 300)
  }

  const handleSelect = (feature: PhotonFeature) => {
    const p = feature.properties
    const street = p.street ?? p.name ?? ''
    const houseNumber = p.housenumber ?? ''
    const postalCode = p.postcode ?? ''
    const city = p.city ?? p.state ?? ''
    const country = (p.countrycode ?? 'DE').toUpperCase()

    onChange(street + (houseNumber ? ` ${houseNumber}` : ''))
    setShowDropdown(false)
    setSuggestions([])

    onSelectRef.current({ street, houseNumber, postalCode, city, country })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown || suggestions.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(prev => Math.min(prev + 1, suggestions.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(prev => Math.max(prev - 1, 0))
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault()
      handleSelect(suggestions[activeIndex])
    } else if (e.key === 'Escape') {
      setShowDropdown(false)
    }
  }

  const formatSuggestion = (f: PhotonFeature) => {
    const p = f.properties
    const street = p.street ?? p.name ?? ''
    const nr = p.housenumber ? ` ${p.housenumber}` : ''
    const city = p.city ?? p.state ?? ''
    const plz = p.postcode ?? ''
    return { main: `${street}${nr}`, sub: `${plz} ${city}`.trim() }
  }

  return (
    <div ref={wrapperRef} className="relative">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => { if (suggestions.length > 0) setShowDropdown(true) }}
        onKeyDown={handleKeyDown}
        className={className}
        autoComplete="off"
      />
      {showDropdown && suggestions.length > 0 && (
        <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-background border rounded-xl shadow-lg overflow-hidden" dir="ltr">
          {suggestions.map((f, i) => {
            const { main, sub } = formatSuggestion(f)
            return (
              <button
                key={i}
                type="button"
                className={`w-full text-start px-3 py-2.5 text-sm transition-colors flex items-center justify-between ${
                  i === activeIndex ? 'bg-[#d4a853]/10' : 'hover:bg-muted/50'
                }`}
                onMouseDown={() => handleSelect(f)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="font-medium">{main}</span>
                <span className="text-xs text-muted-foreground">{sub}</span>
              </button>
            )
          })}
          <div className="px-3 py-1 text-[10px] text-muted-foreground/50 text-end border-t">OpenStreetMap</div>
        </div>
      )}
    </div>
  )
}
