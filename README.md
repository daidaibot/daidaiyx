# 呆呆网络 · 微信小程序 AI

品牌主页 + 定制 AI 聊天（流式），不再使用官方通用 Agent UI 壳子。

## 打开

微信开发者工具导入：`miniprogram/`

## 配置

1. 开通 **云开发**，把环境 ID 填进 `app.js`
2. 云开发控制台配置 DeepSeek（或改 `globalData.aiProvider` / `aiModel`）
3. 调试基础库 ≥ **3.7.1**

## 页面

- `pages/index`：呆呆网络主页
- `pages/ai`：定制聊天页（流式输出）
