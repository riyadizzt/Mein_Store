import { AiProvider, AiMessage, AiResponse } from './ai-provider.interface'

export class ClaudeHaikuProvider implements AiProvider {
  name = 'claude_haiku'
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async chat(messages: AiMessage[], maxTokens = 300): Promise<AiResponse> {
    const systemMsg = messages.find((m) => m.role === 'system')
    const userMsgs = messages.filter((m) => m.role !== 'system')

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-haiku-20241022',
        max_tokens: maxTokens,
        system: systemMsg?.content ?? '',
        messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Claude Haiku error ${res.status}: ${err}`)
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
