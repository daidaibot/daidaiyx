# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

部署后打开云托管域名根路径即可：

- `/` 淡绿主页（splash → 英雄区 → 关于/联系）
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

推荐部署：**微信云托管**。环境变量：

- `WECHAT_APPID` / `WECHAT_SECRET` — 小程序微信登录（给用户）
- `ADMIN_PASSWORD` — 管理后台；网页聊天站长通行默认也用它（可另设 `WEB_PASSWORD`）
- `DEEPSEEK_API_KEY`、`OPENAI_API_KEY`
