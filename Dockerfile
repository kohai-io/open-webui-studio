FROM node:22.17.0-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:22.17.0-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    BODY_SIZE_LIMIT=12M
WORKDIR /app
RUN addgroup -S studio && adduser -S studio -G studio
COPY --from=build --chown=studio:studio /app/build ./build
COPY --from=build --chown=studio:studio /app/package.json ./package.json
COPY --from=build --chown=studio:studio /app/package-lock.json ./package-lock.json
COPY --from=build --chown=studio:studio /app/node_modules ./node_modules
COPY --from=build --chown=studio:studio /app/migrations ./migrations
RUN mkdir -p /app/data && chown studio:studio /app/data
USER studio
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/studio/health >/dev/null || exit 1
CMD ["node", "build"]
