FROM node:18-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY lib ./lib
COPY admin ./admin
COPY site ./site
RUN mkdir -p /app/data

ENV PORT=80
EXPOSE 80

CMD ["npm", "start"]
