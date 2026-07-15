FROM node:18-alpine

WORKDIR /app

# libc6-compat: sharp; font-noto-cjk: 水印「呆呆 AI 生成」中文
RUN apk add --no-cache libc6-compat fontconfig font-noto-cjk

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY admin ./admin
COPY site ./site
COPY config ./config
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=80
EXPOSE 80
ENV DATA_DIR=/app/data

CMD ["npm", "start"]
