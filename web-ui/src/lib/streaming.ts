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

function buildDemoReply(messages: ChatMessage[]): string {
  const last = [...messages].reverse().find((m) => m.role === 'user')?.content || '';
  const tip = last.slice(0, 80) || '你好';
  return [
    `收到：${tip}`,
    '',
    '我是 **呆呆 AI**（演示模式）。界面已可用；接上云托管并配置 `DEEPSEEK_API_KEY` 后即可真实对话。',
    '',
    '你也可以继续点推荐问题，熟悉豆包风布局。',
  ].join('\n');
}

export class StreamingChatHandler {
  private config: StreamingConfig;
  private abortController: AbortController | null = null;
  private typingTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: Partial<StreamingConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  public abort() {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    if (this.typingTimer) {
      clearTimeout(this.typingTimer);
      this.typingTimer = null;
    }
  }

  private streamDemo(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onComplete: () => void
  ): void {
    const text = buildDemoReply(messages);
    simulateNaturalTyping(
      text,
      onChunk,
      onComplete,
      28,
      (timer) => {
        this.typingTimer = timer;
      }
    );
  }

  public async streamChat(
    messages: ChatMessage[],
    onChunk: (chunk: string) => void,
    onComplete: () => void,
    onError: (error: Error) => void
  ): Promise<void> {
    if (appConfig.demoMode) {
      this.streamDemo(messages, onChunk, onComplete);
      return;
    }

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
        // 无后端时自动降级演示，避免整页崩溃
        this.streamDemo(messages, onChunk, onComplete);
        return;
      }

      if (!response.body) {
        this.streamDemo(messages, onChunk, onComplete);
        return;
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
              // skip
            }
          }
        }
        onComplete();
      } finally {
        reader.releaseLock();
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      // 网络失败 → 演示回复，保证能玩
      this.streamDemo(messages, onChunk, onComplete);
    } finally {
      this.abortController = null;
    }
  }

  public async fallbackRequest(
    messages: ChatMessage[],
    onComplete: (content: string) => void,
    _onError: (error: Error) => void
  ): Promise<void> {
    onComplete(buildDemoReply(messages));
  }

  public static async checkStreamingSupport(): Promise<boolean> {
    if (appConfig.demoMode) return true;
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4000);
      const response = await fetch(appConfig.healthEndpoint, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (!response.ok) return appConfig.demoMode;
      const data = await response.json();
      return Boolean(data?.ok);
    } catch {
      return appConfig.demoMode;
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
  baseDelay: number = 50,
  onTimer?: (timer: ReturnType<typeof setTimeout> | null) => void
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

      const timer = setTimeout(showNextChunk, delay);
      onTimer?.(timer);
    } else {
      onTimer?.(null);
      onComplete();
    }
  };

  showNextChunk();
}
