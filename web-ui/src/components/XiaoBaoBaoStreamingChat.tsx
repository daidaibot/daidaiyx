import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, User, Bot, Sparkles, Copy, RefreshCw, AlertCircle, Square } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { StreamingChatHandler, simulateNaturalTyping, type ChatMessage } from '../lib/streaming';
import { appConfig } from '../lib/config';

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  isStreaming?: boolean;
}

interface QuickAction {
  id: string;
  text: string;
  icon: string;
}

const XiaoBaoBaoStreamingChat = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: '你好！我是 **呆呆 AI** ✨\n\n由 **呆呆网络** 提供服务。支持流式回复与 Markdown：\n\n• **智能问答** · **代码编程** · **创意写作** · **学习指导**\n\n点下面的推荐，或直接输入你的问题开始聊天。',
      sender: 'ai',
      timestamp: new Date()
    }
  ]);
  const [inputValue, setInputValue] = useState('');
  const [hoveredMessageId, setHoveredMessageId] = useState<string | null>(null);
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingHandler] = useState(() => new StreamingChatHandler());
  const [connectionStatus, setConnectionStatus] = useState<'connected' | 'connecting' | 'error'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [models, setModels] = useState<any[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const currentStreamingMessage = useRef<string>('');
  const currentAiMessageId = useRef<string>('');
  const isInitialized = useRef(false);

  const quickActions: QuickAction[] = [
    { id: '1', text: '写一个Python快速排序算法', icon: '🐍' },
    { id: '2', text: '解释什么是React Hooks', icon: '⚛️' },
    { id: '3', text: '创建一个Markdown表格示例', icon: '📊' },
    { id: '4', text: '用代码实现斐波那契数列', icon: '🔢' },
  ];

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // 初始化连接检查
  useEffect(() => {
    if (!isInitialized.current) {
      isInitialized.current = true;
      checkConnection();
    }
  }, []);

  const checkConnection = async () => {
    setConnectionStatus('connecting');
    try {
      const isSupported = await StreamingChatHandler.checkStreamingSupport();
      if (isSupported || appConfig.demoMode) {
        setConnectionStatus('connected');
        const availableModels = await streamingHandler.getModels();
        setModels(availableModels);
        setError(appConfig.demoMode ? '当前为演示模式，可先体验界面' : null);
      } else {
        // 无后端也不报错阻断：演示回复兜底
        setConnectionStatus('connected');
        setError('未连接模型服务，先用演示回复体验界面');
      }
    } catch (error) {
      setConnectionStatus('connected');
      setError('演示模式：界面可正常使用');
      console.error('Connection check failed:', error);
    }
  };

  // 停止当前流式响应
  const stopStreaming = () => {
    streamingHandler.abort();
    setIsStreaming(false);
    
    // 如果有未完成的流式消息，将其标记为完成，但保留内容
    if (currentAiMessageId.current) {
      setMessages(prev => prev.map(msg => {
        if (msg.id === currentAiMessageId.current && msg.sender === 'ai') {
          return { ...msg, isStreaming: false };
        }
        return msg;
      }));
      currentAiMessageId.current = '';
    }
  };

  // 处理流式响应
  const handleStreamingResponse = async (userMessage: string, currentMessages: Message[]) => {
    // 构建API消息格式 - 使用传入的当前消息列表
    const apiMessages: ChatMessage[] = [];
    
    // 添加对话历史（最近5条，排除欢迎消息）
    const conversationHistory = currentMessages.slice(-5);
    conversationHistory.forEach(msg => {
      if (msg.id !== '1') {
        apiMessages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    });

    // 添加当前用户消息
    apiMessages.push({
      role: 'user',
      content: userMessage
    });

    // 创建AI响应消息
    const aiMessage: Message = {
      id: Date.now().toString(),
      content: '',
      sender: 'ai',
      timestamp: new Date(),
      isStreaming: true
    };

    // 设置当前AI消息ID
    currentAiMessageId.current = aiMessage.id;

    // 添加AI消息到状态
    setMessages(prev => [...prev, aiMessage]);
    setIsStreaming(true);
    currentStreamingMessage.current = '';

    // 流式响应处理
    const onChunk = (chunk: string) => {
      currentStreamingMessage.current += chunk;
      const targetMessageId = currentAiMessageId.current;
      
      setMessages(prev => prev.map(msg => {
        // 只更新目标AI消息，不影响其他消息
        if (msg.id === targetMessageId && msg.sender === 'ai') {
          return { ...msg, content: currentStreamingMessage.current };
        }
        return msg;
      }));
    };

    const onComplete = () => {
      const targetMessageId = currentAiMessageId.current;
      const finalContent = currentStreamingMessage.current;
      
      setIsStreaming(false);
      
      // 确保最终内容被正确保存
      setMessages(prev => prev.map(msg => {
        if (msg.id === targetMessageId && msg.sender === 'ai') {
          return { 
            ...msg, 
            content: finalContent, // 使用保存的最终内容
            isStreaming: false 
          };
        }
        return msg;
      }));
      
      // 清理refs
      currentAiMessageId.current = '';
      currentStreamingMessage.current = '';
    };

    const onError = (error: Error) => {
      const targetMessageId = currentAiMessageId.current;
      setIsStreaming(false);
      console.error('流式响应错误:', error);
      
      // 如果流式失败，尝试备用方案
      if (connectionStatus === 'connected') {
        handleFallbackResponse(apiMessages, targetMessageId);
      } else {
        setMessages(prev => prev.map(msg => {
          if (msg.id === targetMessageId && msg.sender === 'ai') {
            return {
              ...msg,
              content: `抱歉，我遇到了技术问题：**${error.message}**\n\n请稍后重试或检查网络连接。`,
              isStreaming: false
            };
          }
          return msg;
        }));
        // 清理refs
        currentAiMessageId.current = '';
        currentStreamingMessage.current = '';
      }
    };

    // 开始流式请求
    try {
      await streamingHandler.streamChat(apiMessages, onChunk, onComplete, onError);
    } catch (error) {
      onError(error instanceof Error ? error : new Error('未知错误'));
    }
  };

  // 备用响应处理（非流式）
  const handleFallbackResponse = async (apiMessages: ChatMessage[], messageId: string) => {
    const onComplete = (content: string) => {
      // 使用自然打字效果模拟流式显示
      let currentContent = '';
      
      const onChunk = (chunk: string) => {
        currentContent += chunk;
        setMessages(prev => prev.map(msg => {
          if (msg.id === messageId && msg.sender === 'ai') {
            return { ...msg, content: currentContent };
          }
          return msg;
        }));
      };
      
      const onTypingComplete = () => {
        setIsStreaming(false);
        setMessages(prev => prev.map(msg => {
          if (msg.id === messageId && msg.sender === 'ai') {
            return { ...msg, content: currentContent, isStreaming: false };
          }
          return msg;
        }));
        // 清理refs
        currentAiMessageId.current = '';
        currentStreamingMessage.current = '';
      };
      
      simulateNaturalTyping(content, onChunk, onTypingComplete, 30);
    };

    const onError = (error: Error) => {
      setIsStreaming(false);
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.sender === 'ai') {
          return {
            ...msg,
            content: `抱歉，我遇到了技术问题：**${error.message}**\n\n请稍后重试。`,
            isStreaming: false
          };
        }
        return msg;
      }));
      // 清理refs
      currentAiMessageId.current = '';
      currentStreamingMessage.current = '';
    };

    await streamingHandler.fallbackRequest(apiMessages, onComplete, onError);
  };

  const handleSendMessage = async (content?: string) => {
    const messageContent = content || inputValue;
    if (!messageContent.trim() || isStreaming) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      content: messageContent,
      sender: 'user',
      timestamp: new Date()
    };

    // 先添加用户消息到状态
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);
    setInputValue('');
    setError(null);

    // 处理AI响应，传递包含新用户消息的列表
    await handleStreamingResponse(messageContent, updatedMessages);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    if (!isStreaming) {
      handleSendMessage(action.text);
    }
  };

  const copyMessage = (content: string) => {
    navigator.clipboard.writeText(content).then(() => {
      // 可以添加toast通知
    }).catch(() => {
      // 降级方案
      const textArea = document.createElement('textarea');
      textArea.value = content;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    });
  };

  const regenerateResponse = async (messageId: string) => {
    if (isStreaming) return;
    
    const messageIndex = messages.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return;
    
    const userMessage = messages[messageIndex - 1];
    if (!userMessage || userMessage.sender !== 'user') return;

    // 重置目标消息
    currentAiMessageId.current = messageId;
    setMessages(prev => prev.map(msg => {
      if (msg.id === messageId && msg.sender === 'ai') {
        return { ...msg, content: '', isStreaming: true };
      }
      return msg;
    }));

    // 构建API消息格式 - 获取该消息之前的历史
    const apiMessages: ChatMessage[] = [];
    const conversationHistory = messages.slice(0, messageIndex - 1);
    
    conversationHistory.forEach(msg => {
      if (msg.id !== '1') {
        apiMessages.push({
          role: msg.sender === 'user' ? 'user' : 'assistant',
          content: msg.content
        });
      }
    });

    // 添加用户消息
    apiMessages.push({
      role: 'user',
      content: userMessage.content
    });

    setIsStreaming(true);
    currentStreamingMessage.current = '';

    // 流式响应处理
    const onChunk = (chunk: string) => {
      currentStreamingMessage.current += chunk;
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.sender === 'ai') {
          return { ...msg, content: currentStreamingMessage.current };
        }
        return msg;
      }));
    };

    const onComplete = () => {
      const finalContent = currentStreamingMessage.current;
      setIsStreaming(false);
      
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.sender === 'ai') {
          return { ...msg, content: finalContent, isStreaming: false };
        }
        return msg;
      }));
      
      // 清理refs
      currentAiMessageId.current = '';
      currentStreamingMessage.current = '';
    };

    const onError = (error: Error) => {
      setIsStreaming(false);
      setMessages(prev => prev.map(msg => {
        if (msg.id === messageId && msg.sender === 'ai') {
          return {
            ...msg,
            content: `抱歉，我遇到了技术问题：**${error.message}**\n\n请稍后重试。`,
            isStreaming: false
          };
        }
        return msg;
      }));
      // 清理refs
      currentAiMessageId.current = '';
      currentStreamingMessage.current = '';
    };

    // 开始流式请求
    try {
      await streamingHandler.streamChat(apiMessages, onChunk, onComplete, onError);
    } catch (error) {
      onError(error instanceof Error ? error : new Error('未知错误'));
    }
  };

  // Markdown 自定义组件
  const MarkdownComponents = {
    code({ node, inline, className, children, ...props }: any) {
      const match = /language-(\w+)/.exec(className || '');
      return !inline && match ? (
        <pre className="hljs">
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      ) : (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
    pre({ children, ...props }: any) {
      return <pre {...props}>{children}</pre>;
    },
    a({ href, children, ...props }: any) {
      return (
        <a 
          href={href} 
          target="_blank" 
          rel="noopener noreferrer" 
          {...props}
        >
          {children}
        </a>
      );
    }
  };

  const getConnectionStatusText = () => {
    if (appConfig.demoMode) return '演示模式 · 呆呆 AI';
    switch (connectionStatus) {
      case 'connected':
        return '呆呆 AI 已就绪';
      case 'connecting':
        return '正在连接服务...';
      case 'error':
        return '服务未就绪';
      default:
        return '未知状态';
    }
  };

  const getConnectionStatusColor = () => {
    switch (connectionStatus) {
      case 'connected':
        return 'bg-green-400 animate-pulse';
      case 'connecting':
        return 'bg-yellow-400 animate-pulse';
      case 'error':
        return 'bg-red-400';
      default:
        return 'bg-gray-400';
    }
  };

  return (
    <div className="flex flex-col h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      {/* Header */}
      <div className="flex items-center justify-between py-4 px-6 bg-white/90 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="relative">
            <div className="w-11 h-11 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 rounded-2xl flex items-center justify-center shadow-lg">
              <Sparkles className="w-6 h-6 text-white" />
            </div>
            <div className={`absolute -top-1 -right-1 w-5 h-5 rounded-full border-2 border-white shadow-sm ${
              getConnectionStatusColor()
            }`}></div>
          </div>
          <div>
            <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 bg-clip-text text-transparent">
              {appConfig.brand}
            </h1>
            <p className="text-sm text-slate-500 font-medium">
              {isStreaming ? '正在回复...' : getConnectionStatusText()}
            </p>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="mx-6 mt-4 p-4 bg-orange-50 border border-orange-200 rounded-2xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-orange-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-orange-800 font-medium">连接提示</p>
            <p className="text-sm text-orange-600">{error}</p>
          </div>
          <button 
            onClick={checkConnection}
            className="text-orange-400 hover:text-orange-600 transition-colors"
            title="重新连接"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* API Status */}
      {connectionStatus === 'connected' && (
        <div className="mx-6 mt-4 p-3 bg-blue-50 border border-blue-200 rounded-2xl">
          <div className="flex items-center gap-2 text-sm text-blue-800">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <span>流式对话已启用 · OpenAI 兼容接口</span>
            {models.length > 0 && (
              <span className="text-blue-600">· {models[0]?.id}</span>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`group flex items-start gap-4 ${
              message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'
            }`}
            onMouseEnter={() => setHoveredMessageId(message.id)}
            onMouseLeave={() => setHoveredMessageId(null)}
          >
            {/* Avatar */}
            <div
              className={`flex-shrink-0 w-10 h-10 rounded-2xl flex items-center justify-center shadow-lg ${
                message.sender === 'user'
                  ? 'bg-gradient-to-r from-blue-500 to-cyan-500'
                  : 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500'
              }`}
            >
              {message.sender === 'user' ? (
                <User className="w-5 h-5 text-white" />
              ) : (
                <Bot className="w-5 h-5 text-white" />
              )}
            </div>

            <div className="flex-1 max-w-[85%]">
              {/* Message Bubble */}
              <div
                className={`relative rounded-3xl px-5 py-4 shadow-md transition-all duration-200 ${
                  message.sender === 'user'
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white ml-auto rounded-br-lg'
                    : 'bg-white border border-slate-200/80 text-slate-800 rounded-bl-lg hover:shadow-lg'
                }`}
              >
                <div className="markdown-content">
                  {message.sender === 'user' ? (
                    <p className="text-sm leading-relaxed whitespace-pre-wrap m-0">
                      {message.content}
                    </p>
                  ) : (
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeHighlight]}
                      components={MarkdownComponents}
                      className="text-sm leading-relaxed"
                    >
                      {message.content}
                    </ReactMarkdown>
                  )}
                </div>
                
                {/* Streaming Indicator */}
                {message.isStreaming && message.sender === 'ai' && (
                  <div className="flex items-center gap-2 mt-3">
                    <div className="flex space-x-1">
                      <div className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce"></div>
                      <div className="w-1 h-1 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                      <div className="w-1 h-1 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    </div>
                    <span className="text-xs text-slate-400">正在生成...</span>
                  </div>
                )}
                
                <div
                  className={`text-xs mt-3 ${
                    message.sender === 'user'
                      ? 'text-blue-100'
                      : 'text-slate-400'
                  }`}
                >
                  {message.timestamp.toLocaleTimeString('zh-CN', {
                    hour: '2-digit',
                    minute: '2-digit'
                  })}
                </div>
              </div>

              {/* Message Actions */}
              {message.sender === 'ai' && hoveredMessageId === message.id && !message.isStreaming && (
                <div className="flex items-center gap-2 mt-2 ml-2">
                  <button 
                    onClick={() => copyMessage(message.content)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    title="复制"
                  >
                    <Copy className="w-4 h-4 text-slate-400" />
                  </button>
                  <button 
                    onClick={() => regenerateResponse(message.id)}
                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    title="重新生成"
                    disabled={isStreaming}
                  >
                    <RefreshCw className={`w-4 h-4 text-slate-400 ${isStreaming ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Quick Actions */}
      {messages.length === 1 && (
        <div className="px-6 pb-4">
          <div className="grid grid-cols-2 gap-3">
            {quickActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleQuickAction(action)}
                className="flex items-center gap-3 p-4 bg-white border border-slate-200 rounded-2xl transition-all duration-200 hover:shadow-md hover:border-indigo-300 group"
                disabled={isStreaming}
              >
                <span className="text-lg">{action.icon}</span>
                <span className="text-sm font-medium text-slate-600 group-hover:text-indigo-600">
                  {action.text}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <div className="p-6 bg-white/90 backdrop-blur-md border-t border-slate-200/60">
        <div className="max-w-4xl mx-auto">
          <div className="relative flex items-end gap-4 bg-white rounded-3xl shadow-xl border border-slate-200/80 p-4 transition-all duration-200 focus-within:border-indigo-300 focus-within:shadow-2xl">
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="向呆呆 AI 提问..."
              className="flex-1 resize-none border-0 outline-none text-slate-800 placeholder-slate-400 bg-transparent min-h-[24px] max-h-[120px] leading-6"
              rows={1}
              disabled={isStreaming}
            />
            
            {/* Stop/Send Button */}
            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center bg-red-500 hover:bg-red-600 text-white shadow-lg transition-all duration-200 hover:shadow-xl transform hover:scale-105 active:scale-95"
                title="停止生成"
              >
                <Square className="w-5 h-5" />
              </button>
            ) : (
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputValue.trim() || connectionStatus === 'error'}
                className={`flex-shrink-0 w-12 h-12 rounded-2xl flex items-center justify-center transition-all duration-200 ${
                  inputValue.trim() && connectionStatus !== 'error'
                    ? 'bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white shadow-lg hover:shadow-xl transform hover:scale-105 active:scale-95'
                    : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                }`}
              >
                <Send className="w-5 h-5" />
              </button>
            )}
          </div>
          
          <div className="flex items-center justify-center mt-3">
            <p className="text-xs text-slate-400 text-center">
              {isStreaming ? '正在回复...' : '豆包风界面 · 支持 Markdown · 演示可直接聊'}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default XiaoBaoBaoStreamingChat;