# ==========================================
# Stage 1: Build & Compilation
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies needed for compilation
COPY package*.json .npmrc ./
RUN npm ci

# Copy TypeScript configuration and source files
COPY tsconfig*.json ./
COPY src/ ./src/

# Compile TypeScript to JavaScript in /app/dist
RUN npm run build

# ==========================================
# Stage 2: Minimal Production Runner
# ==========================================
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

# Install system runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils && rm -rf /var/lib/apt/lists/*

# Install only production dependencies
COPY package*.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force && rm -f .npmrc

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy Drizzle SQL migrations and journal for startup migrator
COPY drizzle/ ./drizzle/

# Switch to unprivileged non-root user built into the node base image
USER node

# Execute Iny with Node source maps enabled for legible error stack traces
CMD ["node", "--enable-source-maps", "dist/index.js"]
