# 呆呆网络 · daidaiyx

微信云托管可部署的 Express 服务，首页是「呆呆接星」小游戏。

## 本地试玩

```bash
npm install
npm start
```

浏览器打开：http://127.0.0.1:80  
（Windows 若 80 端口权限不够，可设 `$env:PORT=3000; npm start`，再访问 http://127.0.0.1:3000）

## 部署到微信云托管（上传代码包）

1. 打开服务 `daidaiyx` → **部署发布**
2. **选择方式**选：**上传代码包**（不要绑 GitHub）
3. 上传本目录打好的 `daidaiyx-deploy.zip`
4. **端口填 `80`**
5. 点发布，等运行中
6. 用服务详情里的**公网域名**打开，即可玩到游戏

打 zip（在项目根目录 PowerShell）：

```powershell
Compress-Archive -Path Dockerfile,package.json,server.js,public -DestinationPath daidaiyx-deploy.zip -Force
```

注意：zip **根目录**要直接是这些文件，不要多包一层文件夹。
