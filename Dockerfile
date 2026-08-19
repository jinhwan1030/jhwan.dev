FROM node:24-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=80 \
    JHWAN_DATABASE_PATH=/app/.data/jhwan.db \
    JHWAN_MEDIA_PATH=/app/.data/uploads \
    JHWAN_CONTENT_SEED_PATH=/app/src/content/blog
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
COPY database ./database
COPY src/content/blog ./src/content/blog
RUN apk add --no-cache libcap \
    && setcap cap_net_bind_service=+ep /usr/local/bin/node \
    && mkdir -p /app/.data \
    && chown node:node /app/.data
USER node
EXPOSE 80
CMD ["node", "./dist/server/entry.mjs"]
