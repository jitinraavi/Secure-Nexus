# ==========================================
# Groundwork Production Multi-Stage Container
# Node 22 (node:sqlite DatabaseSync support)
# ==========================================

# Stage 1: Build client and server
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Install build dependencies
COPY package.json package-lock.json ./
COPY server/package.json ./server/
COPY client/package.json ./client/

RUN npm ci

# Copy source trees
COPY server ./server
COPY client ./client
COPY tsconfig.json ./

# Compile client frontend and server backend
RUN npm run build -w client
RUN npm run build -w server

# Prune devDependencies for production
RUN npm prune --omit=dev

# Stage 2: Hardened Production Runtime
FROM node:22-bookworm-slim AS runner
WORKDIR /app

# Install curl for container health check
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=4000
ENV GROUNDWORK_DATA_DIR=/data

# Create persistent storage directory with proper permissions
RUN mkdir -p /data && chown -R node:node /data /app

# Copy production node_modules and compiled bundles from builder
COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/server/package.json ./server/package.json
COPY --chown=node:node --from=builder /app/server/dist ./server/dist
COPY --chown=node:node --from=builder /app/client/dist ./client/dist

USER node

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:4000/api/health || exit 1

VOLUME ["/data"]

CMD ["node", "--disable-warning=ExperimentalWarning", "server/dist/index.js"]
