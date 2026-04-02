import { Injectable, Logger } from '@nestjs/common'

interface TranslationResult {
  text: string
  source: 'deepl' | 'cache' | 'error'
}

@Injectable()
export class TranslationService {
  private readonly logger = new Logger(TranslationService.name)
  private cache = new Map<string, string>()
  private readonly apiKey = process.env.DEEPL_API_KEY || ''
  private readonly apiUrl = process.env.DEEPL_API_URL || 'https://api-free.deepl.com/v2/translate'

  async translate(text: string, sourceLang: string, targetLang: string): Promise<TranslationResult> {
    if (!text?.trim()) return { text: '', source: 'error' }
    if (!this.apiKey) {
      this.logger.warn('DEEPL_API_KEY not set — translation unavailable')
      return { text: '', source: 'error' }
    }

    // Map language codes to DeepL format
    const deepLSource = this.toDeepLLang(sourceLang)
    const deepLTarget = this.toDeepLLang(targetLang)

    // Check cache
    const cacheKey = `${deepLSource}:${deepLTarget}:${text.trim()}`
    const cached = this.cache.get(cacheKey)
    if (cached) return { text: cached, source: 'cache' }

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: [text.trim()],
          source_lang: deepLSource,
          target_lang: deepLTarget,
        }),
      })

      if (!res.ok) {
        this.logger.error(`DeepL API error: ${res.status} ${res.statusText}`)
        return { text: '', source: 'error' }
      }

      const data: any = await res.json()
      const translated = data.translations?.[0]?.text ?? ''

      if (translated) {
        this.cache.set(cacheKey, translated)
        // Limit cache size
        if (this.cache.size > 5000) {
          const firstKey = this.cache.keys().next().value
          if (firstKey) this.cache.delete(firstKey)
        }
      }

      return { text: translated, source: 'deepl' }
    } catch (err: any) {
      this.logger.error(`DeepL API call failed: ${err.message}`)
      return { text: '', source: 'error' }
    }
  }

  async translateBatch(texts: string[], sourceLang: string, targetLang: string): Promise<TranslationResult[]> {
    if (!this.apiKey || !texts.length) return texts.map(() => ({ text: '', source: 'error' as const }))

    const deepLSource = this.toDeepLLang(sourceLang)
    const deepLTarget = this.toDeepLLang(targetLang)

    // Check cache for each
    const results: TranslationResult[] = []
    const uncachedIndices: number[] = []
    const uncachedTexts: string[] = []

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = `${deepLSource}:${deepLTarget}:${texts[i].trim()}`
      const cached = this.cache.get(cacheKey)
      if (cached) {
        results[i] = { text: cached, source: 'cache' }
      } else {
        uncachedIndices.push(i)
        uncachedTexts.push(texts[i].trim())
        results[i] = { text: '', source: 'error' }
      }
    }

    if (uncachedTexts.length === 0) return results

    try {
      const res = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: uncachedTexts,
          source_lang: deepLSource,
          target_lang: deepLTarget,
        }),
      })

      if (!res.ok) return results

      const data: any = await res.json()
      const translations = data.translations ?? []

      for (let j = 0; j < uncachedIndices.length; j++) {
        const translated = translations[j]?.text ?? ''
        const idx = uncachedIndices[j]
        if (translated) {
          const cacheKey = `${deepLSource}:${deepLTarget}:${texts[idx].trim()}`
          this.cache.set(cacheKey, translated)
          results[idx] = { text: translated, source: 'deepl' }
        }
      }
    } catch {}

    return results
  }

  private toDeepLLang(lang: string): string {
    const map: Record<string, string> = {
      ar: 'AR', de: 'DE', en: 'EN', fr: 'FR', es: 'ES', tr: 'TR',
    }
    return map[lang.toLowerCase()] ?? lang.toUpperCase()
  }
}
