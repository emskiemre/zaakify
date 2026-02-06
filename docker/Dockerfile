# Zaakify Dockerfile
# Multi-stage build for minimal production image

# ─── Build Stage ────────────────────────────────────────────────
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files first (Docker cache layer)
COPY package.json pnpm-lock.yaml* ./

# Install dependencies
RUN pnpm install --frozen-lockfile --prod=false

# Copy source
COPY tsconfig.json tsconfig.build.json ./
COPY src/ ./src/
COPY ui/ ./ui/

# Build TypeScript
RUN pnpm build

# ─── Production Stage ──────────────────────────────────────────
FROM node:22-bookworm-slim AS production

# Security: run as non-root
RUN groupadd -r zaakify && useradd -r -g zaakify -m zaakify

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy package files
COPY package.json pnpm-lock.yaml* ./

# Production-only dependencies
RUN pnpm install --frozen-lockfile --prod && pnpm store prune

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui ./ui

# Create data directory
RUN mkdir -p /app/data && chown -R zaakify:zaakify /app

# Switch to non-root user
USER zaakify

# Default config location
ENV BITQLON_CONFIG=/app/data/zaakify.toml

EXPOSE 18800

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD curl -f http://localhost:18800/health || exit 1

CMD ["node", "dist/cli/index.js", "gateway", "--config", "/app/data/zaakify.toml"]
