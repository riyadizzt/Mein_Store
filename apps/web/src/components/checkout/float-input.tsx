'use client'

import { useId } from 'react'

interface FloatInputProps {
  label: string
  value: string
  onChange: (value: string) => void
  error?: string
  required?: boolean
  type?: string
  autoComplete?: string
}

export function FloatInput({
  label,
  value,
  onChange,
  error,
  required = true,
  type = 'text',
  autoComplete,
}: FloatInputProps) {
  const id = useId()
  const errorId = `${id}-error`

  return (
    <div>
      <div className="float-field">
        <input
          id={id}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder=" "
          required={required}
          autoComplete={autoComplete}
          aria-invalid={!!error}
          aria-describedby={error ? errorId : undefined}
          className={error ? 'has-error' : ''}
        />
        <label htmlFor={id}>{label}</label>
      </div>
      {error && (
        <p id={errorId} className="text-xs text-destructive mt-1" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

interface FloatSelectProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}

export function FloatSelect({ label, value, onChange, options }: FloatSelectProps) {
  const id = useId()

  return (
    <div className="float-field">
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <label htmlFor={id} className="float-label-up">{label}</label>
    </div>
  )
}
