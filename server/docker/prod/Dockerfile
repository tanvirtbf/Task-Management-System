FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


FROM node:20-alpine AS production

ENV NODE_ENV=prod

WORKDIR /app

COPY package*.json ./

RUN npm ci --ignore-scripts --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/src/db/migrations ./dist/db/migrations

EXPOSE 5501

CMD ["node", "dist/server.js"]
