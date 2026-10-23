import { parseArgs } from "node:util";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadConfig } from "../src/config.js";
import { PinoLoggerAdapter } from "../src/adapters/outbound/logger/PinoLoggerAdapter.js";
import { PostgresMessStagingRepository } from "../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository.js";
import { DeepseekVisionExtractor } from "../src/adapters/outbound/mess/extraction/DeepseekVisionExtractor.js";
import { DeepseekTextExtractor } from "../src/adapters/outbound/mess/extraction/DeepseekTextExtractor.js";
import { PdfRasterizer } from "../src/adapters/outbound/mess/extraction/PdfRasterizer.js";
import { InteractiveJsonEditor } from "../src/adapters/inbound/cli/InteractiveJsonEditor.js";
import { MediaPreviewer } from "../src/adapters/inbound/cli/MediaPreviewer.js";
import { TriageTerminalView } from "../src/adapters/inbound/cli/TriageTerminalView.js";
import { TriageCliController } from "../src/adapters/inbound/cli/TriageCliController.js";
import * as messSchema from "../src/adapters/outbound/mess/postgres/schema.js";

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			limit: { type: "string", short: "l", default: "10" },
			date: { type: "string", short: "d" },
		},
		allowPositionals: false,
	});

	const limit = parseInt(values.limit ?? "10", 10);
	const date = values.date;

	const config = loadConfig();
	const logger = new PinoLoggerAdapter(config.LOG_LEVEL);

	const sqlClient = postgres(config.DATABASE_URL, {
		max: 2,
		idle_timeout: 10,
		connect_timeout: 10,
	});

	const db = drizzle(sqlClient, {
		schema: messSchema,
	});

	const stagingRepo = new PostgresMessStagingRepository(db, logger);
	const visionExtractor = new DeepseekVisionExtractor({
		apiKey: config.DEEPSEEK_API_KEY,
		baseURL: config.DEEPSEEK_BASE_URL,
		model: config.DEEPSEEK_MODEL,
	});
	const textExtractor = new DeepseekTextExtractor({
		apiKey: config.DEEPSEEK_API_KEY,
		baseURL: config.DEEPSEEK_BASE_URL,
		model: config.DEEPSEEK_MODEL,
	});
	const pdfRasterizer = new PdfRasterizer();
	const editor = new InteractiveJsonEditor();
	const previewer = new MediaPreviewer();
	const terminalView = new TriageTerminalView();

	const controller = new TriageCliController({
		stagingRepo,
		visionExtractor,
		textExtractor,
		pdfRasterizer,
		editor,
		previewer,
		terminalView,
	});

	try {
		await controller.run({ limit, date });
	} finally {
		controller.close?.();
		await sqlClient.end();
	}
}

main().catch((err) => {
	console.error("Fatal CLI Error:", err);
	process.exit(1);
});
