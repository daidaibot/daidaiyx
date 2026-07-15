# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

部署后打开云托管域名根路径即可：

- `/` 淡绿主页（splash → 英雄区 → 关于/联系）
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

推荐部署：**微信云托管**。环境变量（推荐用呆呆命名，更新代码不会丢）：

| 变量名 | 用途 |
|--------|------|
| `ADMIN_PASSWORD` | 管理后台密码 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序微信登录 |
| `DAIDAI_AI_KEY` | 呆呆 AI（对话）密钥 |
| `DAIDAI_IMAGE_KEY` | 呆呆 Image（生图）密钥 |
| `DAIDAI_IMAGE_BASE_URL` | 生图中转地址，如 `https://openai.dai520.cn`（不要加 `/v1`） |
| `DAIDAI_API_BASE` | 小程序对接域名（云托管公网地址，不要末尾 `/`，不要 `/admin`） |
| `DAIDAI_IMAGE_PROXY_ASYNC` | 填 `1`：走 Cloudflare 中转异步（一般不如代理池省事） |
| `DAIDAI_HTTPS_PROXY` | 国外代理池地址，如 `http://user:pass@主机:端口`（生图出站走代理） |

**推荐用 Webshare 代理池时：**

1. 云托管环境变量：
   - `DAIDAI_IMAGE_BASE_URL=https://api.openai.com`
   - `DAIDAI_IMAGE_KEY=sk-...`
   - 不要开 `DAIDAI_IMAGE_PROXY_ASYNC`
2. 部署后打开管理后台 → 运维配置 → **出站代理池**，把 Webshare txt（`IP:端口:用户:密码`）整份粘贴保存  
   或把文件放到持久盘 `/app/data/proxies.txt`

失败会自动换下一个代理（默认最多试 3 个，可用 `DAIDAI_PROXY_TRIES` 调整）。
