import type { IncomingMessage, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { ingestFile, type IngestResult } from "../rag/ingest.js";
import { INGEST_API_KEY, INGEST_MAX_BODY_BYTES } from "../config.js";

interface IngestBody {
  fileName?: unknown;
  content?: unknown;
}

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Validates the Authorization: Bearer <token> header against INGEST_API_KEY.
 * Throws HttpError if the key is missing, malformed, or incorrect.
 */
export function requireBearerAuth(authorizationHeader: string | undefined): void {
  if (!INGEST_API_KEY) {
    throw new HttpError(503, "Ingestion endpoint is not configured. Set INGEST_API_KEY.");
  }

  if (!authorizationHeader || !authorizationHeader.startsWith("Bearer ")) {
    throw new HttpError(401, "Missing or malformed Authorization header.");
  }

  const token = authorizationHeader.slice("Bearer ".length);
  if (token !== INGEST_API_KEY) {
    throw new HttpError(401, "Invalid API key.");
  }
}

export interface IngestHandlerDeps {
  readJsonBody: <T>(request: IncomingMessage, maxBytes?: number) => Promise<T>;
  sendJson: (response: ServerResponse, statusCode: number, body: unknown) => void;
  requireString: (value: unknown, fieldName: string, maxLength: number) => string;
  logger: Logger;
}

/**
 * Handles POST /api/ingest requests.
 * Authenticates via bearer token, validates the markdown payload,
 * and delegates to ingestFile() for parsing, chunking, and embedding.
 */
export async function handleIngest(
  request: IncomingMessage,
  response: ServerResponse,
  deps: IngestHandlerDeps,
): Promise<void> {
  requireBearerAuth(request.headers.authorization);

  const body = await deps.readJsonBody<IngestBody>(request, INGEST_MAX_BODY_BYTES);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }

  const fileName = deps.requireString(body.fileName, "fileName", 512);
  if (!fileName.toLowerCase().endsWith(".md")) {
    throw new HttpError(400, "fileName must end with .md");
  }

  if (typeof body.content !== "string" || !body.content) {
    throw new HttpError(400, "content must be a non-empty string.");
  }
  const content = body.content;

  const buffer = Buffer.from(content, "utf8");
  const result = await ingestFile(fileName, buffer, {
    maxTokens: 500,
    overlapTokens: 50,
    sourceType: "document",
  });

  if (result.chunksCreated === 0) {
    deps.sendJson(response, 200, {
      ...result,
      message: "Document content unchanged, skipped.",
    });
    return;
  }

  deps.logger.info(
    { docId: result.docId, chunks: result.chunksCreated, tokens: result.tokens, fileName },
    "Document ingested via API",
  );

  deps.sendJson(response, 201, result);
}

export { HttpError };
