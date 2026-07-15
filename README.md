# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

部署后打开云托管域名根路径即可：

- `/` 淡绿主页（splash → 英雄区 → 关于/联系）
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

推荐部署：**微信云托管**。环境变量：

- `WECHAT_APPID` / `WECHAT_SECRET` — 小程序登录（必填，否则不能登录）
- `WECHAT_OPEN_APPID` / `WECHAT_OPEN_SECRET` — 网页跳转微信扫码登录（开放平台网站应用）
- `WECHAT_OAUTH_REDIRECT` — `https://域名/api/auth/wechat/callback`
- `ADMIN_PASSWORD`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`
