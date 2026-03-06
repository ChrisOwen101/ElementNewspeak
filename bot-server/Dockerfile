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
RUN apk add --no-cache curl python3 ca-certificates

# Install Claude Code
# Note: Replace this with the actual installation method for Claude Code.
# This assumes Claude Code is available as an npm package or via a CLI installer.
# You may need to adjust based on Anthropic's distribution method.
RUN npm install -g @anthropic-ai/claude-code || npm install -g claude-code

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
COPY bot-server/.env.example ./.env.example

# Create directories that will be written at runtime
RUN mkdir -p public/bundles renderer-workspace && \
    chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

# Expose the bundle server port (default: 3001)
EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3001/health || exit 1

# Environment variables (can be overridden at runtime)
ENV NODE_ENV=production
ENV MATRIX_HOMESERVER_URL=http://matrix:8008
ENV BUNDLE_PORT=3001
ENV BUNDLE_BASE_URL=http://localhost:3001

# Start the bot server
CMD ["node", "dist/index.js"]
