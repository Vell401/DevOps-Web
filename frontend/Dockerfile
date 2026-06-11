# syntax=docker/dockerfile:1.7

# --- 1. Build SPA ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
# VITE_API_URL is baked at build time. Override via build-arg.
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build

# --- 2. Serve via nginx (unprivileged: master + workers run as uid 101,
# matching the backend's non-root hardening; listens on 8080, not 80) ---
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

# Patch OS packages in our own layer: the upstream tag is rebuilt on nginx's
# cadence, so between rebuilds it can ship known-vulnerable libs (e.g.
# CVE-2026-31789 in libcrypto3/libssl3) and the CI Trivy gate fails the build.
# apk needs root; drop back to the image's unprivileged uid right after.
USER root
RUN apk upgrade --no-cache
USER 101

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
