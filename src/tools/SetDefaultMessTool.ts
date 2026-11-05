import { z } from "zod";
import { BaseTool } from "./BaseTool";
import { ToolExecutionContext, ToolResult } from "../core/ports/ToolRegistryPort";
import { AccessControlPort } from "../core/ports/AccessControlPort";
import { Vendor } from "../core/entities/MessMeal";

const setDefaultMessSchema = z.object({
	vendor: z
		.enum(["cheftalk_regular", "cheftalk_jain", "tcb"])
		.describe(
			'The mess caterer to set as default: "cheftalk_regular", "cheftalk_jain", or "tcb" (The Craving Brew / Uniworld).',
		),
});

type SetDefaultMessInput = z.infer<typeof setDefaultMessSchema>;

const VENDOR_LABELS: Record<Vendor, string> = {
	cheftalk_regular: "Cheftalk",
	cheftalk_jain: "Cheftalk Jain",
	tcb: "TCB",
};

/**
 * Tool for setting the user's persistent default mess preference.
 */
export class SetDefaultMessTool extends BaseTool<typeof setDefaultMessSchema> {
	readonly name = "set_default_mess";
	readonly description =
		'Sets the user\'s default mess caterer preference (e.g. "set default to TCB", "make cheftalk my default mess"). ' +
		"Output is terminal. Call when the user explicitly expresses intent to change their default mess.";
	readonly schema = setDefaultMessSchema as typeof setDefaultMessSchema & Record<string, unknown>;

	constructor(private readonly accessControl: AccessControlPort) {
		super();
	}

	protected async run(
		args: SetDefaultMessInput,
		context?: ToolExecutionContext,
	): Promise<ToolResult> {
		if (!context?.userId) {
			return {
				content: "Error: No user identity found in execution context to update default mess.",
				isTerminal: true,
			};
		}

		await this.accessControl.setDefaultVendor(context.userId, args.vendor);
		const label = VENDOR_LABELS[args.vendor];
		return {
			content: `✅ Your default vendor has been updated to *${label}*. When you ask for "menu", you'll see ${label} by default.`,
			isTerminal: true,
		};
	}
}
