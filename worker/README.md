# Iny Ingest Worker (`iny-ingest-worker`)

A Cloudflare Worker that powers the automated document ingestion pipeline for Iny.

## Overview

This Worker listens for Cloudflare R2 event notifications delivered via Cloudflare Queues. When a new Markdown (`.md`) file is created or updated in the designated R2 bucket:
1. The Worker receives the queue notification containing the object key.
2. It verifies that the file has a `.md` extension.
3. It retrieves the object contents directly from the R2 bucket.
4. It sends an authenticated HTTP POST request to the Iny server's `/api/ingest` endpoint with the payload `{ fileName, content }`.
5. It acknowledges (`ack()`) the message on success or client error (4xx), or requests a retry (`retry()`) on transient server errors (5xx) or network failures.

```
┌──────────────┐   Object Create   ┌──────────────────┐
│  R2 Bucket   │──────────────────▶│ Cloudflare Queue │
│  (iny-docs)  │    (*.md only)    │(iny-ingest-queue)│
└──────────────┘                   └────────┬─────────┘
                                            │
                                            ▼
                                   ┌──────────────────┐
                                   │  Ingest Worker   │
                                   └────────┬─────────┘
                                            │ POST { fileName, content }
                                            │ Bearer <INGEST_API_KEY>
                                            ▼
                                   ┌──────────────────┐
                                   │    Iny Server    │
                                   │   /api/ingest    │
                                   └──────────────────┘
```

---

## Setup & Prerequisites

### 1. Install Dependencies

```bash
cd /home/pujan/iny/worker
npm install
```

### 2. Configure R2 Bucket in `wrangler.toml`

Open `wrangler.toml` and update the `bucket_name` in `DOCS_BUCKET` if your bucket has a different name:

```toml
[[r2_buckets]]
binding = "DOCS_BUCKET"
bucket_name = "iny-docs"
```

### 3. Configure Secrets

Set the required environment secrets via the Wrangler CLI:

```bash
# Set the shared API authorization token
npx wrangler secret put INGEST_API_KEY

# Set the Iny server ingestion endpoint URL
npx wrangler secret put INGEST_API_URL
```

> **Note:** For local development, you can create a `.dev.vars` file (ignored by git):
> ```env
> INGEST_API_KEY=your-dev-secret-key
> INGEST_API_URL=http://localhost:3000/api/ingest
> ```

---

## How R2 Event Notifications Work with Queues

Cloudflare R2 allows buckets to emit event notifications directly to a Cloudflare Queue when objects are created, modified, or deleted.

> **Important:** R2 event notifications to Queues are configured in the **Cloudflare Dashboard**, **NOT** in `wrangler.toml`.

### Setting Up R2 Event Notifications in the Dashboard

1. Log in to the [Cloudflare Dashboard](https://dash.cloudflare.com/) and navigate to **R2**.
2. Select your bucket (e.g., `iny-docs`).
3. Click the **Settings** tab.
4. Under **Event notifications**, click **Add notification rule**.
5. Configure the rule:
   - **Rule name**: `iny-md-uploads`
   - **Event types**: Select **Object Create** (covers `PutObject`, `CopyObject`, `CompleteMultipartUpload`).
   - **Prefix filter**: *(Leave blank unless scoping to a subfolder)*
   - **Suffix filter**: `.md` (ensures only Markdown files trigger events).
   - **Destination Queue**: Select `iny-ingest-queue`.
6. Save the notification rule.

---

## Deployment

Deploy the worker to Cloudflare:

```bash
npm run deploy
```

To run a local dev session:

```bash
npm run dev
```

To regenerate TypeScript definitions for bindings:

```bash
npm run types
```
