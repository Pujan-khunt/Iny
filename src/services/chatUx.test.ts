import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { markAsRead, setReaction, startTypingHeartbeat, withProgressUx } from "./chatUx.js";
import { createStores } from "../store.js";
import { safeSendMessage } from "./sendMessage.js";
import type { WASocket } from "@whiskeysockets/baileys";
import { PROCESSING_REACTION_EMOJI, TYPING_HEARTBEAT_INTERVAL_MS } from "../config.js";

vi.mock("./sendMessage.js", () => ({
  safeSendMessage: vi.fn(),
}));

describe("chatUx", () => {
  let socket: any;
  let stores: ReturnType<typeof createStores>;
  let log: any;

  beforeEach(() => {
    socket = {
      readMessages: vi.fn().mockResolvedValue(undefined),
      sendPresenceUpdate: vi.fn().mockResolvedValue(undefined),
    };
    stores = createStores();
    log = {
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    };
    vi.clearAllMocks();
  });

  describe("markAsRead", () => {
    it("passes message key to socket.readMessages", async () => {
      const key = { id: "123", remoteJid: "user@s.whatsapp.net" };
      await markAsRead(socket as unknown as WASocket, key, log);
      expect(socket.readMessages).toHaveBeenCalledWith([key]);
    });
  });

  describe("setReaction", () => {
    it("sends reaction emoji and tracks sent ID in stores", async () => {
      const key = { id: "msg-1", remoteJid: "user@s.whatsapp.net" };
      vi.mocked(safeSendMessage).mockResolvedValueOnce({ key: { id: "react-msg-1", remoteJid: "user" } } as any);
      
      await setReaction(socket as unknown as WASocket, stores, "user@s.whatsapp.net", key, "👍", null, log);
      
      expect(safeSendMessage).toHaveBeenCalledWith(
        socket,
        "user@s.whatsapp.net",
        { react: { text: "👍", key } },
        undefined,
        null
      );
      expect(stores.sentMessageIDs.has("react-msg-1")).toBe(true);
    });
  });

  describe("startTypingHeartbeat", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sends composing presence immediately, heartbeats, and stop sends paused", () => {
      const stop = startTypingHeartbeat(socket as unknown as WASocket, "user@s.whatsapp.net", log, 1000);
      
      // Immediately sends composing
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("composing", "user@s.whatsapp.net");
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(1);
      
      // Heartbeats
      vi.advanceTimersByTime(1000);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(2);
      expect(socket.sendPresenceUpdate).toHaveBeenNthCalledWith(2, "composing", "user@s.whatsapp.net");
      
      // Stop
      stop();
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("paused", "user@s.whatsapp.net");
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(3);

      // No more heartbeats after stop
      vi.advanceTimersByTime(1000);
      expect(socket.sendPresenceUpdate).toHaveBeenCalledTimes(3);
    });
  });

  describe("withProgressUx", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("sets reaction + typing, runs action, clears reaction on success", async () => {
      const key = { id: "msg-1", remoteJid: "user@s.whatsapp.net" };
      const action = vi.fn().mockResolvedValue("success");
      
      vi.mocked(safeSendMessage).mockResolvedValue({ key: { id: "react-msg", remoteJid: "user" } } as any);

      const promise = withProgressUx(socket as unknown as WASocket, stores, "user@s.whatsapp.net", key, null, log, action);
      
      // Wait for it to finish
      const result = await promise;

      expect(result).toBe("success");
      
      // Should set initial reaction
      expect(safeSendMessage).toHaveBeenNthCalledWith(1, 
        socket, "user@s.whatsapp.net", { react: { text: PROCESSING_REACTION_EMOJI, key } }, undefined, null
      );
      
      // Should set empty reaction to clear
      expect(safeSendMessage).toHaveBeenNthCalledWith(2, 
        socket, "user@s.whatsapp.net", { react: { text: "", key } }, undefined, null
      );

      // Should send typing and paused
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("composing", "user@s.whatsapp.net");
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("paused", "user@s.whatsapp.net");
    });

    it("clears reaction and stops typing on error, rethrows", async () => {
      const key = { id: "msg-1", remoteJid: "user@s.whatsapp.net" };
      const error = new Error("failed");
      const action = vi.fn().mockRejectedValue(error);
      
      vi.mocked(safeSendMessage).mockResolvedValue({ key: { id: "react-msg", remoteJid: "user" } } as any);

      await expect(withProgressUx(socket as unknown as WASocket, stores, "user@s.whatsapp.net", key, null, log, action))
        .rejects.toThrow("failed");
      
      // Should still clear reaction
      expect(safeSendMessage).toHaveBeenNthCalledWith(2, 
        socket, "user@s.whatsapp.net", { react: { text: "", key } }, undefined, null
      );

      // Should still stop typing
      expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("paused", "user@s.whatsapp.net");
    });
  });
});
