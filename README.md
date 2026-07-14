# 呆呆网络 · 微信小程序 + 云托管 AI

这是**微信小程序项目**，不是网页版 Dify。

## 目录

- `miniprogram/`：微信开发者工具打开这个目录
- `server.js`：微信云托管 Express 后端（含 `/api/chat`）
- `public/`：云托管上的接星小游戏网页

## 上线 AI（小程序内）

### 1. 云托管重新发布后端

绑定仓库 `daidaibot/daidaiyx` 分支 `main`，端口 `80`，发布。

在云托管 → 服务设置 → **环境变量** 增加（二选一）：

- `DEEPSEEK_API_KEY=你的key`
- 或 `OPENAI_API_KEY=你的key`

可选：`AI_MODEL=deepseek-chat`

**Key 不要写进代码、不要发聊天。**

### 2. 微信开发者工具

1. 导入项目，目录选：`miniprogram/`
2. AppID 可先用测试号，有正式号再替换 `project.config.json`
3. 打开 `miniprogram/app.js`，填：

```js
apiBase: 'https://你的云托管公网域名'
```

4. 详情 → 本地设置 → 勾选「不校验合法域名」（开发阶段）
5. 正式版要把该域名加到小程序后台「request 合法域名」

### 3. 使用

小程序首页 → **呆呆 AI** → 发送消息即可。
