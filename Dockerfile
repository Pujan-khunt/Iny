FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json ./
RUN npm ci

COPY src/ src/
COPY scripts/ scripts/
RUN npm run build

# Static assets aren't compiled by tsc — copy them so the web server
# can resolve index.html relative to the compiled JS via import.meta.url.
RUN cp -r src/web/public dist/src/web/public


FROM node:22-alpine AS runner

# pdftotext is needed for the ingest pipeline (poppler-utils)
RUN apk add --no-cache poppler-utils

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Compiled JS + static web assets from builder
COPY --from=builder /app/dist ./dist

# Drizzle migrations + config (for `npx drizzle-kit push` via docker exec)
COPY drizzle/ drizzle/
COPY drizzle.config.ts ./

# pgvector init script (used by docker-compose volume mount on db, but
# kept here so the image is self-contained for reference)
COPY docker/ docker/

ENV NODE_ENV=production

CMD ["node", "dist/src/index.js"]
