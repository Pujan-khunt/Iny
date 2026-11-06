import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	suppressLibsignalLogs,
	restoreLibsignalLogs,
} from "../../../../src/adapters/outbound/whatsapp/suppressLibsignalLogs";

describe("suppressLibsignalLogs", () => {
	let infoSpy: ReturnType<typeof vi.fn>;
	let warnSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		restoreLibsignalLogs();
		infoSpy = vi.fn();
		warnSpy = vi.fn();
		console.info = infoSpy as unknown as typeof console.info;
		console.warn = warnSpy as unknown as typeof console.warn;
	});

	afterEach(() => {
		restoreLibsignalLogs();
	});

	it("suppresses Closing session and Opening session logs", () => {
		suppressLibsignalLogs();

		console.info("Closing session:", { session: 1 });
		console.info("Opening session:", { session: 2 });
		console.info("Removing old closed session:", { session: 3 });

		expect(infoSpy).not.toHaveBeenCalled();
	});

	it("passes through standard console.info messages", () => {
		suppressLibsignalLogs();

		console.info("Standard informational message", 123);

		expect(infoSpy).toHaveBeenCalledTimes(1);
		expect(infoSpy).toHaveBeenCalledWith("Standard informational message", 123);
	});

	it("suppresses noisy libsignal session warnings", () => {
		suppressLibsignalLogs();

		console.warn("Session already closed", { id: 1 });
		console.warn("Session already open");
		console.warn("Closing open session in favor of incoming prekey bundle");
		console.warn("Decrypted message with closed session.");

		expect(warnSpy).not.toHaveBeenCalled();
	});

	it("passes through standard console.warn messages", () => {
		suppressLibsignalLogs();

		console.warn("Important system warning", { code: 500 });

		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(warnSpy).toHaveBeenCalledWith("Important system warning", { code: 500 });
	});

	it("safely handles non-string arguments without throwing", () => {
		suppressLibsignalLogs();

		console.info({ some: "object" });
		console.warn(null);
		console.warn(undefined);

		expect(infoSpy).toHaveBeenCalledWith({ some: "object" });
		expect(warnSpy).toHaveBeenCalledWith(null);
		expect(warnSpy).toHaveBeenCalledWith(undefined);
	});

	it("restores original console methods on restoreLibsignalLogs", () => {
		suppressLibsignalLogs();
		restoreLibsignalLogs();

		console.info("Closing session:", "test");
		console.warn("Session already closed");

		expect(infoSpy).toHaveBeenCalledWith("Closing session:", "test");
		expect(warnSpy).toHaveBeenCalledWith("Session already closed");
	});

	it("is idempotent when called multiple times", () => {
		suppressLibsignalLogs();
		suppressLibsignalLogs();

		console.info("Standard info");
		console.info("Closing session:", "test");

		expect(infoSpy).toHaveBeenCalledTimes(1);

		restoreLibsignalLogs();
		expect(console.info).toBe(infoSpy);
	});
});
