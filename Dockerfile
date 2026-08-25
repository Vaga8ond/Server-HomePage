# ---- 1. Frontend build (Vite → static dist) ----
# ARGs keep the build portable: CN mirrors are the default (fastest here);
# on an overseas server build with:
#   docker build --build-arg NODE_IMAGE=node:22-alpine --build-arg NPM_REGISTRY=https://registry.npmjs.org .
ARG NODE_IMAGE=mirror.houlang.cloud/dh/library/node:22-alpine
ARG NPM_REGISTRY=https://registry.npmmirror.com

FROM ${NODE_IMAGE} AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
ARG NPM_REGISTRY
RUN sed -i "s#https://registry.npmjs.org#${NPM_REGISTRY}#g" package-lock.json && npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json index.html vite.config.ts ./
COPY src ./src
COPY public ./public
RUN npm run build

# ---- 2. Backend production deps ----
FROM ${NODE_IMAGE} AS backend-deps
WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
ARG NPM_REGISTRY
RUN sed -i "s#https://registry.npmjs.org#${NPM_REGISTRY}#g" package-lock.json && npm ci --omit=dev

# ---- 3. Runtime: one Node process serves dist + /api ----
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# tzdata so TZ names (compose sets Asia/Shanghai) resolve — alpine omits them.
ARG APK_MIRROR=https://mirrors.aliyun.com
RUN sed -i "s#https://dl-cdn.alpinelinux.org#${APK_MIRROR}#g" /etc/apk/repositories \
  && apk add --no-cache tzdata
# Non-root runtime user; node group reused as the docker gid via compose
# group_add so it can read the mounted docker.sock.
RUN addgroup -S nodejs -g 10001 && adduser -S -u 10001 -G nodejs appuser \
  && mkdir -p /app/data && chown 10001:10001 /app/data
ENV NODE_ENV=production
COPY --from=backend-deps --chown=10001:10001 /app/node_modules ./node_modules
COPY --chown=10001:10001 backend/package.json ./package.json
COPY --chown=10001:10001 backend/src ./src
COPY --chown=10001:10001 backend/config ./config
COPY --from=frontend --chown=10001:10001 /app/dist ./public
ENV PORT=8088 \
    STATIC_DIR=/app/public \
    HOST_PROC=/host/proc \
    HOST_SYS=/host/sys \
    HOST_FS=/hostfs
EXPOSE 8088
USER 10001
CMD ["node", "--import", "tsx", "src/index.ts"]
