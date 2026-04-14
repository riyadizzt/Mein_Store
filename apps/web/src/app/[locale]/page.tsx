import { API_BASE_URL } from '@/lib/env'
import { HomeLayoutA } from '@/components/home/layouts/home-layout-a'
import { HomeLayoutB } from '@/components/home/layouts/home-layout-b'
import { HomeLayoutC } from '@/components/home/layouts/home-layout-c'

// Page is dynamic (searchParams + admin-controlled design). bf-cache loss is accepted —
// applies only to homepage; product/account/cart pages still bf-cache normally.
export const dynamic = 'force-dynamic'

type DesignKey = 'A' | 'B' | 'C'

async function getHomepageDesign(): Promise<DesignKey> {
  try {
    const apiBase = API_BASE_URL
    const res = await fetch(`${apiBase}/api/v1/settings/public`, { cache: 'no-store' })
    if (!res.ok) return 'A'
    const data = await res.json()
    const d = data?.homepage_design
    return d === 'B' || d === 'C' ? d : 'A'
  } catch {
    return 'A'
  }
}

export default async function HomePage({
  params: { locale },
  searchParams,
}: {
  params: { locale: string }
  searchParams: { preview?: string }
}) {
  // ── Preview override (admin-only feature, just a query param) ──
  const previewParam = searchParams?.preview
  const isValidPreview = previewParam === 'A' || previewParam === 'B' || previewParam === 'C'

  const design: DesignKey = isValidPreview ? (previewParam as DesignKey) : await getHomepageDesign()

  if (design === 'B') return <HomeLayoutB locale={locale} />
  if (design === 'C') return <HomeLayoutC locale={locale} />
  return <HomeLayoutA locale={locale} />
}
