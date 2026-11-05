import OpenAI from "openai";
import { DeepseekFoodAssessmentAdapter } from "../../../../src/adapters/outbound/mess/extraction/DeepseekFoodAssessmentAdapter";
import { PdfRasterizer } from "../../../../src/adapters/outbound/mess/extraction/PdfRasterizer";
import { MealSwapResolver } from "../../../../src/core/services/MealSwapResolver";
import type { FoodIngestionRepositoryPort } from "../../../../src/core/ports/FoodIngestionRepositoryPort";
import type { MessStagingRepositoryPort } from "../../../../src/core/ports/MessStagingRepositoryPort";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FoodIngestionWorker } from "../../../../src/adapters/inbound/workers/FoodIngestionWorker";
import { ProcessNextFoodAnnouncement } from "../../../../src/core/use-cases/ProcessNextFoodAnnouncement";
import type { LoggerPort } from "../../../../src/core/ports/LoggerPort";

function setup(execute = vi.fn().mockResolvedValue(null)) {
	vi.useFakeTimers();
	const logger = { error: vi.fn() } as unknown as LoggerPort;
	const worker = new FoodIngestionWorker(
		{ execute } as unknown as ProcessNextFoodAnnouncement,
		logger,
	);
	return { worker, execute, logger };
}

afterEach(() => vi.useRealTimers());

describe("FoodIngestionWorker", () => {
	it("polls idle work once each second and ignores duplicate starts", async () => {
		const { worker, execute } = setup();
		worker.start();
		worker.start();
		await vi.advanceTimersByTimeAsync(999);
		expect(execute).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(execute.mock.calls[0][0]).toBeInstanceOf(AbortSignal);
		await vi.advanceTimersByTimeAsync(2_000);
		expect(execute).toHaveBeenCalledTimes(3);
		await worker.stop();
		expect(vi.getTimerCount()).toBe(0);
	});

	it("isolates an execution failure and polls the next item", async () => {
		const error = new Error("claim unavailable");
		const execute = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(null);
		const c = setup(execute);
		c.worker.start();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(c.logger.error).toHaveBeenCalledWith("Food ingestion worker execution failed", error);
		expect(execute).toHaveBeenCalledTimes(2);
		await c.worker.stop();
	});

	it("waits for the active operation without overlapping and prevents claims after stop", async () => {
		let finish!: () => void;
		let active = 0;
		let maxConcurrentExecutions = 0;
		const execute = vi.fn(async () => {
			active++;
			maxConcurrentExecutions = Math.max(maxConcurrentExecutions, active);
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			active--;
			return null;
		});
		const { worker } = setup(execute);
		worker.start();
		await vi.advanceTimersByTimeAsync(20_000);
		expect(execute).toHaveBeenCalledTimes(1);
		let stopped = false;
		const stopping = worker.stop().then(() => {
			stopped = true;
		});
		await Promise.resolve();
		expect(stopped).toBe(false);
		finish();
		await stopping;
		const callsAtStop = execute.mock.calls.length;
		worker.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(execute).toHaveBeenCalledTimes(callsAtStop);
		expect(maxConcurrentExecutions).toBe(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts after the deadline and waits for cancellation cleanup before the next claim", async () => {
		let signal!: AbortSignal;
		let cleanup!: () => void;
		const execute = vi.fn(async (received: AbortSignal) => {
			signal = received;
			await new Promise<void>((resolve) => {
				cleanup = resolve;
			});
			return null;
		});
		const { worker } = setup(execute);
		worker.start();
		await vi.advanceTimersByTimeAsync(1_000);
		await vi.advanceTimersByTimeAsync(419_999);
		expect(signal.aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		expect(signal.aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(5_000);
		expect(execute).toHaveBeenCalledTimes(1);
		const stopping = worker.stop();
		cleanup();
		await stopping;
		expect(vi.getTimerCount()).toBe(0);
	});

	it("keeps the operation deadline while shutdown awaits cooperative cancellation", async () => {
		let aborted = false;
		const execute = vi.fn(async (signal: AbortSignal) => {
			await new Promise<void>((resolve) =>
				signal.addEventListener(
					"abort",
					() => {
						aborted = true;
						resolve();
					},
					{ once: true },
				),
			);
			return null;
		});
		const { worker } = setup(execute);
		worker.start();
		await vi.advanceTimersByTimeAsync(1_000);
		const stopping = worker.stop();
		await vi.advanceTimersByTimeAsync(420_000);
		await stopping;
		expect(aborted).toBe(true);
		expect(execute).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it("aborts execution using a custom deadline", async () => {
		vi.useFakeTimers();
		let aborted = false;
		let cleanup!: () => void;
		const execute = vi.fn(async (signal: AbortSignal) => {
			signal.addEventListener("abort", () => {
				aborted = true;
			});
			await new Promise<void>((resolve) => {
				cleanup = resolve;
			});
			return null;
		});
		const logger = { error: vi.fn() } as unknown as LoggerPort;
		const worker = new FoodIngestionWorker(
			{ execute } as unknown as ProcessNextFoodAnnouncement,
			logger,
			50_000,
		);
		worker.start();
		await vi.advanceTimersByTimeAsync(1_000);
		expect(aborted).toBe(false);
		await vi.advanceTimersByTimeAsync(50_000);
		expect(aborted).toBe(true);
		const stopping = worker.stop();
		cleanup();
		await stopping;
	});

	it("stops an idle worker before its first claim and cannot restart it", async () => {
		const { worker, execute } = setup();
		worker.start();
		await worker.stop();
		worker.start();
		await vi.advanceTimersByTimeAsync(5_000);
		expect(execute).not.toHaveBeenCalled();
		expect(vi.getTimerCount()).toBe(0);
	});
});

it("propagates the worker deadline through processing and strict assessment to Poppler before shutdown returns", async () => {
	vi.useFakeTimers();
	let entered!: () => void;
	const inspecting = new Promise<void>((resolve) => {
		entered = resolve;
	});
	let commandSignal!: AbortSignal;
	const runner = vi.fn(async (_file, _args, options) => {
		commandSignal = options.signal;
		entered();
		await new Promise<void>((_resolve, reject) =>
			commandSignal.addEventListener("abort", () => reject(commandSignal.reason), { once: true }),
		);
		return { stdout: "", stderr: "" };
	});
	const fail = vi
		.fn()
		.mockResolvedValue({ outcome: "failed", reason: "cancelled", detail: "Assessment cancelled." });
	const claimNext = vi.fn().mockResolvedValue({
		lease: {
			messageId: "pdf",
			token: "lease",
			expiresAt: new Date(Date.now() + 300_000),
			attempt: 1,
		},
		source: {
			messageId: "pdf",
			groupJid: "food@g.us",
			senderAddress: "123@lid",
			senderAddressType: "lid",
			deliveryMode: "notify",
			originalCreatedAt: new Date(),
			capturedAt: new Date(),
			messageType: "document",
			textBody: null,
			mediaMimeType: "application/pdf",
			mediaBytes: new TextEncoder().encode("%PDF-1.4 offline fixture"),
		},
	});
	const create = vi.fn();
	const sdk = { chat: { completions: { create } } } as unknown as OpenAI;
	const assessment = new DeepseekFoodAssessmentAdapter(
		sdk,
		new PdfRasterizer(runner),
		"test-model",
	);
	const repository = { claimNext, fail } as unknown as FoodIngestionRepositoryPort;
	const logger = { error: vi.fn() } as unknown as LoggerPort;
	const process = new ProcessNextFoodAnnouncement(
		repository,
		assessment,
		new MealSwapResolver({} as MessStagingRepositoryPort),
		logger,
	);
	const worker = new FoodIngestionWorker(process, logger);
	worker.start();
	await vi.advanceTimersByTimeAsync(1_000);
	await inspecting;
	const stopping = worker.stop();
	expect(commandSignal.aborted).toBe(false);
	await vi.advanceTimersByTimeAsync(420_000);
	await stopping;
	expect(commandSignal.aborted).toBe(true);
	expect(runner).toHaveBeenCalledExactlyOnceWith(
		"pdfinfo",
		expect.any(Array),
		expect.objectContaining({ signal: commandSignal, timeout: 30_000 }),
	);
	expect(fail).toHaveBeenCalledWith(
		expect.objectContaining({ messageId: "pdf" }),
		expect.objectContaining({ code: "cancelled", retriable: false }),
	);
	expect(create).not.toHaveBeenCalled();
	expect(claimNext).toHaveBeenCalledTimes(1);
	expect(vi.getTimerCount()).toBe(0);
});
