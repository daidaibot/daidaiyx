# 呆呆网络 = 小程序壳 + NextChat（高级现成 AI UI）

## 结构

- `miniprogram/` 微信小程序：主页 → web-view 打开 NextChat
- `nextchat/` 开源 [NextChat](https://github.com/ChatGPTNextWeb/NextChat)（现成高级聊天界面，不手写）

## 1. 先看效果（不用部署）

浏览器打开官方演示：https://app.nextchat.club

小程序里 `app.js` 已默认指向该演示地址，导入 `miniprogram/` 即可先进主页再点进入。

> 真机 web-view 需要把域名配进小程序「业务域名」；开发工具里若拦域名，可先点「浏览器」复制链接用手机浏览器看。

## 2. 部署你自己的 NextChat（带你的 Key）

目录：`nextchat/`

1. 复制 `.env.example` → `.env`，填 `DEEPSEEK_API_KEY` 和 `CODE`
2. 推到 GitHub 后用 Vercel 一键部署（官网 README 有 Deploy 按钮）
3. 把得到的 `https://xxx.vercel.app` 填进 `miniprogram/app.js` 的 `aiUrl`

Vercel 环境变量至少：
- `DEEPSEEK_API_KEY`
- `CODE`（访问密码）
- `HIDE_USER_API_KEY=1`
- `DEFAULT_MODEL=deepseek-chat`

## 3. 小程序

微信开发者工具导入：`miniprogram/`
