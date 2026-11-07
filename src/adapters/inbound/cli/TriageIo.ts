import readline from "node:readline";

/** Interactive input/output supplied to every manual triage flow. */
export interface CliIo {
	/** Returns the operator's trimmed response; input failures reject. */
	prompt(question: string): Promise<string>;
	/** Writes a complete presentation message. */
	print(message: string): void;
	/** Releases input resources, if any. */
	close?(): void;
}

/** Lazy terminal input keeps administrative startup independent of readline. */
export class TriageIo implements CliIo {
	private rl: readline.Interface | null = null;
	/** Reads one trimmed terminal response. */
	async prompt(question: string): Promise<string> {
		this.rl ??= readline.createInterface({ input: process.stdin, output: process.stdout });
		return new Promise((resolve) =>
			this.rl!.question(question, (answer) => resolve(answer.trim())),
		);
	}
	/** Prints a rendered card or status. */
	print(message: string): void {
		console.log(message);
	}
	/** Closes readline; repeated calls are harmless. */
	close(): void {
		this.rl?.close();
		this.rl = null;
	}
}
