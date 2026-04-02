import { useState, useCallback } from 'react'
import { api } from '@/lib/api'

interface UseTranslateResult {
  translate: (text: string, sourceLang: string, targetLang: string) => Promise<string>
  isLoading: boolean
  error: string | null
}

export function useTranslate(): UseTranslateResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const translate = useCallback(async (text: string, sourceLang: string, targetLang: string): Promise<string> => {
    if (!text.trim()) return ''
    setIsLoading(true)
    setError(null)
    try {
      const { data } = await api.post('/admin/translate', { text, sourceLang, targetLang })
      setIsLoading(false)
      if (data.source === 'error' || !data.text) {
        setError('Translation unavailable')
        return ''
      }
      return data.text
    } catch {
      setIsLoading(false)
      setError('Translation failed')
      return ''
    }
  }, [])

  return { translate, isLoading, error }
}
