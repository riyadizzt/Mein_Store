'use client'

import { ShoppingBag } from 'lucide-react'

const CHANNEL_CONFIG: Record<string, { label: string; labelAr: string; color: string; icon: React.ReactNode }> = {
  website: {
    label: 'Website', labelAr: 'الموقع', color: '#d4a853',
    icon: <ShoppingBag className="h-full w-full" />,
  },
  mobile: {
    label: 'Mobile', labelAr: 'الجوال', color: '#8B5CF6',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="2" width="14" height="20" rx="2" /><line x1="12" y1="18" x2="12" y2="18.01" strokeWidth="3" strokeLinecap="round" /></svg>,
  },
  pos: {
    label: 'POS', labelAr: 'نقطة البيع', color: '#6B7280',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M2 10h20" /><path d="M12 4v6" /></svg>,
  },
  facebook: {
    label: 'Facebook', labelAr: 'فيسبوك', color: '#1877F2',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>,
  },
  instagram: {
    label: 'Instagram', labelAr: 'إنستجرام', color: '#E4405F',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>,
  },
  tiktok: {
    label: 'TikTok', labelAr: 'تيك توك', color: '#69C9D0',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.51a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 006.34 6.34 6.34 6.34 0 006.34-6.34V8.98a8.21 8.21 0 004.76 1.52V7.05a4.84 4.84 0 01-1-.36z"/></svg>,
  },
  google: {
    label: 'Google', labelAr: 'جوجل', color: '#EA4335',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 01-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>,
  },
  whatsapp: {
    label: 'WhatsApp', labelAr: 'واتساب', color: '#25D366',
    icon: <svg viewBox="0 0 24 24" className="h-full w-full" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>,
  },
  // C13.4 — Marketplace channel for orders imported from eBay (C12.4 + C12.5).
  // Malak gold (#d4a853) keeps brand-consistency with the rest of the eBay-
  // related UI (admin/marketplaces/ebay, the eBay icon-strip on /admin/products,
  // the marketplace footer block on the invoice PDF). eBay's own brand colors
  // (red/blue/yellow/green wordmark) would clash with our admin chrome.
  ebay: {
    label: 'eBay', labelAr: 'إيباي', color: '#d4a853',
    icon: <ShoppingBag className="h-full w-full" />,
  },
}

export function ChannelIcon({ channel, size = 16 }: { channel: string; size?: number }) {
  const cfg = CHANNEL_CONFIG[channel] ?? CHANNEL_CONFIG.website
  return (
    <div
      className="flex items-center justify-center flex-shrink-0"
      style={{ width: size, height: size, color: cfg.color }}
      title={cfg.label}
    >
      {cfg.icon}
    </div>
  )
}

export function ChannelBadge({ channel, locale = 'de' }: { channel: string; locale?: string }) {
  const cfg = CHANNEL_CONFIG[channel] ?? CHANNEL_CONFIG.website
  const label = locale === 'ar' ? cfg.labelAr : cfg.label
  return (
    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium" style={{ backgroundColor: cfg.color + '18', color: cfg.color }}>
      <span style={{ width: 12, height: 12 }} className="flex items-center justify-center flex-shrink-0">{cfg.icon}</span>
      {label}
    </span>
  )
}

export { CHANNEL_CONFIG }
