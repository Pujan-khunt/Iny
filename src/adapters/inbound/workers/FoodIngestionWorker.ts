import type { ProcessNextFoodAnnouncement } from "../../../core/use-cases/ProcessNextFoodAnnouncement";
import type { LoggerPort } from "../../../core/ports/LoggerPort";

/** Drives admitted food work serially with an invocation deadline. */
export class FoodIngestionWorker {
	private started = false;
	private stopped = false;
	private timer?: ReturnType<typeof setTimeout>;
	private active?: Promise<void>;

	/** Receives the processing use case, error logger, and optional execution deadline. */
	constructor(
		private readonly process: ProcessNextFoodAnnouncement,
		private readonly logger: LoggerPort,
		private readonly deadlineMs = 420_000,
	) {}

	/** Starts polling once; duplicate or post-stop calls have no effect. */
	start(): void {
		if (this.started || this.stopped) return;
		this.started = true;
		this.logger.info("Food ingestion worker started");
		this.schedule();
	}

	/** Prevents new claims and waits for the bounded active operation. */
	async stop(): Promise<void> {
		this.stopped = true;
		clearTimeout(this.timer);
		this.logger.info("Food ingestion worker stopping");
		await this.active;
		this.logger.info("Food ingestion worker stopped");
	}

	private schedule(): void {
		if (this.stopped) return;
		this.timer = setTimeout(() => {
			this.active = this.run();
		}, 1_000);
	}

	private async run(): Promise<void> {
		if (this.stopped) return;
		const controller = new AbortController();
		const deadline = setTimeout(() => controller.abort(), this.deadlineMs);
		try {
			const outcome = await this.process.execute(controller.signal);
			if (outcome) {
				this.logger.info("Food ingestion worker processed item", { outcome: outcome.outcome });
			}
		} catch (error) {
			this.logger.error("Food ingestion worker execution failed", error);
		} finally {
			clearTimeout(deadline);
			this.schedule();
		}
	}
}
