# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

部署后打开云托管域名根路径即可：

- `/` 淡绿主页（splash → 英雄区 → 关于/联系）
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

生图对接说明见根目录 **[对接文档.txt](./对接文档.txt)**（官方 OpenAI + 代理池）。

## 微信云托管环境变量

| 变量名 | 用途 |
|--------|------|
| `ADMIN_PASSWORD` | 管理后台密码 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序微信登录 |
| `DAIDAI_AI_KEY` | 呆呆 AI（对话）密钥 |
| `DAIDAI_IMAGE_KEY` | 呆呆 Image（生图）密钥，填 OpenAI `sk-` |
| `DAIDAI_IMAGE_BASE_URL` | **`https://api.openai.com`**（不要加 `/v1`） |
| `DAIDAI_API_BASE` | 小程序对接域名（云托管公网地址，不要末尾 `/`，不要 `/admin`） |
| `DAIDAI_HTTPS_PROXY` / 代理池文件 | 国外出口；推荐后台粘贴 Webshare 列表 |

**不要再设** `DAIDAI_IMAGE_PROXY_ASYNC=1`（旧 Cloudflare 异步中转）。

### 推荐生图配置

```
DAIDAI_IMAGE_BASE_URL=https://api.openai.com
DAIDAI_IMAGE_KEY=sk-你的密钥
```

部署后：管理后台 → 运维配置 → **出站代理池**，粘贴 Webshare `IP:端口:用户:密码` 全文并保存。  
同页可看「服务器出口 IP」（白名单用，账号密码方式一般不需要）。

失败会自动换下一个代理（默认最多试 3 个，可用 `DAIDAI_PROXY_TRIES` 调整）。

仓库已内置 `config/proxies.builtin.txt`（约 100 条 Webshare），部署后自动加载；后台运维页也可覆盖保存。
