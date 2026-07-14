// 应用配置（呆呆网络 · OpenAI 兼容接口）
export interface AppConfig {
  chatEndpoint: string;
  healthEndpoint: string;
  model: string;
  isDevelopment: boolean;
  isProduction: boolean;
  brand: string;
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
  // 相对路径：与 Express 同源，便于小程序 web-view + 云托管
  chatEndpoint: getEnvVar('VITE_CHAT_ENDPOINT', '/api/chat'),
  healthEndpoint: getEnvVar('VITE_HEALTH_ENDPOINT', '/api/chat/health'),
  model: getEnvVar('VITE_CHAT_MODEL', 'deepseek-chat'),
  isDevelopment: viteEnv.DEV,
  isProduction: viteEnv.PROD,
  brand: '呆呆网络',
};

export function validateConfig(): { isValid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!appConfig.chatEndpoint) {
    errors.push('聊天接口未配置');
  }
  return {
    isValid: errors.length === 0,
    errors,
  };
}

export async function checkNetworkConnection(): Promise<boolean> {
  try {
    const response = await fetch(appConfig.healthEndpoint, {
      method: 'GET',
      cache: 'no-cache',
    });
    return response.ok;
  } catch {
    return false;
  }
}

export function getAppInfo() {
  return {
    name: appConfig.brand,
    version: '1.0.0',
    build: viteEnv.MODE,
    config: appConfig,
    validation: validateConfig(),
  };
}

export default appConfig;
