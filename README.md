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
| `DAIDAI_IMAGE_KEY` | 呆呆 Image 密钥（OpenAI `sk-`，**仅生图/改图**） |
| `DAIDAI_IMAGE_BASE_URL` | **`http://154.12.94.236`**（国外 VPS 中转，不要加 `/v1`） |
| `DOUBAO_ARK_API_KEY` | 火山方舟 API Key（**仅识图**，也可用 `ARK_API_KEY`） |
| `DOUBAO_VISION_MODEL` | 可选，默认 `doubao-1.5-vision-pro` |
| `DAIDAI_API_BASE` | `https://dai.52xv.com` |
| `MYSQL_ADDRESS` | 云托管 MySQL 内网地址（控制台 MySQL 页，格式 `IP:端口`） |
| `MYSQL_USERNAME` | 云托管 MySQL 用户名 |
| `MYSQL_PASSWORD` | 云托管 MySQL 密码 |
| `SMTP_HOST` | 邮箱 SMTP，QQ 邮箱填 `smtp.qq.com`（可省略，默认已是这个） |
| `SMTP_PORT` | `465` |
| `SMTP_USER` | 你的 QQ 邮箱，如 `123456@qq.com` |
| `SMTP_PASS` | QQ 邮箱 **授权码**（不是 QQ 密码） |
| `SMTP_FROM` | 可选，默认 `呆呆网络 <你的QQ邮箱>` |

登录支持 **QQ / Gmail / 网易邮箱** 验证码（个人主体小程序不支持微信手机号快捷登录）。

#### 邮箱验证码（免费，QQ SMTP 发信）

1. 打开 [QQ 邮箱](https://mail.qq.com) → 设置 → 账户  
2. 找到「POP3/IMAP/SMTP…」→ 开启 **SMTP** → 生成 **授权码**  
3. 云托管环境变量填：

```
SMTP_HOST=smtp.qq.com
SMTP_PORT=465
SMTP_USER=你的QQ号@qq.com
SMTP_PASS=你的授权码
SMTP_FROM=呆呆网络 <你的QQ号@qq.com>
```

用户收到的发件人会显示为「呆呆网络」。可向 QQ、Gmail、163/126 等邮箱发验证码。

配置 MySQL 后，业务数据写入数据库，重部署不丢。

### 云托管 MySQL（按官方文档 / Express 模板）

官方只要求这三个环境变量（见[容器内变量信息](https://developers.weixin.qq.com/miniprogram/dev/wxcloudservice/wxcloudrun/src/development/weixin/index)、[wxcloudrun-express](https://github.com/WeixinCloud/wxcloudrun-express)）：

```
MYSQL_ADDRESS=10.x.x.x:3306
MYSQL_USERNAME=root
MYSQL_PASSWORD=你开通时设的密码
```

值在控制台 **MySQL** 页查看。模板一键部署会自动注入；手动开通或二次部署须在「服务设置」自行补全。

库名与官方 Express 模板一致，代码内写死为 `nodejs_demo`（控制台不提供库名，勿再填其它库名变量）。

服务版本监听端口填 **80**。

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
