'use client'

import { API_BASE_URL } from '@/lib/env'
import { useState, useRef, useEffect } from 'react'
import { useLocale } from 'next-intl'
import { useQuery, useMutation } from '@tanstack/react-query'
import { X, Send, Loader2, MessageSquareText } from 'lucide-react'

const t3 = (l: string, d: string, a: string) => l === 'ar' ? a : d

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  cached?: boolean
}

export function AiChatWidget() {
  const locale = useLocale()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)

  // Check if chat is enabled (public endpoint)
  const { data: settings } = useQuery({
    queryKey: ['ai-public-settings'],
    queryFn: async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/v1/settings/public`)
        if (!res.ok) return {}
        return await res.json()
      } catch { return {} }
    },
    staleTime: 5 * 60 * 1000,
  })

  const isEnabled = settings?.ai_global_enabled === 'true' && settings?.ai_customer_chat_enabled === 'true'

  const chatMut = useMutation({
    mutationFn: async (message: string) => {
      // Send last 6 messages as history for context
      const history = messages.slice(-6).map((m) => ({ role: m.role, content: m.content }))
      const res = await fetch(`${API_BASE_URL}/api/v1/ai/customer-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, lang: locale, history, context: typeof window !== 'undefined' ? window.location.pathname : '' }),
      })
      if (!res.ok) throw new Error('Chat failed')
      return res.json()
    },
    onSuccess: (data) => {
      setMessages((prev) => [...prev, { role: 'assistant', content: data.response, cached: data.cached }])
    },
    onError: () => {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: t3(locale, 'Entschuldigung, es ist ein Fehler aufgetreten. Bitte versuche es später erneut.', 'عذراً، حدث خطأ. يرجى المحاولة لاحقاً.'),
      }])
    },
  })

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages])

  const handleSend = () => {
    const msg = input.trim()
    if (!msg || chatMut.isPending) return
    setMessages((prev) => [...prev, { role: 'user', content: msg }])
    setInput('')
    chatMut.mutate(msg)
  }

  if (!isEnabled) return null

  return (
    <>
      {/* Floating Button — Zalando-style: mid-right, compact square */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed top-1/2 -translate-y-1/2 ltr:right-0 rtl:left-0 z-40 h-12 w-11 rounded-s-xl bg-[#0f1419] text-white shadow-lg flex items-center justify-center hover:bg-[#1a1a2e] transition-colors duration-200 group"
          aria-label="Chat"
        >
          {/* Zalando AI assistant icon — speech bubble + sparkle with hover animation */}
          <svg className="h-[22px] w-[22px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13.4733 5H21V18.2102L16.14 22V18.2102H6V12.2941" />
            <path d="M10 5C7.743 5 6 3.257 6 1C6 3.257 4.257 5 2 5C4.257 5 6 6.743 6 9C6 6.743 7.743 5 10 5Z" className="origin-[6px_5px] group-hover:scale-125 transition-transform duration-300" />
          </svg>
        </button>
      )}

      {/* Chat Window */}
      {open && (
        <div className="fixed bottom-4 ltr:right-4 rtl:left-4 z-50 w-[360px] max-w-[calc(100vw-2rem)] h-[520px] max-h-[calc(100vh-6rem)] bg-white rounded-2xl shadow-2xl flex flex-col overflow-hidden border"
          style={{ animation: 'fadeSlideUp 200ms ease-out' }}
          dir={locale === 'ar' ? 'rtl' : 'ltr'}>

          {/* Header */}
          <div className="bg-[#1a1a2e] text-white px-4 py-3 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center">
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeMiterlimit="10" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M13.4733 5H21V18.2102L16.14 22V18.2102H6V12.2941" />
                  <path d="M10 5C7.743 5 6 3.257 6 1C6 3.257 4.257 5 2 5C4.257 5 6 6.743 6 9C6 6.743 7.743 5 10 5Z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-semibold">Malak {t3(locale, 'Kundenservice', 'خدمة العملاء')}</p>
                <p className="text-[10px] text-white/60">{t3(locale, 'Meistens sofort', 'عادةً فوري')}</p>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="p-1 hover:bg-white/10 rounded-lg"><X className="h-5 w-5" /></button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <MessageSquareText className="h-10 w-10 mx-auto mb-3 text-gray-300" strokeWidth={1} />
                <p className="text-sm text-gray-500">{t3(locale, 'Hallo! Wie kann ich dir helfen?', 'مرحباً! كيف يمكنني مساعدتك؟')}</p>
                <div className="flex flex-wrap justify-center gap-2 mt-4">
                  {[
                    t3(locale, 'Versandkosten?', 'تكاليف الشحن؟'),
                    t3(locale, 'Rückgabe möglich?', 'هل يمكن الإرجاع؟'),
                    t3(locale, 'Zahlungsarten?', 'طرق الدفع؟'),
                  ].map((q) => (
                    <button key={q} onClick={() => { setInput(q); }} className="px-3 py-1.5 text-xs bg-white border rounded-full hover:bg-gray-100 transition-colors">{q}</button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[80%] px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-[#1a1a2e] text-white rounded-br-sm ltr:rounded-br-sm rtl:rounded-bl-sm'
                    : 'bg-white border rounded-bl-sm ltr:rounded-bl-sm rtl:rounded-br-sm shadow-sm'
                }`}>
                  {msg.content.split(/(https?:\/\/[^\s]+)/g).map((part, j) =>
                    part.match(/^https?:\/\//) ? (
                      <a key={j} href={part} target="_blank" rel="noopener noreferrer" className="text-[#d4a853] underline break-all">{part.includes('/products/') ? (locale === 'ar' ? 'عرض المنتج ←' : 'Produkt ansehen →') : part}</a>
                    ) : <span key={j}>{part}</span>
                  )}
                </div>
              </div>
            ))}
            {chatMut.isPending && (
              <div className="flex justify-start">
                <div className="bg-white border rounded-2xl rounded-bl-sm px-4 py-3 shadow-sm">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t bg-white p-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
                placeholder={t3(locale, 'Nachricht schreiben...', 'اكتب رسالتك...')}
                className="flex-1 h-10 px-3 rounded-xl border bg-gray-50 text-sm focus:outline-none focus:ring-2 focus:ring-[#d4a853]/30"
                dir={locale === 'ar' ? 'rtl' : 'ltr'}
                disabled={chatMut.isPending}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || chatMut.isPending}
                className="w-10 h-10 rounded-xl bg-[#0f1419] text-white flex items-center justify-center disabled:opacity-40 hover:bg-[#1a1a2e] transition-colors flex-shrink-0"
              >
                {chatMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
