import { describe, expect, it, vi } from "vitest";
import { ApplicationLifecycle } from "../../src/runtime/ApplicationLifecycle";
import type { LoggerPort } from "../../src/core/ports/LoggerPort";

function setup() {
	const logger = { info: vi.fn(), error: vi.fn(), fatal: vi.fn() } as unknown as LoggerPort;
	const disconnect = vi.fn();
	const close = vi.fn().mockResolvedValue(undefined);
	const exit = vi.fn();
	const accessControl = {
		seedUsers: vi.fn().mockResolvedValue(undefined),
		countActiveUsers: vi.fn().mockResolvedValue(1),
	};
	const operations = {
		migrate: vi.fn().mockResolvedValue(undefined),
		initializeFood: vi.fn().mockResolvedValue(undefined),
		subscribe: vi.fn(),
		connect: vi.fn().mockResolvedValue(undefined),
		startWorker: vi.fn(),
		stopWorker: vi.fn().mockResolvedValue(undefined),
	};
	const seeds = [{ phoneNumber: "919876543210", name: "Operator" }];
	return {
		accessControl,
		operations,
		seeds,
		logger,
		disconnect,
		close,
		exit,
		lifecycle: new ApplicationLifecycle(
			logger,
			disconnect,
			close,
			exit,
			accessControl,
			seeds,
			operations,
		),
	};
}

describe("ApplicationLifecycle", () => {
	it("closes once and exits only after the database closes", async () => {
		const context = setup();
		let resolve!: () => void;
		context.close.mockImplementation(
			() =>
				new Promise<void>((done) => {
					resolve = done;
				}),
		);
		const first = context.lifecycle.shutdown("SIGTERM");
		await context.lifecycle.shutdown("SIGINT");
		expect(context.disconnect).toHaveBeenCalledTimes(1);
		expect(context.close).toHaveBeenCalledWith(5);
		expect(context.exit).not.toHaveBeenCalled();
		resolve();
		await first;
		expect(context.exit).toHaveBeenCalledExactlyOnceWith(0);
	});
	it("logs disconnect errors and still closes the database and exits", async () => {
		const context = setup();
		const error = new Error("disconnect failure");
		context.disconnect.mockImplementation(() => {
			throw error;
		});
		await context.lifecycle.shutdown("SIGTERM", 2);
		expect(context.logger.error).toHaveBeenCalledWith("Error closing WhatsApp connection", error);
		expect(context.close).toHaveBeenCalledWith(5);
		expect(context.exit).toHaveBeenCalledWith(2);
	});
	it("logs database close rejection and retains the requested exit code", async () => {
		const context = setup();
		const error = new Error("database close failure");
		context.close.mockRejectedValue(error);
		await context.lifecycle.shutdown("failure", 1);
		expect(context.logger.error).toHaveBeenCalledWith("Error closing database pool", error);
		expect(context.exit).toHaveBeenCalledWith(1);
	});
	it("turns non-Error fatal values into an Error and shuts down with exit code one", async () => {
		const context = setup();
		await context.lifecycle.fatal("Unhandled rejection", "broken");
		expect(context.logger.fatal).toHaveBeenCalledWith(
			"Unhandled rejection",
			expect.objectContaining({ message: "broken" }),
		);
		expect(context.disconnect).toHaveBeenCalledTimes(1);
		expect(context.exit).toHaveBeenCalledWith(1);
	});
	it("reports startup failure and closes with the original short timeout before exiting", async () => {
		const context = setup();
		const error = new Error("startup failed");
		await context.lifecycle.startupFailure(error);
		expect(context.logger.fatal).toHaveBeenCalledWith("Fatal application startup failure", error);
		expect(context.close).toHaveBeenCalledWith(2);
		expect(context.exit).toHaveBeenCalledWith(1);
		expect(context.disconnect).not.toHaveBeenCalled();
	});
});

describe("ApplicationLifecycle access initialization", () => {
	it("seeds configured users and reports the persisted active count", async () => {
		const c = setup();
		expect(await c.lifecycle.initializeAccessControl()).toBe(true);
		expect(c.accessControl.seedUsers).toHaveBeenCalledWith(c.seeds);
		expect(c.logger.info).toHaveBeenCalledWith("Access control initialized", { activeUsers: 1 });
		expect(c.exit).not.toHaveBeenCalled();
	});
	it("fails startup before subscription when no active users exist", async () => {
		const c = setup();
		c.accessControl.countActiveUsers.mockResolvedValue(0);
		expect(await c.lifecycle.initializeAccessControl()).toBe(false);
		expect(c.logger.fatal).toHaveBeenCalledWith(
			"No active authorized users found. Iny cannot start.",
		);
		expect(c.close).toHaveBeenCalledWith(5);
		expect(c.exit).toHaveBeenCalledWith(1);
	});
	it("propagates seed failure to the existing startup failure handler", async () => {
		const c = setup();
		const error = new Error("seeding failed");
		c.accessControl.seedUsers.mockRejectedValue(error);
		await expect(c.lifecycle.initializeAccessControl()).rejects.toBe(error);
		expect(c.accessControl.countActiveUsers).not.toHaveBeenCalled();
		expect(c.logger.info).not.toHaveBeenCalled();
	});
	it("skips empty seeds but still verifies persisted active users", async () => {
		const c = setup();
		c.seeds.splice(0);
		expect(await c.lifecycle.initializeAccessControl()).toBe(true);
		expect(c.accessControl.seedUsers).not.toHaveBeenCalled();
		expect(c.accessControl.countActiveUsers).toHaveBeenCalledTimes(1);
	});
});

describe("ApplicationLifecycle worker startup and shutdown", () => {
	it("migrates and initializes access and activation before subscribing and starting recovery", async () => {
		const c = setup();
		const order: string[] = [];
		c.operations.migrate.mockImplementation(async () => {
			order.push("migrate");
		});
		c.accessControl.seedUsers.mockImplementation(async () => {
			order.push("seed");
		});
		c.accessControl.countActiveUsers.mockImplementation(async () => {
			order.push("count");
			return 1;
		});
		c.operations.initializeFood.mockImplementation(async () => {
			order.push("activate");
		});
		c.operations.subscribe.mockImplementation(() => {
			order.push("subscribe");
		});
		c.operations.startWorker.mockImplementation(() => {
			order.push("worker");
		});
		c.operations.connect.mockImplementation(async () => {
			order.push("connect");
		});
		await c.lifecycle.start();
		await c.lifecycle.start();
		expect(order).toEqual([
			"migrate",
			"seed",
			"count",
			"activate",
			"worker",
			"subscribe",
			"connect",
		]);
	});

	it("prevents subscription, activation and worker startup when access has no active users", async () => {
		const c = setup();
		c.accessControl.countActiveUsers.mockResolvedValue(0);
		await c.lifecycle.start();
		expect(c.operations.initializeFood).not.toHaveBeenCalled();
		expect(c.operations.subscribe).not.toHaveBeenCalled();
		expect(c.operations.startWorker).not.toHaveBeenCalled();
	});

	it("propagates activation failure without admitting messages or starting recovery", async () => {
		const c = setup();
		const error = new Error("activation unavailable");
		c.operations.initializeFood.mockRejectedValue(error);
		await expect(c.lifecycle.start()).rejects.toBe(error);
		expect(c.operations.subscribe).not.toHaveBeenCalled();
		expect(c.operations.startWorker).not.toHaveBeenCalled();
	});

	it("awaits worker cleanup before database closure on signal shutdown", async () => {
		const c = setup();
		let finish!: () => void;
		c.operations.stopWorker.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					finish = resolve;
				}),
		);
		const closing = c.lifecycle.shutdown("SIGTERM");
		expect(c.operations.stopWorker).toHaveBeenCalledTimes(1);
		expect(c.close).not.toHaveBeenCalled();
		expect(c.exit).not.toHaveBeenCalled();
		finish();
		await closing;
		expect(c.close).toHaveBeenCalledWith(5);
		expect(c.exit).toHaveBeenCalledWith(0);
	});

	it("stops recovery before closing the database after a connection startup failure", async () => {
		const c = setup();
		const error = new Error("connection failed");
		const order: string[] = [];
		c.operations.connect.mockRejectedValue(error);
		c.operations.stopWorker.mockImplementation(async () => {
			order.push("stop");
		});
		c.close.mockImplementation(async () => {
			order.push("close");
		});
		await c.lifecycle.start().catch((failure: unknown) => c.lifecycle.startupFailure(failure));
		expect(order).toEqual(["stop", "close"]);
		expect(c.close).toHaveBeenCalledWith(2);
		expect(c.exit).toHaveBeenCalledWith(1);
	});

	it("does not resume startup when shutdown occurs during activation", async () => {
		const c = setup();
		let activated!: () => void;
		let entered!: () => void;
		const entering = new Promise<void>((resolve) => {
			entered = resolve;
		});
		c.operations.initializeFood.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					activated = resolve;
					entered();
				}),
		);
		const starting = c.lifecycle.start();
		await entering;
		await c.lifecycle.shutdown("SIGTERM");
		activated();
		await starting;
		expect(c.operations.startWorker).not.toHaveBeenCalled();
		expect(c.operations.subscribe).not.toHaveBeenCalled();
		expect(c.operations.connect).not.toHaveBeenCalled();
	});
});
