// 应用配置（呆呆网络）
export interface AppConfig {
  chatEndpoint: string;
  healthEndpoint: string;
  model: string;
  isDevelopment: boolean;
  isProduction: boolean;
  brand: string;
  demoMode: boolean;
}

export const appConfig: AppConfig = {
  // 必须静态访问 import.meta.env.VITE_*，Vite 才会在构建时注入
  chatEndpoint: import.meta.env.VITE_CHAT_ENDPOINT || '/api/chat',
  healthEndpoint: import.meta.env.VITE_HEALTH_ENDPOINT || '/api/chat/health',
  model: import.meta.env.VITE_CHAT_MODEL || 'deepseek-chat',
  isDevelopment: Boolean(import.meta.env.DEV),
  isProduction: Boolean(import.meta.env.PROD),
  brand: '呆呆网络',
  // 默认开演示（GitHub Pages 无后端也能聊）；云托管构建时设 VITE_DEMO_MODE=false
  demoMode: (import.meta.env.VITE_DEMO_MODE ?? 'true') === 'true',
};

export default appConfig;
