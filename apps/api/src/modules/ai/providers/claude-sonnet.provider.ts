import { AiProvider, AiMessage, AiResponse } from './ai-provider.interface'

export class ClaudeSonnetProvider implements AiProvider {
  name = 'claude_sonnet'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async chat(messages: AiMessage[], maxTokens = 1000): Promise<AiResponse> {
    const systemMsg = messages.find((m) => m.role === 'system')
    const userMsgs = messages.filter((m) => m.role !== 'system')

    // Build messages — support vision (image URLs in content)
    const apiMessages = await Promise.all(userMsgs.map(async (m) => {
      // Check if message contains an image URL marker
      const imageMatch = m.content.match(/\[IMAGE:(https?:\/\/[^\]]+)\]/)
      if (imageMatch && m.role === 'user') {
        const imageUrl = imageMatch[1]
        const textContent = m.content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/, '').trim()
        try {
          // Download image and convert to base64
          const imgRes = await fetch(imageUrl)
          if (imgRes.ok) {
            const buffer = Buffer.from(await imgRes.arrayBuffer())
            const base64 = buffer.toString('base64')
            const contentType = imgRes.headers.get('content-type') || 'image/jpeg'
            const mediaType = contentType.includes('png') ? 'image/png' : contentType.includes('webp') ? 'image/webp' : 'image/jpeg'
            return {
              role: m.role,
              content: [
                { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
                { type: 'text', text: textContent },
              ],
            }
          }
        } catch { /* fallback to text only */ }
        return { role: m.role, content: m.content.replace(/\[IMAGE:https?:\/\/[^\]]+\]/, '').trim() }
      }
      return { role: m.role, content: m.content }
    }))

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: maxTokens,
        system: systemMsg?.content ?? '',
        messages: apiMessages,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude Sonnet error ${res.status}: ${err}`)
    }

    const data: any = await res.json()
    return {
      content: data.content?.[0]?.text ?? '',
      tokensIn: data.usage?.input_tokens ?? 0,
      tokensOut: data.usage?.output_tokens ?? 0,
      provider: this.name,
    }
  }
}
