import type { ApplicationLifecycleOperations } from "./ApplicationLifecycle";

/** Dependencies needed to assemble standard runtime lifecycle operations. */
export interface RuntimeOperationsContext {
	readonly migrate: () => Promise<void>;
	readonly initFood: () => Promise<unknown>;
	readonly subscribe: (handler: (upsert: unknown) => void) => void;
	readonly handleUpsert: (upsert: unknown) => void;
	readonly initSession: () => Promise<unknown>;
	readonly startConnection: (session: unknown) => Promise<void>;
	readonly startWorker: () => void;
	readonly stopWorker: () => Promise<void>;
}

/** Packages runtime infrastructure callbacks into lifecycle startup and shutdown hooks. */
export function createRuntimeOperations(
	ctx: RuntimeOperationsContext,
): ApplicationLifecycleOperations {
	return {
		migrate: ctx.migrate,
		initializeFood: ctx.initFood,
		subscribe: () => ctx.subscribe((u) => ctx.handleUpsert(u)),
		connect: async (signal: AbortSignal) => {
			const session = await ctx.initSession();
			signal.throwIfAborted();
			await ctx.startConnection(session);
		},
		startWorker: ctx.startWorker,
		stopWorker: ctx.stopWorker,
	};
}
