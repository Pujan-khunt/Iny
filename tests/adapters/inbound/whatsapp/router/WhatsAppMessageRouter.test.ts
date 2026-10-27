import { describe, it, expect, vi } from "vitest";
import { WhatsAppMessageRouter } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageRouter";
import { WhatsAppMessageNormalizer } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageNormalizer";
import { WhatsAppMessageContentExtractor } from "../../../../../src/adapters/inbound/whatsapp/router/WhatsAppMessageContentExtractor";
import {
	NormalizedWhatsAppMessage,
	WhatsAppMessageHandler,
} from "../../../../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";
import { CatchAllLoggingHandler } from "../../../../../src/adapters/inbound/whatsapp/router/CatchAllLoggingHandler";
import { WAMessage } from "@whiskeysockets/baileys";

describe("WhatsAppMessageRouter", () => {
	const createMockLogger = () => ({
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		fatal: vi.fn(),
		child: vi.fn().mockReturnThis(),
	});

	const createNormalizer = (logger: any) =>
		new WhatsAppMessageNormalizer(logger, new WhatsAppMessageContentExtractor(logger));

	it("dispatches message to first matching handler and terminates evaluation", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const handler1: WhatsAppMessageHandler = {
			name: "h1",
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockResolvedValue(undefined),
		};
		const handler2: WhatsAppMessageHandler = {
			name: "h2",
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockResolvedValue(undefined),
		};

		const registrationResult = router.register(handler1).register(handler2);
		expect(registrationResult).toBe(router);

		const raw = {
			key: { id: "m1", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "test" },
		};

		await router.handleUpsert({ type: "notify", messages: [raw as any] });

		expect(handler1.matches).toHaveBeenCalledTimes(1);
		expect(handler1.handle).toHaveBeenCalledTimes(1);
		expect(handler2.matches).not.toHaveBeenCalled();
		expect(handler2.handle).not.toHaveBeenCalled();
	});

	it("skips handlers when upsert type does not match acceptedUpsertTypes", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const notifyOnlyHandler: WhatsAppMessageHandler = {
			name: "notify-only",
			acceptedUpsertTypes: ["notify"],
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockResolvedValue(undefined),
		};

		router.register(notifyOnlyHandler);

		const raw = {
			key: { id: "m2", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "append test" },
		};

		await router.handleUpsert({ type: "append", messages: [raw as any] });

		expect(notifyOnlyHandler.matches).not.toHaveBeenCalled();
		expect(notifyOnlyHandler.handle).not.toHaveBeenCalled();
	});

	it("evaluates handlers declaring multiple accepted upsert types", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const multiTypeHandler: WhatsAppMessageHandler = {
			name: "multi-type",
			acceptedUpsertTypes: ["notify", "append"],
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockResolvedValue(undefined),
		};

		router.register(multiTypeHandler);

		const raw = {
			key: { id: "m3", remoteJid: "120363045678901234@g.us", fromMe: false },
			message: { conversation: "food announcement" },
		};

		await router.handleUpsert({ type: "append", messages: [raw as any] });
		expect(multiTypeHandler.handle).toHaveBeenCalledTimes(1);

		await router.handleUpsert({ type: "notify", messages: [raw as any] });
		expect(multiTypeHandler.handle).toHaveBeenCalledTimes(2);
	});

	it("falls back to CatchAllLoggingHandler when no specific handler matches", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const strictHandler: WhatsAppMessageHandler = {
			name: "strict-handler",
			matches: vi.fn().mockReturnValue(false),
			handle: vi.fn(),
		};
		const catchAllHandler = new CatchAllLoggingHandler(mockLogger);

		router.register(strictHandler);
		router.register(catchAllHandler);

		const raw = {
			key: { id: "m4", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "unhandled" },
		};

		await router.handleUpsert({ type: "notify", messages: [raw as any] });

		expect(strictHandler.matches).toHaveBeenCalledTimes(1);
		expect(strictHandler.handle).not.toHaveBeenCalled();
		expect(mockLogger.debug).toHaveBeenCalledWith(
			"Unhandled incoming message ignored by catch-all fallback",
			expect.objectContaining({
				messageId: "m4",
				chatType: "direct",
				contentType: "text",
			}),
		);
	});

	it("skips messages when normalizer returns null", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const handler: WhatsAppMessageHandler = {
			name: "any-handler",
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn(),
		};
		router.register(handler);

		const malformedRaw = {} as WAMessage;

		await router.handleUpsert({ type: "notify", messages: [malformedRaw] });

		expect(handler.matches).not.toHaveBeenCalled();
		expect(handler.handle).not.toHaveBeenCalled();
	});

	it("isolates handler failure and continues processing remaining messages in batch", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const failingError = new Error("Handler exploded");
		const handler: WhatsAppMessageHandler = {
			name: "flaky-handler",
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockImplementation(async (msg: NormalizedWhatsAppMessage) => {
				if (msg.messageId === "msg-fail") {
					throw failingError;
				}
			}),
		};

		router.register(handler);

		const msg1 = {
			key: { id: "msg-fail", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "will fail" },
		};
		const msg2 = {
			key: { id: "msg-success", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "will succeed" },
		};

		await router.handleUpsert({ type: "notify", messages: [msg1 as any, msg2 as any] });

		expect(handler.handle).toHaveBeenCalledTimes(2);
		expect(mockLogger.error).toHaveBeenCalledWith(
			"Handler failed during message processing",
			failingError,
			expect.objectContaining({
				handler: "flaky-handler",
				messageId: "msg-fail",
			}),
		);
	});

	it("isolates handler match predicate failure and proceeds to next handler", async () => {
		const mockLogger = createMockLogger();
		const normalizer = createNormalizer(mockLogger);
		const router = new WhatsAppMessageRouter(normalizer, mockLogger);

		const matchError = new Error("Predicate explosion");
		const buggyHandler: WhatsAppMessageHandler = {
			name: "buggy-handler",
			matches: vi.fn().mockImplementation(() => {
				throw matchError;
			}),
			handle: vi.fn(),
		};
		const fallbackHandler: WhatsAppMessageHandler = {
			name: "fallback-handler",
			matches: vi.fn().mockReturnValue(true),
			handle: vi.fn().mockResolvedValue(undefined),
		};

		router.register(buggyHandler);
		router.register(fallbackHandler);

		const raw = {
			key: { id: "msg-predicate-fail", remoteJid: "919876543210@s.whatsapp.net", fromMe: false },
			message: { conversation: "test" },
		};

		await router.handleUpsert({ type: "notify", messages: [raw as any] });

		expect(buggyHandler.matches).toHaveBeenCalledTimes(1);
		expect(buggyHandler.handle).not.toHaveBeenCalled();
		expect(mockLogger.warn).toHaveBeenCalledWith(
			"Handler match predicate threw unexpected error",
			matchError,
			expect.objectContaining({
				handler: "buggy-handler",
				messageId: "msg-predicate-fail",
			}),
		);
		expect(fallbackHandler.matches).toHaveBeenCalledTimes(1);
		expect(fallbackHandler.handle).toHaveBeenCalledTimes(1);
	});

	it("CatchAllLoggingHandler catches both notify and append upsert modes", () => {
		const mockLogger = createMockLogger();
		const catchAll = new CatchAllLoggingHandler(mockLogger);

		expect(catchAll.name).toBe("catch-all-logging");
		expect(catchAll.acceptedUpsertTypes).toEqual(["notify", "append"]);
		expect(catchAll.matches({} as any)).toBe(true);
	});
});
