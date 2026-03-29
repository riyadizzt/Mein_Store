'use client'

import { useEffect, useRef, useState } from 'react'

const GOOGLE_API_KEY = process.env.NEXT_PUBLIC_GOOGLE_PLACES_API_KEY || ''

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

/**
 * Address Autocomplete — uses Google Places API if key is configured.
 * Falls back to a normal input if no API key is set.
 */
export function AddressAutocomplete({ placeholder, value, onChange, onSelect, className }: AddressAutocompleteProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null)
  const [loaded, setLoaded] = useState(false)

  // Load Google Places script
  useEffect(() => {
    if (!GOOGLE_API_KEY || typeof window === 'undefined') return
    if ((window as any).google?.maps?.places) { setLoaded(true); return }

    const existing = document.querySelector('script[src*="maps.googleapis.com"]')
    if (existing) { setLoaded(true); return }

    const script = document.createElement('script')
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places`
    script.async = true
    script.onload = () => setLoaded(true)
    document.head.appendChild(script)
  }, [])

  // Initialize autocomplete
  useEffect(() => {
    if (!loaded || !inputRef.current || autocompleteRef.current) return

    const autocomplete = new google.maps.places.Autocomplete(inputRef.current, {
      types: ['address'],
      componentRestrictions: { country: ['de', 'at', 'ch', 'nl', 'be', 'lu', 'fr', 'pl'] },
      fields: ['address_components'],
    })

    autocomplete.addListener('place_changed', () => {
      const place = autocomplete.getPlace()
      if (!place.address_components) return

      const get = (type: string) =>
        place.address_components?.find((c) => c.types.includes(type))?.long_name ?? ''
      const getShort = (type: string) =>
        place.address_components?.find((c) => c.types.includes(type))?.short_name ?? ''

      onSelect({
        street: get('route'),
        houseNumber: get('street_number'),
        postalCode: get('postal_code'),
        city: get('locality') || get('sublocality') || get('administrative_area_level_2'),
        country: getShort('country'),
      })
    })

    autocompleteRef.current = autocomplete
  }, [loaded, onSelect])

  return (
    <input
      ref={inputRef}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={className}
      autoComplete="street-address"
    />
  )
}
