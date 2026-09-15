# syntax=docker/dockerfile:1

# 图片在构建机器上生成，不同目标架构共用成品。
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src ./src
COPY resources/pigs.json ./resources/pigs.json
COPY resources/source ./resources/source
COPY resources/fonts ./resources/fonts
RUN pnpm build

# 生产依赖按目标架构安装，不复用构建阶段的开发依赖。
FROM node:24-bookworm-slim AS production-dependencies
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 运行层只复制生产依赖、服务代码与成品资源。
COPY package.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=builder /app/dist/app.js /app/dist/config.js /app/dist/main.js ./dist/
COPY --from=builder /app/dist/http ./dist/http
COPY --from=builder /app/dist/modules ./dist/modules
COPY --from=builder /app/dist/scripts/healthcheck.js ./dist/scripts/healthcheck.js
COPY --from=builder /app/resources/rendered ./resources/rendered
COPY config.example.yaml ./config.yaml
COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY licenses ./licenses
COPY resources/asset-licenses.json ./resources/asset-licenses.json

USER node
EXPOSE 3000
STOPSIGNAL SIGTERM
# 为 Node 和配置加载留出启动时间；脚本内的 HTTP 请求仍限制为 2 秒。
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --start-interval=2s --retries=3 \
  CMD ["node", "dist/scripts/healthcheck.js"]
CMD ["node", "dist/main.js"]
