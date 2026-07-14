FROM node:18-alpine AS ui-builder

WORKDIR /app/web-ui
COPY web-ui/package.json web-ui/package-lock.json ./
RUN npm ci
COPY web-ui/ ./
RUN npm run build

FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY --from=ui-builder /app/web-ui/dist ./web-ui/dist

ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
