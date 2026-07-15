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

可选：`DAIDAI_AI_BASE_URL`、`DAIDAI_AI_MODEL`、`DAIDAI_IMAGE_MODEL`、`WEB_PASSWORD`。  
旧名 `DEEPSEEK_*` / `OPENAI_*` 仍兼容，但新部署请用上面的 `DAIDAI_*`。
