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

**推荐用代理池直连官方生图时云托管这样配：**

```
DAIDAI_HTTPS_PROXY=http://账号:密码@代理主机:端口
DAIDAI_IMAGE_BASE_URL=https://api.openai.com
DAIDAI_IMAGE_KEY=sk-你的密钥
```

不要再开 `DAIDAI_IMAGE_PROXY_ASYNC=1`。代理需支持 HTTPS CONNECT，且超时够长（建议 ≥180 秒）。
