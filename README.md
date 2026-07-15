# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

云托管域名：

`https://daidai12-282126-9-1453974162.sh.run.tcloudbase.com`

- `/` 淡绿主页
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

生图对接见 **[对接文档.txt](./对接文档.txt)**。

## 小程序

`miniprogram/app.js` 的 `apiBase` 已指向上述云托管域名。  
AppID：`wxdf3dcb6c1680f134`。  
请在微信公众平台把该域名加入 **request 合法域名**。

## 微信云托管环境变量

| 变量名 | 用途 |
|--------|------|
| `ADMIN_PASSWORD` | 管理后台密码 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序微信登录 |
| `DAIDAI_AI_KEY` | 呆呆 AI（对话）密钥 |
| `DAIDAI_IMAGE_KEY` | 呆呆 Image 密钥（OpenAI `sk-`） |
| `DAIDAI_IMAGE_BASE_URL` | **`http://154.12.94.236`**（国外 VPS 中转，不要加 `/v1`） |
| `DAIDAI_API_BASE` | `https://daidai12-282126-9-1453974162.sh.run.tcloudbase.com` |

**不要设** `DAIDAI_IMAGE_PROXY_ASYNC=1`。

### 推荐生图配置

```
DAIDAI_IMAGE_BASE_URL=http://154.12.94.236
DAIDAI_IMAGE_KEY=sk-你的密钥
DAIDAI_API_BASE=https://daidai12-282126-9-1453974162.sh.run.tcloudbase.com
```

路径：云托管 → VPS nginx → OpenAI。VPS 健康检查：`http://154.12.94.236/health`。
