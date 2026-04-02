'use client'

import { useState } from 'react'
import { Languages, Check, X, Loader2 } from 'lucide-react'
import { useTranslate } from '@/hooks/use-translate'

interface TranslateButtonProps {
  text: string
  sourceLang: string
  targetLang: string
  locale?: string  // UI language (for button labels)
  onAccept: (translated: string) => void
  size?: 'sm' | 'md'
  label?: string
}

export function TranslateButton({ text, sourceLang, targetLang, locale, onAccept, size = 'sm', label }: TranslateButtonProps) {
  const uiLang = locale ?? sourceLang // UI labels in user's language
  const { translate, isLoading } = useTranslate()
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const [editing, setEditing] = useState('')

  const handleTranslate = async () => {
    const result = await translate(text, sourceLang, targetLang)
    if (result) {
      setSuggestion(result)
      setEditing(result)
    }
  }

  const handleAccept = () => {
    onAccept(editing)
    setSuggestion(null)
    setEditing('')
  }

  const handleReject = () => {
    setSuggestion(null)
    setEditing('')
  }

  if (!text.trim()) return null

  // Show suggestion with edit + accept/reject
  if (suggestion !== null) {
    return (
      <div className="mt-1.5 rounded-xl border border-[#d4a853]/30 bg-[#d4a853]/5 p-2.5 space-y-2">
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-[#d4a853]">
          <Languages className="h-3 w-3" />
          {uiLang === 'ar' ? 'اقتراح الترجمة' : uiLang === 'de' ? 'Übersetzungsvorschlag' : 'Translation suggestion'}
        </div>
        <textarea
          value={editing}
          onChange={(e) => setEditing(e.target.value)}
          className="w-full px-2.5 py-1.5 rounded-lg border bg-background text-sm resize-none"
          rows={editing.length > 80 ? 3 : 1}
          dir={targetLang === 'ar' ? 'rtl' : 'ltr'}
        />
        <div className="flex items-center gap-1.5">
          <button onClick={handleAccept} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-[#d4a853] text-black text-[11px] font-medium hover:bg-[#c49b4a] transition-colors">
            <Check className="h-3 w-3" />
            {uiLang === 'ar' ? 'قبول' : uiLang === 'de' ? 'Übernehmen' : 'Accept'}
          </button>
          <button onClick={handleReject} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors">
            <X className="h-3 w-3" />
            {uiLang === 'ar' ? 'رفض' : uiLang === 'de' ? 'Verwerfen' : 'Dismiss'}
          </button>
        </div>
      </div>
    )
  }

  // Show translate button
  return (
    <button
      onClick={handleTranslate}
      disabled={isLoading || !text.trim()}
      className={`inline-flex items-center gap-1 text-[#d4a853] hover:text-[#c49b4a] transition-colors disabled:opacity-40 ${
        size === 'sm' ? 'text-[10px]' : 'text-xs'
      }`}
    >
      {isLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Languages className="h-3 w-3" />}
      {label ?? (uiLang === 'ar' ? 'ترجمة إلى الألمانية' : uiLang === 'de' ? 'Ins Deutsche übersetzen' : 'Translate')}
    </button>
  )
}
