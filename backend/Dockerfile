# syntax=docker/dockerfile:1.7

# --- 1. Install deps (cached layer) ---
FROM node:20-alpine AS deps
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY prisma ./prisma
RUN npm ci

# --- 2. Build ---
FROM node:20-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build
RUN npm prune --omit=dev

# --- 3. Runtime ---
FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache openssl tini \
  && addgroup -S app && adduser -S app -G app

COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
# tsconfig.json is needed at runtime so `ts-node prisma/seed.ts` (the prisma seed)
# compiles as CommonJS. Without it ts-node falls back to ESM and Node 20 fails on
# the seed's top-level await with ERR_UNKNOWN_FILE_EXTENSION for ".ts".
COPY --from=build --chown=app:app /app/tsconfig.json ./tsconfig.json

USER app
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health/live || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/main.js"]
