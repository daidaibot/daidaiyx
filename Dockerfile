FROM node:18-alpine

WORKDIR /app

# ca-certificates: 云托管出站访问 api.weixin.qq.com 等 HTTPS
# libc6-compat: sharp; font-noto-cjk: 水印「呆呆 AI 生成」中文
RUN apk add --no-cache ca-certificates libc6-compat fontconfig font-noto-cjk \
  && update-ca-certificates

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY admin ./admin
COPY site ./site

# 监听端口须与云托管「服务版本」配置一致（官方默认 80）
ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
