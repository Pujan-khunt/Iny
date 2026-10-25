import { type AnsiTheme, RAW_ANSI, NO_ANSI, DIVIDER_LINE } from "./TriageAnsi";

export interface ExtractionErrorInfo {
	name?: string;
	message?: string;
	constructor?: { name?: string };
	cause?: { issues?: Array<{ path?: string[]; message?: string }> };
	rawResponse?: unknown;
}

export interface TriageErrorCardRendererOptions {
	enableAnsi?: boolean;
}

export class TriageErrorCardRenderer {
	private readonly ansi: AnsiTheme;

	constructor(options?: TriageErrorCardRendererOptions) {
		this.ansi = options?.enableAnsi === false ? NO_ANSI : RAW_ANSI;
	}

	render(error: unknown, targetMessageId: string): string {
		const err = (error ?? {}) as ExtractionErrorInfo;
		const { ansi } = this;
		const border = ansi.bold + DIVIDER_LINE + ansi.reset;
		const errorType = err.name || err.constructor?.name || "ExtractionError";
		const lines = [
			border,
			`${ansi.bold}${ansi.red}❌ EXTRACTION ENCOUNTERED AN ERROR${ansi.reset}`,
			border,
			`Error Type:    ${ansi.bold}${errorType}${ansi.reset}`,
			`Error Details: ${ansi.red}${err.message ? `"${err.message}"` : String(error)}${ansi.reset}`,
			...this.formatValidationIssues(err),
			`Target Message:${targetMessageId}`,
			`Staging State: ${ansi.yellow}UNCHANGED (message remains 'pending' in database)${ansi.reset}`,
			...this.formatRawResponse(err.rawResponse),
			border,
			"Actions:",
			`  ${ansi.bold}[r]${ansi.reset} Retry Extraction (immediately re-attempts extraction on this message)`,
			`  ${ansi.bold}[c]${ansi.reset} Cancel & Return to Message List`,
			DIVIDER_LINE,
		];
		return lines.join("\n");
	}

	private formatValidationIssues(err: ExtractionErrorInfo): string[] {
		if (!err.cause?.issues || !Array.isArray(err.cause.issues)) return [];
		const lines = [`${this.ansi.bold}${this.ansi.yellow}Validation Issues:${this.ansi.reset}`];
		for (const issue of err.cause.issues) {
			lines.push(`  • ${issue.path?.length ? issue.path.join(".") : "(root)"}: ${issue.message}`);
		}
		return lines;
	}

	private formatRawResponse(raw: unknown): string[] {
		if (!raw) return [];
		const formatted = typeof raw === "string" ? raw.trim() : JSON.stringify(raw, null, 2);
		return [
			this.ansi.bold +
				"- - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - - -" +
				this.ansi.reset,
			`${this.ansi.bold}${this.ansi.cyan}Raw LLM Response:${this.ansi.reset}`,
			formatted,
		];
	}
}
