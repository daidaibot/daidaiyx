# 呆呆网络

微信开发者工具导入：`miniprogram`

主页风格参考 [dai520.cn](https://dai520.cn)：淡绿极简个人主页 → 进入呆呆 AI。

## 网页端（与小程序同款）

云托管域名：

`https://dai.52xv.com`

- `/` 淡绿主页
- `/chat.html` 豆包风呆呆 AI
- `/admin/` 管理后台

生图对接见 **[对接文档.txt](./对接文档.txt)**。

## 小程序

`miniprogram/app.js` 的 `apiBase` 已指向上述域名。  
AppID：`wxdf3dcb6c1680f134`。  
请在微信公众平台把该域名加入 **request 合法域名** 与 **downloadFile 合法域名**。

## 微信云托管环境变量

| 变量名 | 用途 |
|--------|------|
| `ADMIN_PASSWORD` | 管理后台密码 |
| `WECHAT_APPID` / `WECHAT_SECRET` | 小程序微信登录 |
| `DAIDAI_AI_KEY` | 呆呆 AI（对话）密钥 |
| `DAIDAI_IMAGE_KEY` | 呆呆 Image 密钥（OpenAI `sk-`） |
| `DAIDAI_IMAGE_BASE_URL` | **`http://154.12.94.236`**（国外 VPS 中转，不要加 `/v1`） |
| `DAIDAI_API_BASE` | `https://dai.52xv.com` |
| `MYSQL_HOST` | MySQL 主机（云托管内网或外网地址） |
| `MYSQL_PORT` | MySQL 端口（外网常见 `23267`，内网 `3306`） |
| `MYSQL_USER` | 业务账号，如 `daidai_app` |
| `MYSQL_PASSWORD` | 数据库密码 |
| `MYSQL_DATABASE` | 库名，默认 `daidaiyx`（启动时自动建库建表） |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | 邮箱验证码（可选） |
| `OTP_SMS_URL` | 短信网关 URL，POST `{ phone, code, minutes }`（可选） |

配置 MySQL 后，**聊天记录、后台设置、后台日志、图片元数据** 会写入数据库，重部署不丢。图片文件仍在 `data/gen-images/`（挂卷或后续接 COS）。

### MySQL 示例（外网调试）

```
MYSQL_HOST=sh-cynosdbmysql-grp-kj060ejg.sql.tencentcdb.com
MYSQL_PORT=23267
MYSQL_USER=daidai_app
MYSQL_PASSWORD=你的密码
MYSQL_DATABASE=daidaiyx
```

云托管服务与 MySQL **同环境** 时，优先用内网地址 `10.35.103.13:3306`，更稳更快。

### COS 图片持久化（推荐）

去 [腾讯云 COS 控制台](https://console.cloud.tencent.com/cos) 创建存储桶（地域建议 **上海**），然后在云托管配置：

| 变量名 | 用途 |
|--------|------|
| `COS_SECRET_ID` | 腾讯云 API 密钥 |
| `COS_SECRET_KEY` | 腾讯云 API 密钥 |
| `COS_BUCKET` | 存储桶名称，如 `daidaiyx-125xxxxxxx` |
| `COS_REGION` | 地域，如 `ap-shanghai` |
| `COS_BASE_URL` | 可选，自定义 CDN/域名 |

```
COS_SECRET_ID=你的SecretId
COS_SECRET_KEY=你的SecretKey
COS_BUCKET=daidaiyx-125xxxxxxx
COS_REGION=ap-shanghai
```

配置后，AI 生图/改图会自动上传到 COS；重部署后仍可通过 `/api/image/file/:id` 访问（本地没有会从 COS 拉回）。

**不要设** `DAIDAI_IMAGE_PROXY_ASYNC=1`。

### 推荐生图配置

```
DAIDAI_IMAGE_BASE_URL=http://154.12.94.236
DAIDAI_IMAGE_KEY=sk-你的密钥
DAIDAI_API_BASE=https://dai.52xv.com
```

路径：云托管 → VPS nginx → OpenAI。VPS 健康检查：`http://154.12.94.236/health`。
