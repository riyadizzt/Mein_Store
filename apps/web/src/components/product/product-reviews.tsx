'use client'

import { useState } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Star, Loader2, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuthStore } from '@/store/auth-store'

const t3 = (locale: string, d: string, e: string, a: string) => locale === 'ar' ? a : locale === 'en' ? e : d

function StarRating({ rating, size = 16, interactive, onChange }: { rating: number; size?: number; interactive?: boolean; onChange?: (r: number) => void }) {
  const [hover, setHover] = useState(0)
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <button
          key={i}
          type="button"
          disabled={!interactive}
          onClick={() => onChange?.(i)}
          onMouseEnter={() => interactive && setHover(i)}
          onMouseLeave={() => interactive && setHover(0)}
          className={interactive ? 'cursor-pointer' : 'cursor-default'}
        >
          <Star
            style={{ width: size, height: size }}
            className={`transition-colors ${(hover || rating) >= i ? 'fill-[#d4a853] text-[#d4a853]' : 'text-[#e5e5e5]'}`}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  )
}

export function ProductReviews({ productId }: { productId: string }) {
  const locale = useLocale()
  const qc = useQueryClient()
  const { isAuthenticated } = useAuthStore()
  const [showForm, setShowForm] = useState(false)
  const [rating, setRating] = useState(0)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['product-reviews', productId],
    queryFn: async () => { const { data } = await api.get(`/reviews/products/${productId}`); return data },
    staleTime: 60000,
  })

  const submitMut = useMutation({
    mutationFn: async () => {
      await api.post('/reviews', { productId, rating, title: title || undefined, body: body || undefined, language: locale })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-reviews', productId] })
      setShowForm(false); setRating(0); setTitle(''); setBody('')
    },
  })

  const reviews = data?.reviews ?? []
  const stats = data?.stats ?? { averageRating: 0, totalReviews: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } }

  return (
    <section className="py-16 border-t border-[#e5e5e5]">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h2 className={`text-[#0f1419]/50 mb-2 ${locale === 'ar' ? 'text-lg font-semibold' : 'text-base tracking-[0.08em] uppercase'}`}>
            {t3(locale, 'Kundenbewertungen', 'Customer Reviews', 'تقييمات العملاء')}
          </h2>
          {stats.totalReviews > 0 && (
            <div className="flex items-center gap-3">
              <StarRating rating={Math.round(stats.averageRating)} />
              <span className="text-sm text-[#0f1419]/60 tabular-nums">{stats.averageRating} / 5</span>
              <span className="text-sm text-[#0f1419]/30">({stats.totalReviews})</span>
            </div>
          )}
        </div>
        {isAuthenticated && !showForm && (
          <button onClick={() => setShowForm(true)} className="text-sm text-[#d4a853] hover:text-[#c49b45] transition-colors">
            {t3(locale, 'Bewertung schreiben', 'Write Review', 'اكتب تقييماً')}
          </button>
        )}
      </div>

      {/* Rating distribution */}
      {stats.totalReviews > 0 && (
        <div className="flex items-center gap-4 mb-8">
          {[5, 4, 3, 2, 1].map(star => {
            const count = stats.distribution[star] ?? 0
            const pct = stats.totalReviews > 0 ? (count / stats.totalReviews) * 100 : 0
            return (
              <div key={star} className="flex items-center gap-1.5 text-xs text-[#0f1419]/40">
                <span className="tabular-nums w-2">{star}</span>
                <Star className="h-3 w-3 text-[#d4a853] fill-[#d4a853]" />
                <div className="w-16 h-1.5 bg-[#f0f0f0] rounded-full overflow-hidden">
                  <div className="h-full bg-[#d4a853] rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <span className="tabular-nums w-4">{count}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Write review form */}
      {showForm && (
        <div className="mb-8 p-5 bg-[#faf8f5] rounded-xl border border-[#e5e0d8]">
          <h3 className="text-sm font-semibold mb-4">{t3(locale, 'Deine Bewertung', 'Your Review', 'تقييمك')}</h3>
          <div className="space-y-3">
            <div>
              <p className="text-xs text-[#0f1419]/40 mb-1.5">{t3(locale, 'Bewertung', 'Rating', 'التقييم')} *</p>
              <StarRating rating={rating} size={28} interactive onChange={setRating} />
            </div>
            <input
              value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t3(locale, 'Titel (optional)', 'Title (optional)', 'العنوان (اختياري)')}
              className="w-full h-10 px-3 rounded-lg border bg-white text-sm"
            />
            <textarea
              value={body} onChange={e => setBody(e.target.value)}
              placeholder={t3(locale, 'Deine Erfahrung...', 'Your experience...', 'تجربتك...')}
              rows={3}
              className="w-full px-3 py-2.5 rounded-lg border bg-white text-sm resize-none"
            />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowForm(false)} className="text-sm text-[#0f1419]/40 px-4 py-2">{t3(locale, 'Abbrechen', 'Cancel', 'إلغاء')}</button>
              <button
                onClick={() => submitMut.mutate()}
                disabled={rating === 0 || submitMut.isPending}
                className="flex items-center gap-2 px-5 py-2 bg-[#d4a853] text-white text-sm font-medium rounded-lg hover:bg-[#c49b45] transition-colors disabled:opacity-40"
              >
                {submitMut.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                {t3(locale, 'Senden', 'Submit', 'إرسال')}
              </button>
            </div>
            {submitMut.isError && <p className="text-xs text-red-600">{(submitMut.error as any)?.response?.data?.message ?? 'Error'}</p>}
          </div>
        </div>
      )}

      {/* Reviews list */}
      {isLoading ? (
        <div className="space-y-4">{[1, 2].map(i => <div key={i} className="h-24 bg-muted rounded-xl animate-pulse" />)}</div>
      ) : reviews.length === 0 ? (
        <div className="text-center py-8">
          <div className="flex justify-center gap-1 mb-3">{[1, 2, 3, 4, 5].map(i => <Star key={i} className="h-5 w-5 text-[#e5e5e5]" strokeWidth={1.5} />)}</div>
          <p className="text-sm text-[#0f1419]/25">
            {t3(locale, 'Noch keine Bewertungen — sei der Erste!', 'No reviews yet — be the first!', 'لا توجد تقييمات بعد — كن أول من يقيّم!')}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {reviews.map((review: any) => (
            <div key={review.id} className="p-4 bg-white rounded-xl border border-[#e5e5e5]">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <StarRating rating={review.rating} size={14} />
                  {review.title && <span className="text-sm font-semibold text-[#0f1419]">{review.title}</span>}
                </div>
                <span className="text-xs text-[#0f1419]/25 tabular-nums">{new Date(review.createdAt).toLocaleDateString(locale === 'ar' ? 'ar-EG-u-nu-latn' : 'de-DE')}</span>
              </div>
              {review.body && <p className="text-sm text-[#0f1419]/60 leading-relaxed">{review.body}</p>}
              {review.authorName && <p className="text-xs text-[#0f1419]/25 mt-2">— {review.authorName}</p>}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
