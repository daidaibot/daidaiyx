// OpenAI 兼容流式对话（经 Express /api/chat 代理 DeepSeek 等）
import { appConfig } from './config';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface StreamingConfig {
  chatEndpoint: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

const DEFAULT_CONFIG: StreamingConfig = {
  chatEndpoint: appConfig.chatEndpoint,
  model: appConfig.model,
  temperature: 0.7,
  maxTokens: 2000,
  topP: 0.9,
};

export class StreamingChatHandler {
  private config: StreamingConfig;
  private abortController: AbortController | null = null;

  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  public async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.config.chatEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          top_p: this.config.topP,
          stream: true,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          detail = errBody?.error?.message || errBody?.message || detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      if (!response.body) {
        throw new Error('响应体为空');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':')) continue;
            if (!trimmed.startsWith('data: ')) continue;

            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') {
              onComplete();
              return;
            }

            try {
              const data = JSON.parse(dataStr);
              const content = data.choices?.[0]?.delta?.content;
              if (typeof content === 'string' && content.length > 0) {
                onChunk(content);
              }
            } catch {
              // skip malformed chunk
            }
          }
        }
        onComplete();
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') return;
        onError(error);
      } else {
        onError(new Error('未知错误'));
      }
    } finally {
      this.abortController = null;
    }
  }

  public async fallbackRequest(
    messages: ChatMessage[],
    onComplete: (content: string) => void,
    onError: (error: Error) => void
  ): Promise<void> {
    this.abortController = new AbortController();

    try {
      const response = await fetch(this.config.chatEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          messages,
          max_tokens: this.config.maxTokens,
          temperature: this.config.temperature,
          top_p: this.config.topP,
          stream: false,
        }),
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        let detail = `HTTP ${response.status}`;
        try {
          const errBody = await response.json();
          detail = errBody?.error?.message || errBody?.message || detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      const result = await response.json();
      const content = result.choices?.[0]?.message?.content;
      if (content) {
        onComplete(content);
      } else {
        throw new Error('响应格式错误：未找到消息内容');
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') return;
        onError(error);
      } else {
        onError(new Error('未知错误'));
      }
    } finally {
      this.abortController = null;
    }
  }

  public static async checkStreamingSupport(_endpoint?: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(appConfig.healthEndpoint, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) return false;
      const data = await response.json();
      return Boolean(data?.ok);
    } catch {
      return false;
    }
  }

  public async getModels(): Promise<{ id: string }[]> {
    return [{ id: this.config.model || appConfig.model }];
  }
}

export const streamingHandler = new StreamingChatHandler();

export function simulateNaturalTyping(
  text: string,
  onChunk: (chunk: string) => void,
  onComplete: () => void,
  baseDelay: number = 50
): void {
  const chunks = text.split(/([。！？，、；：\s]+)/).filter((chunk) => chunk.length > 0);
  let index = 0;

  const showNextChunk = () => {
    if (index < chunks.length) {
      const chunk = chunks[index];
      onChunk(chunk);
      index++;

      let delay = baseDelay;
      if (/[。！？]/.test(chunk)) delay = baseDelay * 3;
      else if (/[，、；：]/.test(chunk)) delay = baseDelay * 2;

      setTimeout(showNextChunk, delay);
    } else {
      onComplete();
    }
  };

  showNextChunk();
}
