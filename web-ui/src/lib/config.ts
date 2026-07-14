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

function getEnvVar(name: string, defaultValue: string): string {
  const env = import.meta.env as Record<string, string | undefined>;
  return env[name] || defaultValue;
}

function getViteEnv() {
  const env = import.meta.env as {
    DEV?: boolean;
    PROD?: boolean;
    MODE?: string;
  };
  return {
    DEV: Boolean(env.DEV),
    PROD: Boolean(env.PROD),
    MODE: String(env.MODE || 'development'),
  };
}

const viteEnv = getViteEnv();

export const appConfig: AppConfig = {
  chatEndpoint: getEnvVar('VITE_CHAT_ENDPOINT', '/api/chat'),
  healthEndpoint: getEnvVar('VITE_HEALTH_ENDPOINT', '/api/chat/health'),
  model: getEnvVar('VITE_CHAT_MODEL', 'deepseek-chat'),
  isDevelopment: viteEnv.DEV,
  isProduction: viteEnv.PROD,
  brand: '呆呆网络',
  // GitHub Pages / 无后端时开启本地演示回复
  demoMode: getEnvVar('VITE_DEMO_MODE', 'false') === 'true',
};

export default appConfig;
