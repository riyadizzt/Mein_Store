export interface AiMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface AiResponse {
  content: string
  tokensIn: number
  tokensOut: number
  provider: string
}

export interface AiProvider {
  name: string
  chat(messages: AiMessage[], maxTokens?: number): Promise<AiResponse>
}
