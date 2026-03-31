'use client'

import { useState, useCallback, createContext, useContext, ReactNode } from 'react'
import { AlertTriangle, Trash2, X, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

// ── Types ────────────────────────────────────────────────────

interface ConfirmOptions {
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  variant?: 'default' | 'danger' | 'destructive'
  /** For destructive: user must type this to confirm */
  typeToConfirm?: string
  /** Custom label for "Type X to confirm" instruction */
  typeToConfirmLabel?: string
}

interface ConfirmContextType {
  confirm: (options: ConfirmOptions) => Promise<boolean>
}

const ConfirmContext = createContext<ConfirmContextType | null>(null)

// ── Hook ─────────────────────────────────────────────────────

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx.confirm
}

// ── Provider ─────────────────────────────────────────────────

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    options: ConfirmOptions
    resolve: (value: boolean) => void
  } | null>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ options, resolve })
    })
  }, [])

  const handleConfirm = () => {
    state?.resolve(true)
    setState(null)
  }

  const handleCancel = () => {
    state?.resolve(false)
    setState(null)
  }

  return (
    <ConfirmContext.Provider value={{ confirm }}>
      {children}
      {state && (
        state.options.variant === 'destructive'
          ? <DestructiveModal options={state.options} onConfirm={handleConfirm} onCancel={handleCancel} />
          : <StandardModal options={state.options} onConfirm={handleConfirm} onCancel={handleCancel} />
      )}
    </ConfirmContext.Provider>
  )
}

// ── Standard Confirm Modal (Stufe 2) ─────────────────────────

function StandardModal({ options, onConfirm, onCancel }: {
  options: ConfirmOptions; onConfirm: () => void; onCancel: () => void
}) {
  const isDanger = options.variant === 'danger'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onCancel} style={{ animation: 'cmFadeIn 150ms ease-out' }} />
      <div className="relative bg-background rounded-2xl p-6 w-full max-w-sm shadow-2xl" style={{ animation: 'cmSlideUp 200ms ease-out' }}>
        <button onClick={onCancel} className="absolute top-4 ltr:right-4 rtl:left-4 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>

        <div className="flex flex-col items-center text-center mb-5">
          <div className={`h-12 w-12 rounded-full flex items-center justify-center mb-3 ${isDanger ? 'bg-red-100' : 'bg-orange-100'}`}>
            {isDanger ? <ShieldAlert className="h-5 w-5 text-red-600" /> : <AlertTriangle className="h-5 w-5 text-orange-600" />}
          </div>
          <h3 className="text-lg font-bold">{options.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{options.description}</p>
        </div>

        <div className="flex gap-3">
          <Button
            className={`flex-1 rounded-xl ${isDanger ? 'bg-red-600 hover:bg-red-700 text-white' : ''}`}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? 'Bestätigen'}
          </Button>
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onCancel}>
            {options.cancelLabel ?? 'Abbrechen'}
          </Button>
        </div>
      </div>
      <style>{`
        @keyframes cmFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cmSlideUp { from { opacity: 0; transform: translateY(8px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>
  )
}

// ── Destructive Confirm Modal (Stufe 3) ──────────────────────

function DestructiveModal({ options, onConfirm, onCancel }: {
  options: ConfirmOptions; onConfirm: () => void; onCancel: () => void
}) {
  const [typed, setTyped] = useState('')
  const canConfirm = options.typeToConfirm ? typed === options.typeToConfirm : true

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} style={{ animation: 'cmFadeIn 150ms ease-out' }} />
      <div className="relative bg-background rounded-2xl p-6 w-full max-w-sm shadow-2xl border-2 border-red-200" style={{ animation: 'cmSlideUp 200ms ease-out' }}>
        <div className="flex flex-col items-center text-center mb-5">
          <div className="h-14 w-14 rounded-full bg-red-100 flex items-center justify-center mb-3">
            <Trash2 className="h-6 w-6 text-red-600" />
          </div>
          <h3 className="text-lg font-bold text-red-900">{options.title}</h3>
          <p className="text-sm text-muted-foreground mt-1">{options.description}</p>
        </div>

        {options.typeToConfirm && (
          <div className="mb-4 text-center">
            <p className="text-xs text-muted-foreground mb-2">
              {options.typeToConfirmLabel}
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={options.typeToConfirm}
              className="rounded-xl text-center border-red-200 focus-visible:ring-red-300"
              autoFocus
              dir="ltr"
            />
          </div>
        )}

        <div className="flex gap-3">
          <Button
            className="flex-1 rounded-xl bg-red-600 hover:bg-red-700 text-white"
            disabled={!canConfirm}
            onClick={onConfirm}
          >
            {options.confirmLabel ?? 'Endgültig löschen'}
          </Button>
          <Button variant="outline" className="flex-1 rounded-xl" onClick={onCancel}>
            {options.cancelLabel ?? 'Abbrechen'}
          </Button>
        </div>
      </div>
      <style>{`
        @keyframes cmFadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes cmSlideUp { from { opacity: 0; transform: translateY(8px) scale(0.97) } to { opacity: 1; transform: translateY(0) scale(1) } }
      `}</style>
    </div>
  )
}
