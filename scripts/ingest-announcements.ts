import { PostgresMessAuditRestorer } from "../src/adapters/outbound/mess/postgres/PostgresMessAuditRestorer";
import { PostgresStagingQueue } from "../src/adapters/outbound/mess/postgres/PostgresStagingQueue";
import { PostgresMealCommitter } from "../src/adapters/outbound/mess/postgres/PostgresMealCommitter";
import { PostgresMealRollback } from "../src/adapters/outbound/mess/postgres/PostgresMealRollback";
import { PostgresOperationalWriter } from "../src/adapters/outbound/mess/postgres/PostgresOperationalWriter";
import { PostgresSwapWriter } from "../src/adapters/outbound/mess/postgres/PostgresSwapWriter";
import { PostgresMessWriteGuard } from "../src/adapters/outbound/mess/postgres/PostgresMessWriteGuard";
import { PostgresMessOperationAudit } from "../src/adapters/outbound/mess/postgres/PostgresMessOperationAudit";
import { PostgresMessProvenance } from "../src/adapters/outbound/mess/postgres/PostgresMessProvenance";
import { PostgresMessCommitPreparation } from "../src/adapters/outbound/mess/postgres/PostgresMessCommitPreparation";
import { parseArgs, promisify } from "node:util";
import { execFile } from "node:child_process";
import postgres from "postgres";
import OpenAI from "openai";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadConfig } from "../src/config";
import { PinoLoggerAdapter } from "../src/adapters/outbound/logger/PinoLoggerAdapter";
import { PostgresMessStagingRepository } from "../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository";
import { DeepseekVisionExtractor } from "../src/adapters/outbound/mess/extraction/DeepseekVisionExtractor";
import { DeepseekTextExtractor } from "../src/adapters/outbound/mess/extraction/DeepseekTextExtractor";
import { PdfRasterizer } from "../src/adapters/outbound/mess/extraction/PdfRasterizer";
import { InteractiveJsonEditor } from "../src/adapters/inbound/cli/InteractiveJsonEditor";
import { MediaPreviewer } from "../src/adapters/inbound/cli/MediaPreviewer";
import { TriageTerminalView } from "../src/adapters/inbound/cli/TriageTerminalView";
import { TriageCliController } from "../src/adapters/inbound/cli/TriageCliController";
import { TriageIo } from "../src/adapters/inbound/cli/TriageIo";
import { TriageMenuRenderer } from "../src/adapters/inbound/cli/TriageMenuRenderer";
import { TriagePreviewRenderer } from "../src/adapters/inbound/cli/TriagePreviewRenderer";
import { TriageWeeklyMenuRenderer } from "../src/adapters/inbound/cli/TriageWeeklyMenuRenderer";
import { TriageCompositeRenderer } from "../src/adapters/inbound/cli/TriageCompositeRenderer";
import { TriageMessageActions } from "../src/adapters/inbound/cli/TriageMessageActions";
import { TriageWeeklyMenuController } from "../src/adapters/inbound/cli/TriageWeeklyMenuController";
import { TriageWeeklyMenuReview } from "../src/adapters/inbound/cli/TriageWeeklyMenuReview";
import { TriageAnnouncementController } from "../src/adapters/inbound/cli/TriageAnnouncementController";
import { MealSwapResolver } from "../src/core/services/MealSwapResolver";
import { MenuDishNormalizer } from "../src/core/services/MenuDishNormalizer";
import * as messSchema from "../src/adapters/outbound/mess/postgres/schema";

function createStaging(db: ReturnType<typeof drizzle>, logger: PinoLoggerAdapter) {
	const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
	return new PostgresMessStagingRepository(
		new PostgresStagingQueue(db, logger, new PostgresMessWriteGuard(audit), audit),
		new PostgresMealCommitter(
			db,
			logger,
			new PostgresOperationalWriter(),
			new PostgresSwapWriter(),
			new PostgresMessWriteGuard(audit),
			audit,
			new PostgresMessCommitPreparation(),
		),
		new PostgresMealRollback(
			db,
			logger,
			new PostgresMessWriteGuard(audit),
			new PostgresMessAuditRestorer(audit),
			audit,
		),
	);
}

function createCli(staging: PostgresMessStagingRepository, config: ReturnType<typeof loadConfig>) {
	const io = new TriageIo();
	const view = new TriageTerminalView(
		new TriageMenuRenderer(),
		new TriagePreviewRenderer(new TriageWeeklyMenuRenderer(), new TriageCompositeRenderer()),
	);
	const editor = new InteractiveJsonEditor({
		promptRetry: async (error) =>
			(
				await io.prompt(
					`\nInvalid JSON or schema mismatch: ${error}\n[r] Retry editing / [c] Cancel: `,
				)
			).toLowerCase() === "r",
	});
	const client = new OpenAI({ apiKey: config.DEEPSEEK_API_KEY, baseURL: config.DEEPSEEK_BASE_URL });
	const review = new TriageWeeklyMenuReview(io, view, staging, editor, MenuDishNormalizer);
	const weekly = new TriageWeeklyMenuController(
		io,
		view,
		new DeepseekVisionExtractor(client, config.DEEPSEEK_MODEL),
		new PdfRasterizer(promisify(execFile)),
		review,
	);
	const announcement = new TriageAnnouncementController(
		io,
		view,
		staging,
		new DeepseekTextExtractor(client, config.DEEPSEEK_MODEL),
		editor,
		new MealSwapResolver(staging),
	);
	return new TriageCliController(
		io,
		view,
		staging,
		new TriageMessageActions(io, view, staging, new MediaPreviewer()),
		weekly,
		announcement,
	);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			limit: { type: "string", short: "l", default: "10" },
			date: { type: "string", short: "d" },
		},
		allowPositionals: false,
	});
	const config = loadConfig();
	const sqlClient = postgres(config.DATABASE_URL, {
		max: 2,
		idle_timeout: 10,
		connect_timeout: 10,
	});
	try {
		const staging = createStaging(
			drizzle(sqlClient, { schema: messSchema }),
			new PinoLoggerAdapter(config.LOG_LEVEL),
		);
		await createCli(staging, config).run({
			limit: parseInt(values.limit ?? "10", 10),
			date: values.date,
		});
	} finally {
		await sqlClient.end();
	}
}

main().catch((err) => {
	console.error("Fatal CLI Error:", err);
	process.exit(1);
});
