FROM node:18-alpine

WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY admin ./admin
COPY site ./site
RUN mkdir -p /app/data
VOLUME ["/app/data"]

ENV PORT=80
EXPOSE 80
ENV DATA_DIR=/app/data

CMD ["npm", "start"]
