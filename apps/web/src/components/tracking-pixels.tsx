'use client'

import Script from 'next/script'
import { useQuery } from '@tanstack/react-query'

async function getPixelIds(): Promise<{ metaPixelId: string; tiktokPixelId: string }> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/settings/public`)
    if (!res.ok) return { metaPixelId: '', tiktokPixelId: '' }
    const data = await res.json()
    return {
      metaPixelId: data?.meta_pixel_id ?? '',
      tiktokPixelId: data?.tiktok_pixel_id ?? '',
    }
  } catch {
    return { metaPixelId: '', tiktokPixelId: '' }
  }
}

export function TrackingPixels() {
  const { data } = useQuery({
    queryKey: ['pixel-ids'],
    queryFn: getPixelIds,
    staleTime: 60 * 60 * 1000, // 1 hour
  })

  const metaId = data?.metaPixelId
  const tiktokId = data?.tiktokPixelId

  return (
    <>
      {/* Meta Pixel */}
      {metaId && (
        <Script id="meta-pixel" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${metaId}');fbq('track','PageView');`}
        </Script>
      )}

      {/* TikTok Pixel */}
      {tiktokId && (
        <Script id="tiktok-pixel" strategy="afterInteractive">
          {`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e};ttq.load=function(e,n){var i="https://analytics.tiktok.com/i18n/pixel/events.js";ttq._i=ttq._i||{};ttq._i[e]=[];ttq._i[e]._u=i;ttq._t=ttq._t||{};ttq._t[e]=+new Date;ttq._o=ttq._o||{};ttq._o[e]=n||{};var o=document.createElement("script");o.type="text/javascript";o.async=!0;o.src=i+"?sdkid="+e+"&lib="+t;var a=document.getElementsByTagName("script")[0];a.parentNode.insertBefore(o,a)};ttq.load('${tiktokId}');ttq.page();}(window,document,'ttq');`}
        </Script>
      )}
    </>
  )
}

// Pixel event helpers — call from product/cart/checkout pages
export function trackMetaEvent(event: string, data?: Record<string, any>) {
  if (typeof window !== 'undefined' && (window as any).fbq) {
    (window as any).fbq('track', event, data)
  }
}

export function trackTikTokEvent(event: string, data?: Record<string, any>) {
  if (typeof window !== 'undefined' && (window as any).ttq) {
    (window as any).ttq.track(event, data)
  }
}
