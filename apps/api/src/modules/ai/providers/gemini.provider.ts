import { AiProvider, AiMessage, AiResponse } from './ai-provider.interface'

export class GeminiProvider implements AiProvider {
  name = 'gemini'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async chat(messages: AiMessage[], maxTokens = 300): Promise<AiResponse> {
    const systemMsg = messages.find((m) => m.role === 'system')
    const userMsgs = messages.filter((m) => m.role !== 'system')

    // Convert to Gemini format
    const contents = userMsgs.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${this.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: systemMsg ? { parts: [{ text: systemMsg.content }] } : undefined,
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
        }),
      },
    )

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Gemini error ${res.status}: ${err}`)
    }

    const data: any = await res.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
    const usage = data.usageMetadata ?? {}

    return {
      content: text,
      tokensIn: usage.promptTokenCount ?? 0,
      tokensOut: usage.candidatesTokenCount ?? 0,
      provider: this.name,
    }
  }
}
