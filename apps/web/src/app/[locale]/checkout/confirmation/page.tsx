'use client'

import { Suspense, useState, useEffect, useRef } from 'react'
import { useSearchParams } from 'next/navigation'
import { useLocale, useTranslations } from 'next-intl'
import Link from 'next/link'
import Image from 'next/image'
import {
  CheckCircle2, Package, ArrowRight, Copy, Mail, Truck, ShoppingBag,
  Shield, RotateCcw, MapPin, CreditCard, Clock, Home, Share2, Printer,
  UserPlus, Zap, Heart, Star, Lock, Eye, EyeOff,
} from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth-store'
import { useCartStore } from '@/store/cart-store'

/* ── Confetti Canvas ──────────────────────────────────── */
function ConfettiCanvas() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    c.width = window.innerWidth; c.height = window.innerHeight
    const colors = ['#D4AF37', '#C0392B', '#2ECC71', '#3498DB', '#9B59B6', '#F39C12']
    const particles = Array.from({ length: 80 }, () => ({
      x: Math.random() * c.width, y: -20 - Math.random() * 200,
      w: 4 + Math.random() * 8, h: 4 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 3, vy: 2 + Math.random() * 4,
      rot: Math.random() * 360, vr: (Math.random() - 0.5) * 8, opacity: 1,
    }))
    let frame = 0
    const animate = () => {
      frame++
      ctx.clearRect(0, 0, c.width, c.height)
      for (const p of particles) {
        p.x += p.vx; p.y += p.vy; p.rot += p.vr
        if (frame > 60) p.opacity = Math.max(0, p.opacity - 0.015)
        ctx.save(); ctx.globalAlpha = p.opacity
        ctx.translate(p.x, p.y); ctx.rotate((p.rot * Math.PI) / 180)
        ctx.fillStyle = p.color; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      if (frame < 180) requestAnimationFrame(animate)
    }
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    if (!mq.matches) animate()
    return () => { frame = 999 }
  }, [])
  return <canvas ref={ref} className="fixed inset-0 z-50 pointer-events-none" />
}

/* ── Counter Animation ────────────────────────────────── */
function AnimatedPrice({ value, delay = 0 }: { value: number; delay?: number }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    const timer = setTimeout(() => {
      let start = 0; const end = value; const duration = 800; const t0 = Date.now()
      const step = () => {
        const progress = Math.min((Date.now() - t0) / duration, 1)
        const eased = 1 - Math.pow(1 - progress, 3)
        setDisplay(start + (end - start) * eased)
        if (progress < 1) requestAnimationFrame(step)
      }
      step()
    }, delay)
    return () => clearTimeout(timer)
  }, [value, delay])
  return <>{display.toFixed(2)}</>
}

/* ── Main ─────────────────────────────────────────────── */
function ConfirmationContent() {
  const locale = useLocale()
  const t = useTranslations('checkout.confirmation')
  const searchParams = useSearchParams()
  const orderNumber = searchParams.get('order')
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const [copied, setCopied] = useState(false)
  const [phase, setPhase] = useState(0)

  // Clear cart on load
  const clearCart = useCartStore((s) => s.clearCart)
  useEffect(() => { clearCart() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Read saved order data from sessionStorage (set by step-payment before redirect)
  const [savedOrder, setSavedOrder] = useState<any>(null)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem('malak-last-order')
      if (raw) {
        setSavedOrder(JSON.parse(raw))
        sessionStorage.removeItem('malak-last-order') // One-time read
      }
    } catch {}
  }, [])

  // Optionally fetch full order from API (for logged-in users)
  const { data: fetchedOrder } = useQuery({
    queryKey: ['order-confirmation', orderNumber],
    queryFn: async () => {
      const { data } = await api.get('/users/me/orders')
      const orders = data?.items ?? data ?? []
      return orders.find((o: any) => o.orderNumber === orderNumber) ?? null
    },
    enabled: !!orderNumber && isAuthenticated,
    staleTime: Infinity,
  })

  const order = fetchedOrder ?? savedOrder

  // Animations
  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 300),
      setTimeout(() => setPhase(2), 1200),
      setTimeout(() => setPhase(3), 2000),
      setTimeout(() => setPhase(4), 2800),
    ]
    return () => timers.forEach(clearTimeout)
  }, [])

  const copyOrder = () => {
    navigator.clipboard.writeText(orderNumber ?? '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const TIMELINE = [
    { Icon: CheckCircle2, label: t('timeline.ordered'), active: true, color: 'text-green-600', bg: 'bg-green-100' },
    { Icon: Clock, label: t('timeline.preparing'), active: false, color: 'text-muted-foreground', bg: 'bg-muted' },
    { Icon: Package, label: t('timeline.shipping'), active: false, color: 'text-muted-foreground', bg: 'bg-muted' },
    { Icon: Home, label: t('timeline.delivered'), active: false, color: 'text-muted-foreground', bg: 'bg-muted' },
  ]

  // No order number at all → show minimal confirmation
  if (!orderNumber && !order) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center text-center px-4">
        <div>
          <div className="h-20 w-20 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-6">
            <CheckCircle2 className="h-10 w-10 text-green-600" />
          </div>
          <h1 className="text-2xl font-semibold mb-4">{t('title')}</h1>
          <Link href={`/${locale}/products`}><Button size="lg">{t('continueShopping')}</Button></Link>
        </div>
      </div>
    )
  }

  return (
    <>
      <ConfettiCanvas />

      <style>{`
        @keyframes shimmer-gold { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes float-gentle { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-6px)} }
        @keyframes line-draw { from{width:0} to{width:100%} }
        @keyframes pulse-ring { 0%{box-shadow:0 0 0 0 rgba(212,175,55,0.4)} 70%{box-shadow:0 0 0 10px rgba(212,175,55,0)} 100%{box-shadow:0 0 0 0 rgba(212,175,55,0)} }
        @keyframes icon-spin { from{transform:rotate(0)} to{transform:rotate(360deg)} }
        @keyframes shimmer-btn { 0%{background-position:-200% 0} 100%{background-position:200% 0} }
        @keyframes arrow-nudge { 0%,100%{transform:translateX(0)} 50%{transform:translateX(4px)} }
        @keyframes bg-shift { 0%{background-position:0% 50%} 50%{background-position:100% 50%} 100%{background-position:0% 50%} }
        @keyframes particle-rise { 0%{transform:translateY(0) scale(1);opacity:0.6} 100%{transform:translateY(-80px) scale(0);opacity:0} }
        .shimmer-gold{background:linear-gradient(90deg,#D4AF37 0%,#F5E6A3 50%,#D4AF37 100%);background-size:200% 100%;animation:shimmer-gold 2s ease-in-out 1;-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .float-gentle{animation:float-gentle 3s ease-in-out infinite}
        .pulse-ring{animation:pulse-ring 2s ease-out infinite}
        .icon-spin-once{animation:icon-spin 0.6s ease-out}
        .btn-shimmer{background:linear-gradient(90deg,transparent 0%,rgba(255,255,255,0.15) 50%,transparent 100%),var(--tw-gradient-stops);background-size:200% 100%;animation:shimmer-btn 3s infinite}
        .arrow-nudge{animation:arrow-nudge 1.5s ease-in-out infinite}
        .bg-celebration{background:linear-gradient(135deg,hsl(var(--background)),hsl(40 30% 97%),hsl(var(--background)));background-size:300% 300%;animation:bg-shift 8s ease infinite}
        @media(prefers-reduced-motion:reduce){.shimmer-gold,.float-gentle,.pulse-ring,.icon-spin-once,.btn-shimmer,.arrow-nudge,.bg-celebration{animation:none!important}}
      `}</style>

      <div className="mx-auto max-w-3xl px-4 py-12 sm:py-16 min-h-screen">
        {/* Phase 1: Checkmark */}
        <div className={`text-center mb-10 transition-all duration-700 ${phase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="flex justify-center mb-6">
            <div className={`h-28 w-28 rounded-full bg-green-100 flex items-center justify-center transition-all duration-500 ${phase >= 1 ? 'scale-100' : 'scale-0'}`}>
              <svg viewBox="0 0 52 52" className="h-14 w-14">
                <circle cx="26" cy="26" r="24" fill="none" stroke="#16a34a" strokeWidth="2" opacity="0.3" />
                <path d="M14 27l8 8 16-16" fill="none" stroke="#16a34a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  style={{ strokeDasharray: 100, strokeDashoffset: phase >= 1 ? 0 : 100, transition: 'stroke-dashoffset 0.8s ease-out 0.3s' }} />
              </svg>
            </div>
          </div>

          <h1 className={`text-3xl sm:text-4xl font-semibold mb-3 transition-all duration-700 delay-300 ${phase >= 1 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
            {t('title')}
          </h1>

          {orderNumber && (
            <button onClick={copyOrder}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-full shimmer-gold text-lg font-mono font-bold transition-all duration-500 delay-500 hover:scale-105 ${phase >= 1 ? 'opacity-100' : 'opacity-0'}`}>
              {orderNumber}
              <span className={`transition-colors ${copied ? 'text-green-600' : ''}`} style={{ WebkitTextFillColor: copied ? '#16a34a' : undefined }}>
                {copied ? <CheckCircle2 className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </span>
            </button>
          )}
        </div>

        {/* Phase 2: Timeline */}
        <div className={`mb-10 transition-all duration-700 ${phase >= 2 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="flex items-center justify-between max-w-lg mx-auto" dir="ltr">
            {TIMELINE.map((step, i) => (
              <div key={i} className="flex flex-col items-center flex-1 relative">
                {i > 0 && (
                  <div className="absolute top-5 right-1/2 w-full h-0.5 -translate-y-1/2 bg-muted overflow-hidden" style={{ left: '-50%', zIndex: 0 }}>
                    {step.active && <div className="h-full bg-green-500" style={{ animation: 'line-draw 0.5s ease-out forwards', animationDelay: `${i * 200}ms` }} />}
                  </div>
                )}
                <div className={`relative z-10 h-10 w-10 rounded-full ${step.active ? step.bg : 'bg-muted'} flex items-center justify-center transition-all duration-300 ${step.active && i === 0 ? 'pulse-ring' : ''}`}
                  style={{ transitionDelay: `${i * 150}ms` }}>
                  <step.Icon className={`h-5 w-5 ${step.active ? step.color : 'text-muted-foreground'} ${step.active && i === 0 ? 'float-gentle' : ''}`} />
                </div>
                <span className={`text-xs mt-2 font-medium text-center ${step.active ? 'text-foreground' : 'text-muted-foreground'}`}>{step.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Phase 3: Order Details */}
        <div className={`space-y-4 transition-all duration-700 ${phase >= 3 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          {/* Items */}
          {order?.items && order.items.length > 0 && (
            <div className="bg-background border rounded-2xl p-5 shadow-sm">
              <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm"><Package className="h-4 w-4 text-muted-foreground" />{t('items')}</h3>
              <div className="space-y-3">
                {order.items.map((item: any, idx: number) => (
                  <div key={item.id} className="flex items-center gap-3 transition-all duration-300" style={{ transitionDelay: `${idx * 80}ms` }}>
                    <div className="w-14 h-14 bg-muted rounded-xl overflow-hidden flex-shrink-0">
                      {item.variant?.product?.images?.[0]?.url && (
                        <Image src={item.variant.product.images[0].url} alt="" width={56} height={56} className="w-full h-full object-cover" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{item.snapshotName}</p>
                      <p className="text-xs text-muted-foreground">{item.variant?.color}{item.variant?.size ? ` / ${item.variant.size}` : ''} x {item.quantity}</p>
                    </div>
                    <span className="text-sm font-mono font-medium">&euro;<AnimatedPrice value={Number(item.totalPrice)} delay={300 + idx * 100} /></span>
                  </div>
                ))}
              </div>
              <div className="border-t mt-4 pt-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">{t('subtotal')}</span><span className="font-mono">&euro;{Number(order.subtotal).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('shipping')}</span><span className="font-mono">&euro;{Number(order.shippingCost).toFixed(2)}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">{t('tax')}</span><span className="font-mono">&euro;{Number(order.taxAmount).toFixed(2)}</span></div>
                <div className="flex justify-between font-semibold text-lg pt-2 border-t">
                  <span>{t('total')}</span>
                  <span className="font-mono">&euro;<AnimatedPrice value={Number(order.totalAmount)} delay={800} /></span>
                </div>
              </div>
            </div>
          )}

          {/* Delivery + Payment */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {order?.shippingAddress && (
              <div className="bg-background border rounded-2xl p-5 shadow-sm group hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-3">
                  <div className="h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:scale-110 transition-transform"><MapPin className="h-4 w-4 text-blue-600" /></div>
                  <h3 className="font-semibold text-sm">{t('deliveryAddress')}</h3>
                </div>
                <div className="text-sm text-muted-foreground space-y-0.5 ltr:ml-10 rtl:mr-10">
                  <p className="font-medium text-foreground">{order.shippingAddress.firstName} {order.shippingAddress.lastName}</p>
                  <p>{order.shippingAddress.street} {order.shippingAddress.houseNumber}</p>
                  <p>{order.shippingAddress.postalCode} {order.shippingAddress.city}</p>
                </div>
                <p className="text-xs text-muted-foreground mt-3 ltr:ml-10 rtl:mr-10 flex items-center gap-1"><Truck className="h-3 w-3" />{t('deliveryTime')}</p>
              </div>
            )}
            <div className="bg-background border rounded-2xl p-5 shadow-sm group hover:shadow-md transition-shadow">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-8 w-8 rounded-full bg-green-50 flex items-center justify-center group-hover:scale-110 transition-transform"><CreditCard className="h-4 w-4 text-green-600" /></div>
                <h3 className="font-semibold text-sm">{t('paymentInfo')}</h3>
              </div>
              <div className="text-sm text-muted-foreground space-y-1 ltr:ml-10 rtl:mr-10">
                <p>{t('paymentMethod')}: <span className="font-medium text-foreground">{order?.payment?.method ?? t('cardPayment')}</span></p>
                <p className="flex items-center gap-1 text-green-600 font-medium"><CheckCircle2 className="h-3.5 w-3.5" />{t('paid')}</p>
              </div>
            </div>
          </div>

          {/* What's Next */}
          <div className="bg-muted/30 rounded-2xl p-5">
            <h3 className="font-semibold mb-4">{t('whatsNext')}</h3>
            <div className="space-y-4">
              {[
                { Icon: Mail, text: t('emailSent'), bg: 'bg-purple-50', color: 'text-purple-600' },
                { Icon: Package, text: t('preparing'), bg: 'bg-orange-50', color: 'text-orange-600' },
                { Icon: Truck, text: t('trackingEmail'), bg: 'bg-blue-50', color: 'text-blue-600' },
              ].map(({ Icon, text, bg, color }, i) => (
                <div key={i} className="flex items-start gap-3 group transition-all duration-500" style={{ transitionDelay: `${3200 + i * 200}ms`, opacity: phase >= 3 ? 1 : 0, transform: phase >= 3 ? 'translateY(0)' : 'translateY(12px)' }}>
                  <div className={`h-9 w-9 rounded-full ${bg} flex items-center justify-center flex-shrink-0 group-hover:scale-110 transition-transform`}>
                    <Icon className={`h-4 w-4 ${color} ${phase >= 3 ? 'icon-spin-once' : ''}`} style={{ animationDelay: `${3200 + i * 200}ms` }} />
                  </div>
                  <span className="text-sm pt-1.5">{text}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Account Invitation (guests only) */}
        {!isAuthenticated && (
          <AccountInvitation
            email={order?.guestEmail ?? order?.email ?? savedOrder?.guestEmail ?? ''}
            firstName={(() => { try { return JSON.parse(order?.notes ?? '{}').guestFirstName } catch { return savedOrder?.guestFirstName ?? '' } })()}
            lastName={(() => { try { return JSON.parse(order?.notes ?? '{}').guestLastName } catch { return savedOrder?.guestLastName ?? '' } })()}
            phase={phase}
          />
        )}

        {/* Phase 4: CTAs */}
        <div className={`mt-8 space-y-4 transition-all duration-700 ${phase >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
          <div className="flex flex-col sm:flex-row gap-3">
            <Link href={`/${locale}/products`} className="flex-1">
              <Button size="lg" className="w-full gap-2 h-14 text-base font-semibold btn-press bg-foreground text-background hover:bg-foreground/90 hover:scale-[1.02] hover:shadow-xl active:scale-[0.97] transition-all duration-200 rounded-xl">
                <ShoppingBag className="h-5 w-5" />{t('continueShopping')}
              </Button>
            </Link>
            {isAuthenticated ? (
              <Link href={`/${locale}/account/orders`} className="flex-1">
                <Button size="lg" variant="outline" className="w-full gap-2 h-14 text-base font-semibold btn-press border-2 hover:bg-muted hover:scale-[1.02] hover:shadow-lg active:scale-[0.97] transition-all duration-200 rounded-xl">
                  {t('myOrders')}<ArrowRight className="h-4 w-4 arrow-nudge" />
                </Button>
              </Link>
            ) : orderNumber ? (
              <Link href={`/${locale}/tracking?mode=order&orderNumber=${orderNumber}`} className="flex-1">
                <Button size="lg" variant="outline" className="w-full gap-2 h-14 text-base font-semibold btn-press border-2 hover:bg-muted hover:scale-[1.02] hover:shadow-lg active:scale-[0.97] transition-all duration-200 rounded-xl">
                  {t('trackOrder')}<ArrowRight className="h-4 w-4 arrow-nudge" />
                </Button>
              </Link>
            ) : null}
          </div>
          <div className="flex gap-3">
            <Button variant="ghost" size="sm" className="flex-1 gap-2 btn-press" onClick={() => window.print()}>
              <Printer className="h-4 w-4" />{t('print')}
            </Button>
            <Button variant="ghost" size="sm" className="flex-1 gap-2 btn-press" onClick={() => {
              if (navigator.share) navigator.share({ title: 'Malak Bekleidung', text: t('shareText'), url: window.location.origin })
            }}>
              <Share2 className="h-4 w-4" />{t('share')}
            </Button>
          </div>

          {/* Trust */}
          <div className="flex items-center justify-center gap-6 pt-4 text-xs text-muted-foreground">
            {[
              { Icon: RotateCcw, text: t('trustReturn') },
              { Icon: Shield, text: t('trustSecure') },
              { Icon: Truck, text: t('trustShipping') },
            ].map(({ Icon, text }, i) => (
              <span key={i} className="flex items-center gap-1.5"><Icon className="h-4 w-4" />{text}</span>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}

/* ── Account Invitation (Guests only) ─── */
function AccountInvitation({ email, firstName, lastName, phase }: {
  email: string; firstName: string; lastName: string; phase: number
}) {
  const t = useTranslations('checkout.confirmation')
  const locale = useLocale()
  const [showForm, setShowForm] = useState(false)
  const [formEmail] = useState(email)
  const [pw, setPw] = useState('')
  const [showPw, setShowPw] = useState(false)
  const [done, setDone] = useState(false)
  const [errors, setErrors] = useState<string[]>([])
  const [loading, setLoading] = useState(false)

  const handleRegister = async () => {
    setErrors([])
    if (pw.length < 8) { setErrors([t('invite.pwMin')]); return }
    setLoading(true)
    try {
      await api.post('/auth/register', {
        email: formEmail, firstName: firstName || 'Guest', lastName: lastName || '-',
        password: pw, gdprConsent: true,
      })
      setDone(true)
    } catch (e: any) {
      const msg = e?.response?.data?.message
      // Parse error messages — could be string, array, or i18n object
      if (Array.isArray(msg)) {
        setErrors(msg)
      } else if (typeof msg === 'object' && msg !== null) {
        setErrors([msg[locale] ?? msg.de ?? msg.en ?? JSON.stringify(msg)])
      } else if (typeof msg === 'string') {
        setErrors([msg])
      } else {
        setErrors([t('invite.error')])
      }
    }
    setLoading(false)
  }

  if (done) {
    return (
      <div className={`bg-green-50 border border-green-200 rounded-2xl p-6 text-center transition-all duration-700 ${phase >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
        <CheckCircle2 className="h-10 w-10 text-green-600 mx-auto mb-3" />
        <p className="font-semibold text-green-800">{t('invite.success')}</p>
      </div>
    )
  }

  return (
    <div className={`bg-accent/5 border border-accent/20 rounded-2xl p-6 transition-all duration-700 ${phase >= 4 ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
      <div className="flex items-start gap-4">
        <div className="h-12 w-12 rounded-full bg-accent/10 flex items-center justify-center flex-shrink-0">
          <UserPlus className="h-6 w-6 text-accent" />
        </div>
        <div className="flex-1">
          <h3 className="font-semibold text-lg mb-2">{t('invite.title')}</h3>
          <div className="space-y-2 mb-4">
            {[
              { Icon: Zap, text: t('invite.benefit1') },
              { Icon: Package, text: t('invite.benefit2') },
              { Icon: Heart, text: t('invite.benefit3') },
              { Icon: Star, text: t('invite.benefit4') },
            ].map(({ Icon, text }, i) => (
              <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-accent flex-shrink-0" />
                <span>{text}</span>
              </div>
            ))}
          </div>

          {!showForm ? (
            <div className="flex gap-3">
              <Button size="sm" className="gap-2 btn-press bg-accent text-accent-foreground hover:bg-accent/90" onClick={() => setShowForm(true)}>
                <UserPlus className="h-4 w-4" />{t('invite.createAccount')}
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground">{t('invite.noThanks')}</Button>
            </div>
          ) : (
            <div className="space-y-3 max-w-sm">
              {/* Email — shown as text, not editable */}
              <p className="text-sm text-muted-foreground">{t('invite.accountFor')} <strong className="text-foreground">{formEmail}</strong></p>

              {/* Password with eye toggle */}
              <div className="relative">
                <Lock className="absolute left-3 rtl:left-auto rtl:right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  type={showPw ? 'text' : 'password'}
                  value={pw}
                  onChange={(e) => { setPw(e.target.value); setErrors([]) }}
                  placeholder={t('invite.password')}
                  className="ltr:pl-10 ltr:pr-10 rtl:pr-10 rtl:pl-10"
                />
                <button type="button" onClick={() => setShowPw(!showPw)}
                  className="absolute right-3 rtl:right-auto rtl:left-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors">
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              {/* Errors — each on its own line */}
              {errors.length > 0 && (
                <div className="space-y-1">
                  {errors.map((err, i) => (
                    <p key={i} className="text-xs text-destructive">{err}</p>
                  ))}
                </div>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={handleRegister} disabled={!pw || !formEmail || loading} className="gap-2 btn-press bg-accent text-accent-foreground">
                  {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent-foreground border-t-transparent" /> : null}
                  {t('invite.createAccount')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>{t('invite.cancel')}</Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ConfirmationPage() {
  return (
    <Suspense fallback={<div className="min-h-[60vh] flex items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" /></div>}>
      <ConfirmationContent />
    </Suspense>
  )
}
