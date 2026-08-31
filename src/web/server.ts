import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { askIny, resetSession } from "../core/index.js";
import type { ResponseStyle } from "../core/index.js";
import { initDb, pool } from "../db/index.js";
import { getLogger } from "../logger.js";

const logger = getLogger("web");
const port = Number(process.env.WEB_PORT ?? 3000);
const maxBodyBytes = 32 * 1024;
const indexPath = fileURLToPath(new URL("./public/index.html", import.meta.url));

interface ChatBody {
  sessionId?: unknown;
  message?: unknown;
  style?: unknown;
}

interface ResetBody {
  sessionId?: unknown;
}

class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxBodyBytes) {
      throw new HttpError(413, "Request body is too large.");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    throw new HttpError(400, "A JSON request body is required.");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

function requireString(value: unknown, fieldName: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, `${fieldName} must be a non-empty string.`);
  }

  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw new HttpError(400, `${fieldName} must be ${maxLength} characters or fewer.`);
  }

  return trimmed;
}

async function handleChat(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<ChatBody>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  const sessionId = requireString(body.sessionId, "sessionId", 128);
  const message = requireString(body.message, "message", 8_000);
  let style: ResponseStyle | undefined;

  if (body.style !== undefined) {
    if (body.style !== "concise" && body.style !== "detailed") {
      throw new HttpError(400, "style must be either concise or detailed.");
    }
    style = body.style;
  }

  const result = await askIny({
    sessionId,
    message,
    ...(style ? { style } : {}),
    metadata: {
      channel: "web",
      userId: sessionId,
    },
  });

  sendJson(response, 200, {
    message: result.message,
    citations: result.citations.map(({ title, pageString, preview }) => ({
      title,
      pageString,
      preview,
    })),
    iterations: result.iterations,
    style: result.style,
  });
}

async function handleReset(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const body = await readJsonBody<ResetBody>(request);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new HttpError(400, "Request body must be a JSON object.");
  }
  const sessionId = requireString(body.sessionId, "sessionId", 128);

  resetSession(sessionId);
  sendJson(response, 200, { ok: true });
}

async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");

  try {
    if (request.method === "GET" && url.pathname === "/") {
      const page = await readFile(indexPath);
      response.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      response.end(page);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      await handleChat(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/reset") {
      await handleReset(request, response);
      return;
    }

    sendJson(response, 404, { error: "Not found." });
  } catch (error) {
    if (error instanceof HttpError) {
      sendJson(response, error.statusCode, { error: error.message });
      return;
    }

    logger.error({ error, method: request.method, path: url.pathname }, "Web request failed");
    sendJson(response, 500, {
      error: "Iny could not process the request. Check the server logs and try again.",
    });
  }
}

async function main(): Promise<void> {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("WEB_PORT must be an integer between 1 and 65535.");
  }

  await initDb();

  const server = createServer((request, response) => {
    void handleRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => reject(error);
    server.once("error", onError);
    server.listen(port, () => {
      server.off("error", onError);
      resolve();
    });
  });
  logger.info({ port }, `Iny web interface is ready at http://localhost:${port}`);

  let isShuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info({ signal }, "Stopping Iny web interface");
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    await pool.end();
  }

  function requestShutdown(signal: string): void {
    void shutdown(signal).catch((error) => {
      logger.error({ error, signal }, "Failed to stop Iny web interface cleanly");
      process.exitCode = 1;
    });
  }

  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));
}

void main().catch(async (error) => {
  logger.fatal({ error }, "Failed to start Iny web interface");
  await pool.end().catch(() => undefined);
  process.exitCode = 1;
});
