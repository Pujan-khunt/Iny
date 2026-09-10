import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleNaturalMessage } from "./natural.js";
import { askIny } from "../core/index.js";
import { parseCommand } from "../commands/parser.js";
import { isAdmin } from "../services/admin.js";

vi.mock("../core/index.js", () => ({
  askIny: vi.fn(),
  getSessionSources: vi.fn(),
}));
vi.mock("../services/sendMessage.js");
vi.mock("../services/rateLimit.js", () => ({
  createRateLimiter: vi.fn(() => ({ check: vi.fn().mockReturnValue(true) })),
}));
vi.mock("../commands/parser.js");
vi.mock("../rag/formatSources.js", () => ({
  isAskingForSources: vi.fn(),
  formatSourcesForWhatsApp: vi.fn(),
}));
vi.mock("../services/jid.js", () => ({
  normalizeJid: vi.fn((j) => j),
}));
vi.mock("../services/admin.js");
vi.mock("../utils/markdown.js", () => ({
  convertMarkdownToWhatsApp: vi.fn((t) => t),
}));
vi.mock("../services/chatUx.js", () => ({
  markAsRead: vi.fn(),
  withProgressUx: vi.fn(async (s, st, j, k, a, l, cb) => { await cb(); }),
}));

const mockJidInfo = {
  remoteJid: '919876543210@s.whatsapp.net',
  normalizedRemoteJid: '919876543210@s.whatsapp.net',
  canonicalJid: '919876543210@s.whatsapp.net',
  allJids: ['919876543210@s.whatsapp.net'],
  isGroup: false,
};

describe("handleNaturalMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ignores group messages without mention/reply", async () => {
    await handleNaturalMessage({} as any, {} as any, { sentMessageIDs: new Map() } as any, {} as any, "bot", {} as any, { ...mockJidInfo, isGroup: true }, "text");
    expect(askIny).not.toHaveBeenCalled();
  });

  it("ignores empty text", async () => {
    await handleNaturalMessage({} as any, {} as any, {} as any, {} as any, "bot", {} as any, mockJidInfo, "   ");
    expect(askIny).not.toHaveBeenCalled();
  });

  it("dispatches commands when parseCommand returns a match", async () => {
    vi.mocked(parseCommand).mockReturnValue({ name: "help", args: [], text: "" });
    const executeMock = vi.fn();
    const commandRegistry = { get: vi.fn().mockReturnValue({ execute: executeMock }) } as any;
    await handleNaturalMessage({} as any, {} as any, {} as any, { key: {} } as any, "bot", commandRegistry, mockJidInfo, "help");
    expect(executeMock).toHaveBeenCalled();
  });

  it("blocks admin-only commands for non-admins", async () => {
    vi.mocked(parseCommand).mockReturnValue({ name: "admin", args: [], text: "" });
    vi.mocked(isAdmin).mockReturnValue(false);
    const commandRegistry = { get: vi.fn().mockReturnValue({ execute: vi.fn(), adminOnly: true }) } as any;
    await handleNaturalMessage({} as any, {} as any, {} as any, { key: {} } as any, "bot", commandRegistry, mockJidInfo, "admin");
    expect(isAdmin).toHaveBeenCalled();
  });

  it("calls askIny for regular messages", async () => {
    vi.mocked(parseCommand).mockReturnValue(null);
    vi.mocked(askIny).mockResolvedValue({ message: "Answer", iterations: 1, citations: [], style: "concise" });
    await handleNaturalMessage({} as any, {} as any, {} as any, { key: {} } as any, "bot", {} as any, mockJidInfo, "text");
    expect(askIny).toHaveBeenCalled();
  });
});
