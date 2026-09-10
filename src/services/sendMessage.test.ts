import { describe, it, expect, vi, beforeEach } from "vitest";
import { safeSendMessage, replyTo } from "./sendMessage.js";
import { createStores } from "../store.js";
import type { WASocket } from "@whiskeysockets/baileys";
import { isAllowlisted } from "../repositories/allowlist.js";
import { resolveUserJid } from "./jid.js";

vi.mock("../repositories/allowlist.js", () => ({
  isAllowlisted: vi.fn(),
}));

vi.mock("./jid.js", () => ({
  resolveUserJid: vi.fn(),
}));

describe("sendMessage", () => {
  let socket: any;
  let stores: ReturnType<typeof createStores>;
  let log: any;

  beforeEach(() => {
    socket = {
      sendMessage: vi.fn().mockResolvedValue({ key: { id: "sent-msg-1" } }),
    };
    stores = createStores();
    log = {
      warn: vi.fn(),
    };
    vi.clearAllMocks();
  });

  describe("safeSendMessage", () => {
    it("sends when allowlisted", async () => {
      vi.mocked(isAllowlisted).mockReturnValue(true);
      
      const res = await safeSendMessage(socket as unknown as WASocket, "user@s.whatsapp.net", { text: "hello" });
      
      expect(isAllowlisted).toHaveBeenCalledWith(["user@s.whatsapp.net"]);
      expect(socket.sendMessage).toHaveBeenCalledWith("user@s.whatsapp.net", { text: "hello" }, undefined);
      expect(res).toEqual({ key: { id: "sent-msg-1" } });
    });

    it("refuses when not allowlisted initially and resolution also fails", async () => {
      vi.mocked(isAllowlisted).mockReturnValue(false);
      vi.mocked(resolveUserJid).mockResolvedValue({ allJids: ["user@s.whatsapp.net"] } as any);
      
      const res = await safeSendMessage(socket as unknown as WASocket, "user@s.whatsapp.net", { text: "hello" });
      
      expect(socket.sendMessage).not.toHaveBeenCalled();
      expect(res).toBeUndefined();
    });

    it("sends if resolved jids are allowlisted", async () => {
      vi.mocked(isAllowlisted)
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);
      
      vi.mocked(resolveUserJid).mockResolvedValue({ allJids: ["resolved@s.whatsapp.net"] } as any);
      
      const res = await safeSendMessage(socket as unknown as WASocket, "user@s.whatsapp.net", { text: "hello" });
      
      expect(socket.sendMessage).toHaveBeenCalledWith("user@s.whatsapp.net", { text: "hello" }, undefined);
      expect(res).toEqual({ key: { id: "sent-msg-1" } });
    });
  });

  describe("replyTo", () => {
    it("tracks sent message ID in stores", async () => {
      vi.mocked(isAllowlisted).mockReturnValue(true);
      
      await replyTo(socket as unknown as WASocket, log, stores, "user@s.whatsapp.net", { text: "reply" });
      
      expect(stores.sentMessageIDs.has("sent-msg-1")).toBe(true);
    });
    
    it("logs warning if sent msg lacks ID", async () => {
      vi.mocked(isAllowlisted).mockReturnValue(true);
      socket.sendMessage.mockResolvedValueOnce(undefined);
      
      await replyTo(socket as unknown as WASocket, log, stores, "user@s.whatsapp.net", { text: "reply" });
      
      expect(log.warn).toHaveBeenCalled();
    });
  });
});
