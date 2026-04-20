import { create } from 'zustand'

export interface Toast {
  id: string
  message: string
  type?: 'success' | 'info' | 'error'
  duration?: number
  undo?: () => void
}

interface ToastStore {
  toasts: Toast[]
  add: (toast: Omit<Toast, 'id'>) => void
  remove: (id: string) => void
}

let counter = 0

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],
  add: (toast) => {
    const id = `toast-${++counter}`
    set((s) => ({ toasts: [...s.toasts, { ...toast, id }] }))
    const duration = toast.duration ?? (toast.undo ? 5000 : 3000)
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, duration)
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Shorthand for adding a toast from anywhere */
export const toast = {
  success: (message: string, opts?: { undo?: () => void }) =>
    useToastStore.getState().add({ message, type: 'success', ...opts }),
  info: (message: string) =>
    useToastStore.getState().add({ message, type: 'info' }),
  // Error toasts stay ~8s — long enough to read a two-sentence message
  // in any language (Arabic tends to have longer line-wraps, so the
  // 5000 default was too tight for real error copy).
  error: (message: string, opts?: { duration?: number }) =>
    useToastStore.getState().add({ message, type: 'error', duration: opts?.duration ?? 8000 }),
}
