export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  stream?: boolean;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: Array<{
    message?: { content: string };
    delta?: { content?: string };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface AssistantCallResult {
  content: string;
  latencyMs: number;
  tokensUsed?: number;
  raw?: unknown;
}

export async function callAssistant(
  endpoint: string,
  prompt: string,
  options?: { model?: string; timeoutMs?: number }
): Promise<AssistantCallResult> {
  const start = Date.now();
  const timeoutMs = options?.timeoutMs ?? 60000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const body: ChatCompletionRequest = {
      model: options?.model ?? 'gpt-3.5-turbo',
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      max_tokens: 256,
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const latencyMs = Date.now() - start;

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as ChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content ?? '';
    const tokensUsed = data.usage?.total_tokens ?? data.usage?.completion_tokens;

    return { content, latencyMs, tokensUsed, raw: data };
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}
