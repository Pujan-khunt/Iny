import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleIngest, requireBearerAuth, HttpError } from "./ingestHandler.js";
import type { IngestHandlerDeps } from "./ingestHandler.js";
import { ingestFile } from "../rag/ingest.js";

vi.mock("../rag/ingest.js", () => ({
  ingestFile: vi.fn(),
}));

vi.mock("../config.js", () => ({
  INGEST_API_KEY: "test-secret-key",
  INGEST_MAX_BODY_BYTES: 2 * 1024 * 1024,
}));

vi.mock("../db/index.js", () => ({ db: {}, pool: { end: vi.fn() } }));
vi.mock("../db/schema.js", () => ({ documents: {}, chunks: {} }));

function makeDeps(overrides?: Partial<IngestHandlerDeps>): IngestHandlerDeps {
  return {
    readJsonBody: vi.fn(),
    sendJson: vi.fn(),
    requireString: vi.fn((val: unknown, _name: string, _max: number) => {
      if (typeof val !== "string" || !val.trim()) throw new HttpError(400, `${_name} must be a non-empty string.`);
      return val.trim();
    }),
    logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() } as any,
    ...overrides,
  };
}

function mockRequest(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

function mockResponse(): ServerResponse {
  return {} as unknown as ServerResponse;
}

describe("requireBearerAuth", () => {
  it("throws 401 when Authorization header is missing", () => {
    expect(() => requireBearerAuth(undefined)).toThrow(HttpError);
    try {
      requireBearerAuth(undefined);
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(401);
    }
  });

  it("throws 401 when Authorization header is not Bearer", () => {
    expect(() => requireBearerAuth("Basic abc123")).toThrow(HttpError);
    try {
      requireBearerAuth("Basic abc123");
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(401);
    }
  });

  it("throws 401 when token does not match", () => {
    expect(() => requireBearerAuth("Bearer wrong-key")).toThrow(HttpError);
    try {
      requireBearerAuth("Bearer wrong-key");
    } catch (e) {
      expect((e as HttpError).statusCode).toBe(401);
    }
  });

  it("does not throw when token matches", () => {
    expect(() => requireBearerAuth("Bearer test-secret-key")).not.toThrow();
  });
});

describe("handleIngest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without Authorization header", async () => {
    const deps = makeDeps();
    const req = mockRequest();
    const res = mockResponse();

    await expect(handleIngest(req, res, deps)).rejects.toThrow(HttpError);
    await expect(handleIngest(req, res, deps)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects requests with wrong bearer token", async () => {
    const deps = makeDeps();
    const req = mockRequest({ authorization: "Bearer wrong-token" });
    const res = mockResponse();

    await expect(handleIngest(req, res, deps)).rejects.toMatchObject({ statusCode: 401 });
  });

  it("rejects missing fileName", async () => {
    const deps = makeDeps({
      readJsonBody: vi.fn().mockResolvedValue({ content: "# Hello" }),
    });
    const req = mockRequest({ authorization: "Bearer test-secret-key" });
    const res = mockResponse();

    await expect(handleIngest(req, res, deps)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects non-.md fileName", async () => {
    const deps = makeDeps({
      readJsonBody: vi.fn().mockResolvedValue({ fileName: "test.pdf", content: "# Hello" }),
    });
    const req = mockRequest({ authorization: "Bearer test-secret-key" });
    const res = mockResponse();

    await expect(handleIngest(req, res, deps)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects missing content", async () => {
    const deps = makeDeps({
      readJsonBody: vi.fn().mockResolvedValue({ fileName: "test.md" }),
    });
    const req = mockRequest({ authorization: "Bearer test-secret-key" });
    const res = mockResponse();

    await expect(handleIngest(req, res, deps)).rejects.toMatchObject({ statusCode: 400 });
  });

  it("calls ingestFile and returns 201 for new document", async () => {
    const mockResult = { docId: "uuid-1", chunksCreated: 5, tokens: 1200, costUsd: 0.000024 };
    vi.mocked(ingestFile).mockResolvedValue(mockResult);

    const deps = makeDeps({
      readJsonBody: vi.fn().mockResolvedValue({ fileName: "policy.md", content: "# Policy\n\nSome text" }),
    });
    const req = mockRequest({ authorization: "Bearer test-secret-key" });
    const res = mockResponse();

    await handleIngest(req, res, deps);

    expect(ingestFile).toHaveBeenCalledWith(
      "policy.md",
      expect.any(Buffer),
      { maxTokens: 500, overlapTokens: 50, sourceType: "document" },
    );
    expect(deps.sendJson).toHaveBeenCalledWith(res, 201, mockResult);
    expect(deps.logger.info).toHaveBeenCalled();
  });

  it("returns 200 with skip message for already-ingested document", async () => {
    const mockResult = { docId: "existing-id", chunksCreated: 0, tokens: 0, costUsd: 0 };
    vi.mocked(ingestFile).mockResolvedValue(mockResult);

    const deps = makeDeps({
      readJsonBody: vi.fn().mockResolvedValue({ fileName: "policy.md", content: "# Policy\n\nSame content" }),
    });
    const req = mockRequest({ authorization: "Bearer test-secret-key" });
    const res = mockResponse();

    await handleIngest(req, res, deps);

    expect(deps.sendJson).toHaveBeenCalledWith(res, 200, {
      ...mockResult,
      message: "Document content unchanged, skipped.",
    });
  });
});
