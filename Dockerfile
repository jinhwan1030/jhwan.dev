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
COPY scripts/lib ./scripts/lib
COPY scripts/backup-content-database.mjs scripts/invalidate-admin-sessions.mjs scripts/migrate-legacy-content.mjs scripts/verify-content-backup.mjs scripts/verify-restored-runtime.mjs ./scripts/
COPY scripts/start-production-server.mjs ./scripts/
COPY src/lib/server ./src/lib/server
COPY src/content/blog ./src/content/blog
COPY src/assets/blog ./src/assets/blog
COPY deploy/raspberry-pi/container-entrypoint.sh /usr/local/bin/jhwan-homepage-entrypoint
RUN apk add --no-cache libcap \
    && setcap cap_net_bind_service=+ep /usr/local/bin/node \
    && mkdir -p /app/.data \
    && chown node:node /app/.data \
    && chmod 0755 /usr/local/bin/jhwan-homepage-entrypoint
USER node
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/jhwan-homepage-entrypoint"]
CMD ["node", "./scripts/start-production-server.mjs"]
