# Feature Specification: Containerization & Deployment Orchestration

- **Status**: Draft (Awaiting Human Review)
- **Date**: 2026-09-30
- **Author**: Antigravity & Pujan

---

## 1. Overview & Objectives

With the completion of PostgreSQL-backed conversation memory (`dialogue_turns`) and database-backed WhatsApp authentication storage (`whatsapp_auth`), Iny has achieved **complete compute layer statelessness**. The application runtime no longer requires persistent host filesystem directory bindings, host volume permissions, or local file locking for `.baileys_auth/`.

This specification defines the production-grade **containerization and deployment orchestration** strategy for Iny, packaging the application into a lean, secure, multi-stage Docker container and orchestrating it alongside PostgreSQL 16 via Docker Compose on a single Linux host (including Oracle Cloud Infrastructure / OCI Ampere A1 ARM64 and standard x86_64 architectures).

### Goals
1. **Multi-Stage `Dockerfile`**:
   - Standardize on `node:22-bookworm-slim` for both `builder` and `runner` stages to guarantee `glibc` runtime binary compatibility with native modules (specifically `@whiskeysockets/baileys`' native `whatsapp-rust-bridge` dependency) across ARM64 (aarch64) and x86_64 architectures.
   - Separate build-time tooling (TypeScript compiler, development dependencies) from runtime artifacts to produce a minimal, hardened image (~150MB).
   - Enforce least-privilege security by executing the runtime container as the non-root `node` user.
2. **Docker Compose Orchestration (`docker-compose.yml`)**:
   - Orchestrate two coordinated services: `db` (`postgres:16-alpine`) and `app` (`iny`).
   - Define a dedicated bridge network (`iny-network`) for internal container-to-container communication.
   - Enforce reliable service startup ordering using PostgreSQL healthchecks (`pg_isready`) so the application never boots against an unready database.
   - Bind PostgreSQL port `5432` strictly to host loopback (`127.0.0.1:5432:5432`) to shield the database from the public internet while allowing secure SSH tunnel inspection.
   - Persist database state using a named Docker volume (`postgres_data`).
3. **Automated Runtime Migrations**:
   - Ensure SQL migration files (`drizzle/migrations/`) are packaged into the runner container so Iny's built-in `runDatabaseMigrations` automatically synchronizes database schemas on startup.
4. **Lifecycle & Signal Handling**:
   - Propagate Docker `SIGTERM`/`SIGINT` shutdown signals directly to Node.js, triggering Iny's graceful shutdown handler (closing the active WhatsApp socket and terminating the PostgreSQL connection pool).
5. **Observability & Interactive Pairing**:
   - Enable transparent discovery of WhatsApp 8-digit pairing codes via standard Docker logging (`docker compose logs -f app`).
6. **Zero-Trust Verification**:
   - Provide an automated, deterministic verification workflow to test the container build, startup sequence, healthchecks, and teardown offline.

### Non-Goals
- Multi-host distributed Kubernetes clustering or Docker Swarm (Iny is an autonomous single-instance bot; WhatsApp Web protocol enforces a single active socket connection per registered account).
- Public ingress reverse proxy (e.g. Nginx / Traefik / Caddy) or SSL certificate termination (Iny communicates outbound via WebSockets to WhatsApp servers; it exposes no public HTTP endpoints).
- CI/CD container registry publishing pipelines (addressed in subsequent operational specs).

---

## 2. Architecture & Deployment Topology

```text
Host Environment (e.g., OCI Ampere A1 ARM64 VPS / Linux Host)
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                                                                                        │
│  Loopback Interface (127.0.0.1)                                                        │
│  └── 127.0.0.1:5432 ─── (SSH Tunnel: ssh -L 5432:localhost:5432) ─── Developer Laptop│
│           │                                                                            │
│           ▼                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Docker Network: iny-network (bridge)                                             │  │
│  │                                                                                  │  │
│  │  ┌───────────────────────────────┐        ┌───────────────────────────────────┐  │  │
│  │  │ Service: db                   │        │ Service: app                      │  │  │
│  │  │ Image: postgres:16-alpine     │        │ Image: iny:latest                 │  │  │
│  │  │ User: postgres                │        │ User: node (UID 1000)             │  │  │
│  │  │ Port: 5432 (Internal & 127.0) │◄───────│ URL: postgres://...@db:5432/iny   │  │  │
│  │  │ Volume: postgres_data         │        │ Migrations: run on startup        │  │  │
│  │  │ Healthcheck: pg_isready       │        │ Network: Outbound WSS to WhatsApp │  │  │
│  │  └───────────────────────────────┘        └───────────────────────────────────┘  │  │
│  │                 ▲                                                                │  │
│  └─────────────────┼────────────────────────────────────────────────────────────────┘  │
│                    │                                                                   │
│  Named Volume: postgres_data (/var/lib/postgresql/data)                                │
│                                                                                        │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Architectural Invariants
1. **Hexagonal Boundaries Preserved**: Containerization is purely an infrastructure and deployment concern. No files in `src/core/` are altered.
2. **Stateless App Container**: The `app` container holds zero runtime state on its root filesystem. All state is held in the `db` container's `postgres_data` volume.
3. **Public Interface Isolation**: Port 5432 is strictly bound to `127.0.0.1`. It is physically inaccessible from any external network interface (`eth0`).

---

## 3. Component Design & Implementation Details

### 3.1. `.dockerignore`

To keep build contexts minimal, speed up build cache evaluation, and prevent leaking sensitive files into images:

```text
# Git & Worktrees
.git
.gitignore
.worktrees/

# Dependencies & Build Outputs
node_modules/
dist/

# Development & Testing
tests/
coverage/
.superpowers/

# Documentation & Specifications
docs/
*.md

# Environment & Local Secrets
.env
.env.*
!.env.example

# Temporary & Log Files
*.log
.DS_Store
```

---

### 3.2. Multi-Stage `Dockerfile`

The `Dockerfile` employs a 2-stage build targeting `node:22-bookworm-slim`:

```dockerfile
# ==========================================
# Stage 1: Build & Compilation
# ==========================================
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Install dependencies needed for compilation
COPY package*.json ./
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

# Install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled JavaScript from builder
COPY --from=builder /app/dist ./dist

# Copy Drizzle SQL migrations and journal for startup migrator
COPY drizzle/ ./drizzle/

# Switch to unprivileged non-root user built into the node base image
USER node

# Execute Iny with Node source maps enabled for legible error stack traces
CMD ["node", "--enable-source-maps", "dist/index.js"]
```

#### Key Technical Decisions:
1. **`node:22-bookworm-slim`**:
   - Ensures `glibc` is present for native bindings like `whatsapp-rust-bridge`, preventing `musl` segfaults on ARM64 Ampere chips.
   - Slim variants discard man pages, compilers, and extraneous packages to maintain a minimal ~150MB image footprint.
2. **`npm ci --omit=dev` in Stage 2**:
   - Excludes heavy dev dependencies (`typescript`, `vitest`, `pg-mem`, `pino-pretty`) from the final runtime container.
3. **Migration Directory Bundling**:
   - Iny's `migrator.ts` invokes `migrate(db, { migrationsFolder: './drizzle/migrations' })`. Bundling `./drizzle/` into the runner allows startup migrations to run without requiring external volume mounts.
4. **`USER node`**:
   - Adheres to the principle of least privilege, mitigating container breakout risks.

---

### 3.3. Docker Compose Orchestration (`docker-compose.yml`)

```yaml
services:
  db:
    image: postgres:16-alpine
    container_name: iny-db
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-iny}
      POSTGRES_USER: ${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?Database password must be set in .env}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      # Bound strictly to loopback interface on the host; completely shielded from public internet
      - "127.0.0.1:5432:5432"
    networks:
      - iny-network
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-iny}"]
      interval: 5s
      timeout: 5s
      retries: 5
      start_period: 5s

  app:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: iny-app
    restart: unless-stopped
    env_file:
      - .env
    environment:
      # Point Iny to the internal Docker network database service
      DATABASE_URL: postgresql://${POSTGRES_USER:-postgres}:${POSTGRES_PASSWORD}@db:5432/${POSTGRES_DB:-iny}
    depends_on:
      db:
        condition: service_healthy
    networks:
      - iny-network

volumes:
  postgres_data:
    name: iny_postgres_data

networks:
  iny-network:
    name: iny_network
    driver: bridge
```

#### Key Technical Decisions:
1. **Healthcheck-Driven Dependency**:
   - `depends_on: db: { condition: service_healthy }` ensures the `app` container does not boot until PostgreSQL is accepting TCP connections and the `iny` database is initialized. This eliminates startup connection race conditions.
2. **`127.0.0.1:5432:5432` Loopback Port**:
   - Binding exclusively to `127.0.0.1` ensures that port 5432 is unreachable from outside the host.
   - Allows developers to open an SSH tunnel (`ssh -L 5432:localhost:5432 user@vps`) to inspect tables using local GUI tools (TablePlus, DBeaver) or local Drizzle Studio (`npx drizzle-kit studio`).
3. **Environment Separation**:
   - `env_file: .env` passes LLM credentials, phone numbers, and allowlists.
   - `DATABASE_URL` in the compose service definition overrides any local `localhost` database URL from the `.env` file, automatically pointing to `db:5432`.

---

### 3.4. Environment Configuration Updates (`.env.example`)

Update `.env.example` to provide clear guidance for containerized deployments:

```env
# ==========================================
# Iny Application Configuration
# ==========================================

# DeepSeek LLM Credentials
DEEPSEEK_API_KEY=your_deepseek_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash

# System Prompt & Autonomous ReAct Limits
SYSTEM_PROMPT=You are Iny, a helpful WhatsApp personal assistant.
MAX_TOOL_ITERATIONS=5
MAX_HISTORY_TURNS=10

# WhatsApp Identity & Access Control
# Bot phone number with country code, no symbols (e.g. 15551234567)
BOT_PHONE_NUMBER=15551234567
# Comma-separated list of allowed user phone numbers or JIDs
ALLOWED_USERS=15551234567, 15559876543@s.whatsapp.net

# Logging Level (trace, debug, info, warn, error, fatal)
LOG_LEVEL=info

# ==========================================
# PostgreSQL Database Configuration
# ==========================================
# Database credentials used by docker-compose
POSTGRES_DB=iny
POSTGRES_USER=postgres
POSTGRES_PASSWORD=replace_with_secure_password_in_production

# Local connection URL (used when running outside Docker)
# In Docker Compose, the app container connects via db:5432 automatically
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iny
DB_MAX_CONNECTIONS=10
```

---

## 4. Operational Lifecycle & Workflows

### 4.1. First-Time Setup on VPS
1. Clone repository onto VPS:
   ```bash
   git clone https://github.com/Pujan-khunt/Iny.git /opt/iny
   cd /opt/iny
   ```
2. Create production `.env`:
   ```bash
   cp .env.example .env
   # Edit .env with production credentials and secure POSTGRES_PASSWORD
   ```
3. Start stack in detached mode:
   ```bash
   docker compose up -d --build
   ```
4. Pair WhatsApp device:
   ```bash
   docker compose logs -f app
   ```
   Output:
   ```text
   {"level":30,"time":1775023000000,"msg":"Applying database migrations..."}
   {"level":30,"time":1775023000050,"msg":"Database migrations applied successfully"}
   {"level":30,"time":1775023000100,"msg":"WhatsApp pairing code generated: 9283-4819"}
   ```
   Enter the 8-digit code into WhatsApp (`Linked Devices > Link with phone number`).
5. Credentials automatically save to the PostgreSQL `whatsapp_auth` table in `postgres_data`. The bot remains authenticated across future container restarts and upgrades.

### 4.2. Upgrading Iny
Because state is decoupled into `postgres_data`, upgrading the bot is completely zero-downtime-capable:
```bash
git pull origin main
docker compose build app
docker compose up -d app
```
The new `app` container boots, runs any new Drizzle migrations, re-attaches to the existing PostgreSQL credentials in milliseconds, and resumes message processing.

### 4.3. Inspecting the Database Remotely

#### Option A: Local Laptop Desktop GUI (TablePlus, DBeaver, pgAdmin)
Open an SSH tunnel from your local machine:
```bash
ssh -L 5432:localhost:5432 ubuntu@your-vps-ip
```
Connect your local desktop GUI to `localhost:5432` (User: `postgres`, Password: `<POSTGRES_PASSWORD>`, Database: `iny`).

#### Option B: Local Drizzle Studio
With the SSH tunnel active:
```bash
# In your local project repository:
npx drizzle-kit studio
```
Open `http://localhost:4983` in your browser. It visualizes remote VPS tables locally through the tunnel.

#### Option C: Host CLI via `docker exec`
On the VPS:
```bash
docker compose exec -it db psql -U postgres -d iny
```

---

## 5. Edge Cases & Mitigations

| Edge Case | Failure Mode | Mitigation |
|---|---|---|
| **Database starts slower than app** | App throws connection refused on startup. | `depends_on: db: { condition: service_healthy }` halts `app` boot until `pg_isready` succeeds. |
| **Container terminated unexpectedly (`SIGTERM` / `SIGINT`)** | Unclosed sockets or orphaned connection pools. | Iny's `src/index.ts` captures signals, ends the active WhatsApp socket, and closes the `postgres.js` pool before exit. |
| **ARM64 Native Addon Incompatibilities** | Native Rust addons crash on Alpine `musl`. | Using Debian-based `node:22-bookworm-slim` guarantees standard `glibc` binary interface on ARM64 and x86_64. |
| **Accidental Database Exposure** | Port 5432 opened to internet scanners. | Hardcoded loopback binding `127.0.0.1:5432:5432` prevents Docker from publishing port to external interfaces. |
| **Missing Migration Files in Production** | App boots but crashes querying non-existent tables. | Dockerfile explicitly copies `./drizzle/` into the runner image. |

---

## 6. Testing & Quality Assurance Plan

To adhere to our Zero-Trust Principle, containerization must be deterministically verified:

1. **Static Analysis & Linting**:
   - Validate `Dockerfile` syntax and non-root user declaration.
   - Validate `docker-compose.yml` config using `docker compose config`.
2. **Image Build Verification**:
   - Build image locally: `docker build -t iny:test .`.
   - Verify non-root user: `docker run --rm iny:test whoami` returns `node`.
   - Verify image size is lean (< 250MB).
3. **Orchestration & Startup Verification**:
   - Launch temporary test compose environment with test credentials.
   - Confirm `db` transitions to `healthy`.
   - Confirm `app` automatically executes startup migrations without errors.
   - Confirm `app` reaches the WhatsApp connection initialization phase.
   - Confirm graceful shutdown: `docker compose down` exits cleanly with code 0.
4. **Offline Test Suite Integrity**:
   - Confirm `npm test` continues to run 100% offline with all 196 unit tests passing.
