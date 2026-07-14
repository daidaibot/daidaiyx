# 呆呆网络 · 微信小程序 AI

用的是腾讯官方开源组件：
[TencentCloudBase/cloudbase-agent-ui](https://github.com/TencentCloudBase/cloudbase-agent-ui)

流式输出、Markdown、多会话、语音、上传 —— 微信小程序里更好看的 AI 方案。

## 打开方式

微信开发者工具 → 导入项目 → 目录选：

`miniprogram/`

## 必做配置（一次）

1. 开发者工具顶部点 **云开发** → 开通环境，复制 **环境 ID**
2. 打开 `miniprogram/app.js`，把 `YOUR_CLOUDBASE_ENV_ID` 换成真实环境 ID
3. 打开 [云开发平台 AI](https://tcb.cloud.tencent.com/dev) → 接入大模型 → 填你的 **DeepSeek / 其他 Key**
4. 编译预览，即可对话

当前默认：`chatMode: model` + DeepSeek。  
若要用云开发 Agent，把 `pages/ai/index.js` 里改成 `chatMode: 'bot'` 并填 `botId`。

## 说明

- AI 走 **微信云开发 AI**，不走原来的 Express 小游戏服务
- 云托管 Express 可暂时不用；以后做业务 API 再开
