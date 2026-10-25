import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import readline from "node:readline";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";

export interface EditJsonResult<T> {
	success: boolean;
	data?: T;
	error?: string;
	cancelled?: boolean;
}

export interface InteractiveJsonEditorOptions {
	editor?: string;
	spawnSyncFn?: (command: string, args: string[], options: any) => SpawnSyncReturns<any>;
	promptRetry?: (errorMessage: string) => Promise<boolean>;
}

export class InteractiveJsonEditor {
	constructor(private readonly options?: InteractiveJsonEditorOptions) {}

	/**
	 * Resolves the configured CLI editor binary or command.
	 * Priority: $VISUAL || $EDITOR || 'vim'.
	 */
	resolveEditor(): string {
		return this.options?.editor || process.env.VISUAL || process.env.EDITOR || "vim";
	}

	/**
	 * Default terminal prompt asking the operator whether to retry editing
	 * without discarding their manual edits.
	 */
	async defaultPromptRetry(errorMessage: string): Promise<boolean> {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout,
		});
		return new Promise<boolean>((resolve) => {
			rl.question(
				`\nInvalid JSON or schema mismatch: ${errorMessage}\n[r] Retry editing / [c] Cancel: `,
				(ans) => {
					rl.close();
					resolve(ans.trim().toLowerCase() === "r");
				},
			);
		});
	}

	/**
	 * Writes the provided initialData as formatted JSON to a temporary file,
	 * launches the interactive text editor (Vim, Neovim, etc.), and upon exit,
	 * reads, parses, and validates the updated JSON with the provided Zod schema.
	 *
	 * If parsing or schema validation fails, provides error details and optionally
	 * permits retrying the edit before safely unlinking the temporary file in finally.
	 */
	async editJson<T>(initialData: T, schema: z.ZodType<T>): Promise<EditJsonResult<T>> {
		const editorCmd = this.resolveEditor();
		const [bin, ...extraArgs] = editorCmd.trim().split(/\s+/);

		const tempFileName = `iny_edit_${Date.now()}_${crypto.randomBytes(4).toString("hex")}.json`;
		const tempFilePath = path.join(os.tmpdir(), tempFileName);

		await fs.promises.writeFile(tempFilePath, JSON.stringify(initialData, null, 2), "utf-8");

		const spawnFn = this.options?.spawnSyncFn ?? spawnSync;

		try {
			while (true) {
				const result = spawnFn(bin, [...extraArgs, tempFilePath], {
					stdio: "inherit",
				});

				if (result.status !== 0) {
					return {
						success: false,
						cancelled: true,
						error: `Editor exited with non-zero status code: ${result.status}`,
					};
				}

				const promptRetry =
					this.options?.promptRetry ?? ((err: string) => this.defaultPromptRetry(err));

				const rawContent = await fs.promises.readFile(tempFilePath, "utf-8");

				let parsedJson: unknown;
				try {
					parsedJson = JSON.parse(rawContent);
				} catch (jsonErr: any) {
					const errMsg = `Invalid JSON syntax: ${jsonErr.message}`;
					const shouldRetry = await promptRetry(errMsg);
					if (shouldRetry) {
						continue;
					}
					return {
						success: false,
						error: errMsg,
					};
				}

				const validation = schema.safeParse(parsedJson);
				if (!validation.success) {
					const errMsg = `Validation error:\n${validation.error.message}`;
					const shouldRetry = await promptRetry(errMsg);
					if (shouldRetry) {
						continue;
					}
					return {
						success: false,
						error: errMsg,
					};
				}

				return {
					success: true,
					data: validation.data,
				};
			}
		} finally {
			try {
				if (fs.existsSync(tempFilePath)) {
					await fs.promises.unlink(tempFilePath);
				}
			} catch {
				// Silently ignore unlink error in cleanup
			}
		}
	}
}
