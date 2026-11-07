import dns from "node:dns";
import net from "node:net";
import type { AccessControlAdminPort, SeedUserEntry } from "../core/ports/AccessControlPort";
import type { LoggerPort } from "../core/ports/LoggerPort";

export function configureNetworkDefaults(): void {
	dns.setDefaultResultOrder?.("ipv4first");
	net.setDefaultAutoSelectFamily?.(false);
}

configureNetworkDefaults();

export type ApplicationLifecycleOperations = {
	migrate: () => Promise<void>;
	initializeFood: () => Promise<unknown>;
	subscribe: () => void;
	connect: (signal: AbortSignal) => Promise<void>;
	startWorker: () => void;
	stopWorker: () => Promise<void>;
};

/** Runs injected startup and shutdown operations without composing adapters. */
export class ApplicationLifecycle {
	private isShuttingDown = false;
	private started = false;
	private readonly startup = new AbortController();
	/** Receives logging, closure/exit callbacks, access seeding, and ordered startup/worker operations. */
	constructor(
		private readonly logger: LoggerPort,
		private readonly disconnect: () => void,
		private readonly closeDatabase: (timeout: number) => Promise<void>,
		private readonly exit: (code: number) => void,
		private readonly accessControl: AccessControlAdminPort,
		private readonly seeds: SeedUserEntry[],
		private readonly operations: ApplicationLifecycleOperations,
	) {}
	/** Runs migrations, access and activation initialization before live admission and recovery. Propagates startup failures. */
	async start(): Promise<void> {
		if (this.started || this.isShuttingDown) return;
		this.started = true;
		await this.operations.migrate();
		if (this.isShuttingDown || !(await this.initializeAccessControl())) return;
		if (this.isShuttingDown) return;
		await this.operations.initializeFood();
		if (this.isShuttingDown) return;
		this.operations.startWorker();
		this.operations.subscribe();
		this.logger.info("Subscribed WhatsApp message router to messages.upsert");
		this.logger.info("Starting Iny WhatsApp connection...");
		await this.operations.connect(this.startup.signal);
	}
	/**
	 * Seeds configured users and verifies the persisted active-user count.
	 * @returns True to continue startup, or false after closing and exiting with no active users.
	 * @throws Propagates seeding, counting, or closure failures to the startup failure handler.
	 */
	async initializeAccessControl(): Promise<boolean> {
		if (this.seeds.length > 0) await this.accessControl.seedUsers(this.seeds);
		const count = await this.accessControl.countActiveUsers();
		if (count === 0) {
			this.logger.fatal("No active authorized users found. Iny cannot start.");
			await this.closeDatabase(5);
			this.exit(1);
			return false;
		}
		this.logger.info("Access control initialized", { activeUsers: count });
		return true;
	}

	/** Closes once, logs closure errors, then exits; concurrent requests do no work. */
	async shutdown(signal: string, exitCode = 0): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		this.startup.abort();
		this.logger.info(`Received ${signal}. Closing connections gracefully...`);
		try {
			this.disconnect();
		} catch (error) {
			this.logger.error("Error closing WhatsApp connection", error);
		}
		await this.operations.stopWorker();
		await this.closeDatabase(5).catch((error: unknown) =>
			this.logger.error("Error closing database pool", error),
		);
		await this.logger.flush?.();
		this.exit(exitCode);
	}
	/** Reports fatal errors and performs idempotent shutdown with exit code one. */
	async fatal(name: string, error: unknown): Promise<void> {
		this.logger.fatal(name, error instanceof Error ? error : new Error(String(error)));
		await this.shutdown(name, 1);
	}
	/** Retains startup's shorter database timeout and exits even when closing rejects. */
	async startupFailure(error: unknown): Promise<void> {
		if (this.isShuttingDown) return;
		this.isShuttingDown = true;
		this.startup.abort();
		this.logger.fatal("Fatal application startup failure", error);
		await this.operations.stopWorker();
		await this.closeDatabase(2)
			.catch(() => {})
			.finally(async () => {
				await this.logger.flush?.();
				this.exit(1);
			});
	}

	/** Attaches process-level signal and unhandled rejection listeners. */
	attachSignalHandlers(): void {
		["SIGINT", "SIGTERM"].forEach((signal) => process.on(signal, () => this.shutdown(signal)));
		process.on("uncaughtException", (error) => this.fatal("Uncaught exception", error));
		process.on("unhandledRejection", (error) => this.fatal("Unhandled promise rejection", error));
	}
}
