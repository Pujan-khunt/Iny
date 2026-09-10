import { describe, it, expect, vi } from "vitest";
import { isValidJidFormat, parsePhoneNumber, parseInputToJid } from "./admin.js";

vi.mock("../repositories/allowlist.js", () => ({
  addToAllowlist: vi.fn(),
  listAllowlist: vi.fn(),
  removeFromAllowlist: vi.fn(),
}));

vi.mock("../db/index.js", () => ({
  db: {}
}));

vi.mock("../config.js", () => ({
  COUNTRY_CODE: "91"
}));

describe("admin commands helpers", () => {
  describe("isValidJidFormat", () => {
    it("valid JID formats", () => {
      expect(isValidJidFormat("918490089630@s.whatsapp.net")).toBe(true);
      expect(isValidJidFormat("120363410305217773@g.us")).toBe(true);
      expect(isValidJidFormat("12345@lid")).toBe(true);
    });

    it("invalid formats", () => {
      expect(isValidJidFormat("abc@s.whatsapp.net")).toBe(false);
      expect(isValidJidFormat("123@other.net")).toBe(false);
      expect(isValidJidFormat("123")).toBe(false);
    });
  });

  describe("parsePhoneNumber", () => {
    it("10-digit with COUNTRY_CODE", () => {
      expect(parsePhoneNumber("9876543210")).toBe("919876543210@s.whatsapp.net");
    });

    it("7+ digit", () => {
      expect(parsePhoneNumber("1234567")).toBe("1234567@s.whatsapp.net");
    });

    it("too short", () => {
      expect(parsePhoneNumber("123456")).toBeNull();
    });

    it("non-digits are stripped", () => {
      expect(parsePhoneNumber("98-765-432-10")).toBe("919876543210@s.whatsapp.net");
    });
  });

  describe("parseInputToJid", () => {
    it("JID with @", () => {
      const res = parseInputToJid("123@s.whatsapp.net");
      expect(res.success).toBe(true);
      expect(res.jid).toBe("123@s.whatsapp.net");
    });

    it("phone number without @", () => {
      const res = parseInputToJid("9876543210");
      expect(res.success).toBe(true);
      expect(res.jid).toBe("919876543210@s.whatsapp.net");
    });

    it("invalid format", () => {
      const res = parseInputToJid("abc");
      expect(res.success).toBe(false);
      expect(res.error).toContain("Invalid phone number");
    });
  });
});
