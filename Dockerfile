# ── Build stage ─────────────────────────────
FROM node:20-bookworm-slim AS build

WORKDIR /app

# Tools needed to compile the better-sqlite3 native addon.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Runtime stage ───────────────────────────
FROM node:20-bookworm-slim

ENV NODE_ENV=production
ENV PORT=8080
ENV DATA_DIR=/data

WORKDIR /app

# Install Litestream for continuous SQLite replication to GCS.
# Default to amd64 (Cloud Build / Cloud Run target). BuildKit auto-injects
# TARGETARCH (e.g. arm64 on Apple Silicon) which overrides this default.
ARG TARGETARCH=amd64
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && curl -fsSL "https://github.com/benbjohnson/litestream/releases/download/v0.3.13/litestream-v0.3.13-linux-${TARGETARCH}.deb" -o /tmp/litestream.deb \
 && dpkg -i /tmp/litestream.deb \
 && rm /tmp/litestream.deb \
 && apt-get purge -y --auto-remove curl \
 && rm -rf /var/lib/apt/lists/*

# Non-root user; /data is where SQLite lives (restored from GCS at startup).
RUN groupadd -r app && useradd -r -g app app \
 && mkdir -p /data && chown -R app:app /data

COPY --from=build /app/node_modules ./node_modules
COPY . .

COPY litestream.yml /etc/litestream.yml
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER app

EXPOSE 8080

CMD ["/usr/local/bin/docker-entrypoint.sh"]
