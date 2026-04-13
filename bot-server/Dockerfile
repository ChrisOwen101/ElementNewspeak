# Multi-stage Dockerfile for the Dynamic Room Bot Server

# ─── Build Stage ────────────────────────────────────────────────────────────

FROM node:22-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

# Copy package files
COPY bot-server/package*.json ./

# Install dependencies (including devDependencies for TypeScript compilation)
RUN npm install

# Copy source code
COPY bot-server/src ./src
COPY bot-server/tsconfig.json ./

# Compile TypeScript
RUN npm run build

# ─── Runtime Stage ──────────────────────────────────────────────────────────

FROM node:22-alpine

WORKDIR /app

# Install runtime dependencies
# - curl: for health checks
# - python3: may be needed by some npm packages
# - git: required for Claude Code
# - bash: required by Claude Code CLI installer
RUN apk add --no-cache curl python3 ca-certificates git bash

# Install Claude Code CLI globally via npm (the shell installer requires glibc)
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files from builder
COPY bot-server/package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy compiled code from builder
COPY --from=builder /app/dist ./dist

# Copy runtime files
COPY bot-server/component-contract.md ./

# Create directories that will be written at runtime
RUN mkdir -p public/bundles renderer-workspace && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the bundle server port (default: 3002)
EXPOSE ${BUNDLE_PORT:-3002}

# Health check — uses the BUNDLE_PORT env var set at runtime
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:${BUNDLE_PORT:-3002}/health || exit 1

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV MATRIX_HOMESERVER_URL=http://matrix:8008
ENV BUNDLE_PORT=3002
ENV BUNDLE_BASE_URL=http://localhost:3002

# Start the bot server
CMD ["node", "dist/index.js"]
