/**
 * Environment bindings for the Iny ingestion worker.
 */
export interface Env {
  /** R2 bucket binding containing markdown documents */
  DOCS_BUCKET: R2Bucket;
  /** Cloudflare Queue binding receiving R2 event notifications */
  INGEST_QUEUE: Queue;
  /** Secret API key for authenticating against the Iny /api/ingest endpoint */
  INGEST_API_KEY: string;
  /** Destination endpoint URL for Iny document ingestion (e.g. https://iny.example.com/api/ingest) */
  INGEST_API_URL: string;
}

/**
 * Payload structure of an R2 event notification message.
 */
export interface R2EventNotification {
  /** Account ID where the event occurred */
  account?: string;
  /** Event action (e.g., PutObject, CopyObject, CompleteMultipartUpload, DeleteObject) */
  action?: string;
  /** Source R2 bucket name */
  bucket?: string;
  /** Object metadata */
  object?: {
    /** File path/name of the object */
    key?: string;
    /** Size of the object in bytes */
    size?: number;
    /** Entity tag (ETag) */
    eTag?: string;
    /** Object version identifier if enabled */
    version?: string;
  };
  /** ISO timestamp when the event occurred */
  eventTime?: string;
}

/**
 * Parses and validates the queue message body into an R2EventNotification.
 *
 * @param body The raw message body from Cloudflare Queues.
 * @returns The parsed R2EventNotification or null if parsing fails.
 */
function parseNotification(body: unknown): R2EventNotification | null {
  if (typeof body === "string") {
    try {
      return JSON.parse(body) as R2EventNotification;
    } catch {
      return null;
    }
  }

  if (body !== null && typeof body === "object") {
    return body as R2EventNotification;
  }

  return null;
}

/**
 * Cloudflare Worker that consumes R2 event notifications from a Cloudflare Queue,
 * fetches markdown documents from R2, and forwards them to the Iny ingestion API.
 */
export default {
  /**
   * Queue consumer handler that processes incoming batches of R2 event notifications.
   *
   * @param batch The batch of messages dispatched by Cloudflare Queues.
   * @param env Environment variables and resource bindings.
   */
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      let key: string | undefined;

      try {
        const payload = parseNotification(message.body);
        key = payload?.object?.key;

        // Verify that an object key was provided
        if (!key || typeof key !== "string") {
          console.warn(
            `[iny-ingest-worker] Message ${message.id} does not contain an R2 object key. Acknowledging and skipping.`
          );
          message.ack();
          continue;
        }

        // Only process markdown files (.md extension)
        if (!key.endsWith(".md")) {
          console.info(
            `[iny-ingest-worker] Skipping non-markdown file: "${key}". Acknowledging message.`
          );
          message.ack();
          continue;
        }

        console.info(`[iny-ingest-worker] Processing markdown document: "${key}"`);

        // Fetch the file content from the R2 bucket
        const object = await env.DOCS_BUCKET.get(key);
        if (!object) {
          console.warn(
            `[iny-ingest-worker] Object "${key}" not found in R2 bucket (it may have been deleted). Acknowledging message.`
          );
          message.ack();
          continue;
        }

        // Read text content from the R2 object body
        const content = await object.text();

        // POST the file to the Iny server's ingest API
        const response = await fetch(env.INGEST_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.INGEST_API_KEY}`,
          },
          body: JSON.stringify({
            fileName: key,
            content,
          }),
        });

        if (response.ok) {
          console.info(
            `[iny-ingest-worker] Successfully ingested "${key}" (status ${response.status}).`
          );
          message.ack();
        } else if (response.status >= 500) {
          // Upstream / 5xx error: transient failure, retry message
          const errorText = await response.text().catch(() => "Unknown server error");
          console.error(
            `[iny-ingest-worker] Server error (HTTP ${response.status}) ingesting "${key}": ${errorText}. Scheduling retry.`
          );
          message.retry();
        } else {
          // Client / 4xx error: permanent/deterministic failure, acknowledge to avoid poison-pill retry loops
          const errorText = await response.text().catch(() => "Unknown client error");
          console.error(
            `[iny-ingest-worker] Client error (HTTP ${response.status}) ingesting "${key}": ${errorText}. Acknowledging message to prevent infinite retries.`
          );
          message.ack();
        }
      } catch (error) {
        console.error(
          `[iny-ingest-worker] Unexpected exception processing message ${message.id} (key: "${key ?? "unknown"}"):`,
          error
        );
        // Retry message on unexpected failures (such as network connectivity issues)
        message.retry();
      }
    }
  },
};
