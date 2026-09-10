import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerMessageHandlers } from "./messages.js";
import { saveMessage } from "../repositories/messages.js";
import { isAllowlisted } from "../repositories/allowlist.js";
import { getMessageText } from "../utils/messageText.js";
import { handleNaturalMessage } from "./natural.js";
import { resolveMessageJids } from "../services/jid.js";
import EventEmitter from "events";

vi.mock("../repositories/messages.js", () => ({ saveMessage: vi.fn() }));
vi.mock("../repositories/allowlist.js", () => ({ isAllowlisted: vi.fn() }));
vi.mock("../utils/messageText.js", () => ({ getMessageText: vi.fn() }));
vi.mock("./natural.js", () => ({ handleNaturalMessage: vi.fn() }));
vi.mock("../services/jid.js", () => ({ resolveMessageJids: vi.fn() }));
vi.mock("../commands/index.js", () => ({ createCommands: vi.fn().mockReturnValue({}) }));

describe("registerMessageHandlers", () => {
  let socket: any;
  let logger: any;
  let stores: any;
  let ev: EventEmitter;

  beforeEach(() => {
    vi.clearAllMocks();
    ev = new EventEmitter();
    socket = { ev };
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    stores = { sentMessageIDs: new Set() };
  });

  it("persists message and ignores bot reply", async () => {
    registerMessageHandlers(socket, logger, stores, "bot-jid");
    const msg = { key: { id: "msg-1", remoteJid: "user" }, message: {} };
    stores.sentMessageIDs.add("msg-1");

    await Promise.all(ev.listeners("messages.upsert").map(fn => (fn as any)({ messages: [msg], type: "notify" })));

    expect(saveMessage).toHaveBeenCalledWith("user", "msg-1", {});
    expect(resolveMessageJids).not.toHaveBeenCalled();
  });

  it("ignores non-notify types", async () => {
    registerMessageHandlers(socket, logger, stores, "bot-jid");
    const msg = { key: { id: "msg-2", remoteJid: "user" }, message: {} };

    await Promise.all(ev.listeners("messages.upsert").map(fn => (fn as any)({ messages: [msg], type: "append" })));
    expect(resolveMessageJids).not.toHaveBeenCalled();
  });

  it("ignores non-allowlisted users", async () => {
    registerMessageHandlers(socket, logger, stores, "bot-jid");
    const msg = { key: { id: "msg-3", remoteJid: "user" }, message: {} };
    vi.mocked(resolveMessageJids).mockResolvedValue({ allJids: ["user"] } as any);
    vi.mocked(isAllowlisted).mockReturnValue(false);

    await Promise.all(ev.listeners("messages.upsert").map(fn => (fn as any)({ messages: [msg], type: "notify" })));
    
    expect(logger.warn).toHaveBeenCalled();
    expect(getMessageText).not.toHaveBeenCalled();
  });

  it("handles allowlisted user text messages", async () => {
    registerMessageHandlers(socket, logger, stores, "bot-jid");
    const msg = { key: { id: "msg-4", remoteJid: "user" }, message: {} };
    const jidInfo = { allJids: ["user"] };
    
    vi.mocked(resolveMessageJids).mockResolvedValue(jidInfo as any);
    vi.mocked(isAllowlisted).mockReturnValue(true);
    vi.mocked(getMessageText).mockReturnValue("hello");

    await Promise.all(ev.listeners("messages.upsert").map(fn => (fn as any)({ messages: [msg], type: "notify" })));
    
    expect(handleNaturalMessage).toHaveBeenCalledWith(
      socket, logger, stores, msg, "bot-jid", expect.any(Object), jidInfo, "hello"
    );
  });
});
