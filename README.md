# 呆呆网络 · 高级简约 AI

小程序只做品牌入口；对话 UI 用现成开源，不手写。

## 风格结论

| 方案 | 观感 | 是否推荐（高级简约） |
|------|------|----------------------|
| NextChat | 功能多、控件多 | 不太简约 |
| **chatgpt-web** | 白底、少元素、接近 ChatGPT | **更贴高级简约** |
| Chatbot UI | 英文站 ChatGPT 风 | 也简约 |

当前选定方向：**[Chanzhaoyu/chatgpt-web](https://github.com/Chanzhaoyu/chatgpt-web)**

预览图：`_candidates/chatgpt_web_preview/c1.png`、`c2.png`

## 目录

- `miniprogram/` 主页 → 打开 AI 网页
- `chatgpt-web/` 现成简约聊天（需自行部署后填地址）

## 小程序

导入 `miniprogram/`  
`app.js` 里 `aiUrl`：部署好的 chatgpt-web 的 `https://域名`

## 部署 chatgpt-web（现成项目）

见官方 README。常用 Docker：

```bash
docker run -d -p 3002:3002 \
  -e OPENAI_API_KEY=你的Key \
  -e OPENAI_API_BASE_URL=https://api.deepseek.com \
  -e OPENAI_API_MODEL=deepseek-chat \
  -e AUTH_SECRET_KEY=daidai \
  chenzhaoyu94/chatgpt-web
```

拿到公网 HTTPS 后写进 `aiUrl`，并把域名配进小程序业务域名。
