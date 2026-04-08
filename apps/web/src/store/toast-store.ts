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
  error: (message: string) =>
    useToastStore.getState().add({ message, type: 'error', duration: 5000 }),
}
