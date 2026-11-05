import OpenAI from "openai";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FoodCandidate, SourceEvidence } from "../../src/core/entities/FoodAnnouncement";
import type { LoggerPort } from "../../src/core/ports/LoggerPort";
import type { NormalizedWhatsAppMessage } from "../../src/adapters/inbound/whatsapp/router/NormalizedWhatsAppMessage";
import { FoodAnnouncementInboundAdapter } from "../../src/adapters/inbound/whatsapp/FoodAnnouncementInboundAdapter";
import { StageIncomingFoodAnnouncement } from "../../src/core/use-cases/StageIncomingFoodAnnouncement";
import { ProcessNextFoodAnnouncement } from "../../src/core/use-cases/ProcessNextFoodAnnouncement";
import { MealSwapResolver } from "../../src/core/services/MealSwapResolver";
import { DeepseekFoodAssessmentAdapter } from "../../src/adapters/outbound/mess/extraction/DeepseekFoodAssessmentAdapter";
import {
	PdfRasterizer,
	type CommandRunner,
} from "../../src/adapters/outbound/mess/extraction/PdfRasterizer";
import { PostgresFoodAdmission } from "../../src/adapters/outbound/mess/postgres/PostgresFoodAdmission";
import { PostgresFoodWorkQueue } from "../../src/adapters/outbound/mess/postgres/PostgresFoodWorkQueue";
import { PostgresFoodFinalizer } from "../../src/adapters/outbound/mess/postgres/PostgresFoodFinalizer";
import { PostgresFoodIngestionRepository } from "../../src/adapters/outbound/mess/postgres/PostgresFoodIngestionRepository";
import { PostgresMessOperationAudit } from "../../src/adapters/outbound/mess/postgres/PostgresMessOperationAudit";
import { PostgresMessProvenance } from "../../src/adapters/outbound/mess/postgres/PostgresMessProvenance";
import { PostgresMessWriteGuard } from "../../src/adapters/outbound/mess/postgres/PostgresMessWriteGuard";
import { PostgresMealCommitter } from "../../src/adapters/outbound/mess/postgres/PostgresMealCommitter";
import { PostgresOperationalWriter } from "../../src/adapters/outbound/mess/postgres/PostgresOperationalWriter";
import { PostgresSwapWriter } from "../../src/adapters/outbound/mess/postgres/PostgresSwapWriter";
import { PostgresMessCommitPreparation } from "../../src/adapters/outbound/mess/postgres/PostgresMessCommitPreparation";
import { PostgresMessStagingRepository } from "../../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository";
import { PostgresStagingQueue } from "../../src/adapters/outbound/mess/postgres/PostgresStagingQueue";
import { PostgresMealRollback } from "../../src/adapters/outbound/mess/postgres/PostgresMealRollback";
import { PostgresMessAuditRestorer } from "../../src/adapters/outbound/mess/postgres/PostgresMessAuditRestorer";

const databaseUrl = process.env.FOOD_INGESTION_TEST_DATABASE_URL;
const group = "acceptance@g.us";
const originalTime = "2026-10-31T18:20:00Z"; // 23:50 IST, still October 31.
const announcement = "Tommorow (1/11/26), lunch will be arranged in the hostel for all batches";
const verified = {
	verdict: "accept",
	completeCoverage: true,
	missingFields: [],
	conflictingFields: [],
	unsupportedClauses: [],
};
const logger = {
	info: vi.fn(),
	debug: vi.fn(),
	warn: vi.fn(),
	error: vi.fn(),
} as unknown as LoggerPort;
type Extraction = { kind: "candidate"; candidate: FoodCandidate; evidence: SourceEvidence[] };

function menuExtraction(): Extraction {
	const candidate: Extract<FoodCandidate, { kind: "weekly_menu" }> = {
		kind: "weekly_menu",
		dateRange: { start: "2026-11-01", end: "2026-11-07" },
		menu: {
			vendor: "tcb",
			meals: Array.from({ length: 21 }, (_, i) => ({
				mealDate: `2026-11-0${Math.floor(i / 3) + 1}`,
				mealSlot: (["breakfast", "lunch", "dinner"] as const)[i % 3],
				items: ["Masala FRYCRUMS/Papad (2 pcs)", "Frycrumsville", "Akki Rotti"],
			})),
		},
	};
	const fields: [string, string][] = [
		["/menu/vendor", "Uniworld"],
		["/dateRange/start", "1/11/26"],
		["/dateRange/end", "7/11/26"],
	];
	return {
		kind: "candidate",
		candidate,
		evidence: fields.map(([fieldPath, rawValue]) => ({
			fieldPath,
			rawValue,
			clause: rawValue,
			location: { kind: "image", page: 1, row: fieldPath, column: "source" },
		})),
	};
}
function textEvidence(
	body: string,
	prefix: string,
	fields: [string, string][],
	clause = body,
): SourceEvidence[] {
	return fields.map(([field, rawValue]) => ({
		fieldPath: `${prefix}/${field}`,
		rawValue,
		clause,
		location: {
			kind: "text",
			start: body.indexOf(rawValue),
			end: body.indexOf(rawValue) + rawValue.length,
		},
	}));
}
function locationExtraction(body = announcement): Extraction {
	return {
		kind: "candidate",
		candidate: {
			kind: "operational_announcement",
			announcement: {
				locations: [
					{
						mealDate: "2026-11-01",
						mealSlot: "lunch",
						hostelBatches: ["ALL_BATCHES"],
						collegeBatches: [],
					},
				],
				timings: [],
				changes: [],
				swaps: [],
			},
		},
		evidence: textEvidence(body, "/announcement/locations/0", [
			["mealDate", "1/11/26"],
			["mealSlot", "lunch"],
			["hostelBatches/0", "all batches"],
		]),
	};
}
function message(
	id: string,
	overrides: Partial<NormalizedWhatsAppMessage> = {},
): NormalizedWhatsAppMessage {
	return {
		messageId: id,
		chatJid: group,
		chatType: "group",
		senderJid: "123@lid",
		senderType: "lid",
		companionLidJid: null,
		fromMe: false,
		upsertType: "notify",
		originalTimestamp: +new Date(originalTime),
		timestamp: +new Date(originalTime),
		content: { type: "text", text: announcement, mimeType: null },
		downloadMedia: async () => Buffer.from("offline-image"),
		...overrides,
	};
}
function sdk(replies: unknown[]) {
	const create = vi.fn(async () => ({
		id: "offline",
		object: "chat.completion",
		created: 1,
		model: "offline-fixture",
		choices: [
			{
				index: 0,
				finish_reason: "stop",
				logprobs: null,
				message: { role: "assistant", content: JSON.stringify(replies.shift()), refusal: null },
			},
		],
	}));
	return { client: { chat: { completions: { create } } } as unknown as OpenAI, create };
}

// Synthetic geometry only. These bytes are not a representative vendor menu corpus.
const syntheticPdf = Buffer.from("%PDF-offline-fixture");
function png(width: number, height: number) {
	const chunk = (name: string, data: Buffer) => {
		const bytes = Buffer.alloc(data.length + 12),
			type = Buffer.from(name);
		bytes.writeUInt32BE(data.length);
		type.copy(bytes, 4);
		data.copy(bytes, 8);
		bytes.writeUInt32BE(crc32(Buffer.concat([type, data])), data.length + 8);
		return bytes;
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	return Buffer.concat([
		Buffer.from("89504e470d0a1a0a", "hex"),
		chunk("IHDR", header),
		chunk("IDAT", deflateSync(Buffer.alloc((width + 1) * height))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}
function pdfFixture(
	options: {
		pages?: number;
		points?: number;
		failRender?: boolean;
		oversizedOutput?: boolean;
	} = {},
) {
	const runner: CommandRunner = vi.fn(async (file, args) => {
		if (file === "pdfinfo")
			return {
				stdout: `Pages: ${options.pages ?? 1}\nPage 1 rot: 0\nPage 1 MediaBox: 0 0 ${options.points ?? 72} 36\n`,
				stderr: "",
			};
		if (options.failRender) throw new Error("Poppler resource limit fixture");
		const dpi = Number(args[args.indexOf("-r") + 1]);
		await fs.writeFile(
			`${args.at(-1)}.png`,
			options.oversizedOutput ? Buffer.alloc(32 * 1024 * 1024 + 1) : png(dpi, dpi / 2),
		);
		return { stdout: "", stderr: "" };
	});
	return { runner, rasterizer: new PdfRasterizer(runner) };
}

describe.skipIf(!databaseUrl)(
	"food ingestion acceptance (simulated extraction, real PostgreSQL)",
	() => {
		const schema = `iny_acceptance_${randomUUID().replaceAll("-", "")}`;
		let admin: ReturnType<typeof postgres>;
		let sql: ReturnType<typeof postgres>;
		function runtime(
			replies: unknown[],
			pdf = new PdfRasterizer(async () => {
				throw new Error("Unexpected Poppler invocation");
			}),
		) {
			const db = drizzle(sql),
				audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
			const guard = new PostgresMessWriteGuard(audit);
			const committer = new PostgresMealCommitter(
				db,
				logger,
				new PostgresOperationalWriter(),
				new PostgresSwapWriter(),
				guard,
				audit,
				new PostgresMessCommitPreparation(),
			);
			const staging = new PostgresMessStagingRepository(
				new PostgresStagingQueue(db, logger, guard, audit),
				committer,
				new PostgresMealRollback(db, logger, guard, new PostgresMessAuditRestorer(audit), audit),
			);
			const repo = new PostgresFoodIngestionRepository(
				new PostgresFoodAdmission(db),
				new PostgresFoodWorkQueue(db),
				new PostgresFoodFinalizer(db, guard, committer),
			);
			const fake = sdk(replies);
			const assessment = new DeepseekFoodAssessmentAdapter(fake.client, pdf, "offline-fixture");
			const processor = new ProcessNextFoodAnnouncement(
				repo,
				assessment,
				new MealSwapResolver(staging),
				logger,
			);
			const inbound = new FoodAnnouncementInboundAdapter({
				targetGroupJid: group,
				useCase: new StageIncomingFoodAnnouncement(repo, logger),
				logger,
			});
			return {
				repo,
				staging,
				processor,
				fake,
				inbound,
				deliver: (input: NormalizedWhatsAppMessage) => inbound.handle(input),
			};
		}
		beforeAll(async () => {
			admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
			await admin.unsafe(`CREATE SCHEMA "${schema}"`);
			sql = postgres(databaseUrl!, {
				max: 4,
				connection: { search_path: schema },
				onnotice: () => {},
			});
			for (const migration of ["0005_soft_scalphunter", "0006_automated_food_ingestion"]) {
				const source = await fs.readFile(`drizzle/migrations/${migration}.sql`, "utf8");
				for (const statement of source.split("--> statement-breakpoint"))
					await sql.unsafe(statement.replaceAll('"public".', `"${schema}".`));
			}
		});
		afterAll(async () => {
			if (sql) await sql.end();
			if (admin) {
				await admin.unsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
				await admin.end();
			}
		});
		afterEach(() => vi.useRealTimers());
		beforeEach(async () => {
			await sql`TRUNCATE mess_meals, mess_meal_location_details, mess_meal_timing_extensions, mess_meal_changes, mess_ingestion_operation_audits, food_announcement_ingestions, food_ingestion_settings, whatsapp_group_food_announcements_messages CASCADE`;
			await runtime([]).repo.initialize(group);
			await sql`UPDATE food_ingestion_settings SET activated_at = '2026-10-30T00:00:00Z'`;
			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(new Date("2026-11-05T12:00:00Z"));
		});
		async function noWrites(id: string) {
			for (const table of [
				"mess_meals",
				"mess_meal_location_details",
				"mess_meal_timing_extensions",
				"mess_meal_changes",
				"mess_ingestion_operation_audits",
			])
				expect(
					await sql.unsafe(`SELECT * FROM ${table} WHERE source_message_id = $1`, [id]),
				).toHaveLength(0);
		}
		async function state(id: string) {
			return (await sql`SELECT * FROM food_announcement_ingestions WHERE message_id = ${id}`)[0];
		}
		const image = { type: "image", text: null, mimeType: "image/png" } as const;
		it("accepts 21 unique slots and audits exact whole-word corrections while retaining unfamiliar names (1,4,5,6)", async () => {
			const extracted = menuExtraction(),
				f = runtime([extracted, verified]);
			await f.deliver(message("complete-menu", { content: image }));
			expect(await f.processor.execute(new AbortController().signal)).toEqual({
				outcome: "accepted",
			});
			const rows =
				await sql`SELECT meal_date, meal_slot, items FROM mess_meals ORDER BY meal_date, meal_slot`;
			expect(rows).toHaveLength(21);
			expect(new Set(rows.map((row) => `${row.meal_date}/${row.meal_slot}`)).size).toBe(21);
			expect(rows[0].items).toEqual(["Masala Fryums/Papad (2 pcs)", "Frycrumsville", "Akki Rotti"]);
			const decision = await state("complete-menu");
			expect(decision.corrections).toHaveLength(21);
			expect(decision.corrections[0]).toEqual({
				mealDate: "2026-11-01",
				mealSlot: "breakfast",
				itemIndex: 0,
				originalItem: "Masala FRYCRUMS/Papad (2 pcs)",
				correctedItem: "Masala Fryums/Papad (2 pcs)",
				aliasId: "frycrums-to-fryums",
			});
			expect(decision.candidate).toEqual(extracted.candidate);
			expect(
				(
					await sql`SELECT media_buffer FROM whatsapp_group_food_announcements_messages WHERE id = 'complete-menu'`
				)[0].media_buffer,
			).toEqual(Buffer.from("offline-image"));
			expect(
				(await sql`SELECT corrections FROM mess_ingestion_operation_audits`)[0].corrections.initial,
			).toEqual(decision.corrections);
		});
		it.each([
			"duplicate slots",
			"missing day",
			"daily menu",
			"unknown vendor",
			"missing vendor",
			"undated menu",
			"unreadable cell",
			"missing date evidence",
		])("rejects %s without any partial operational or audit rows (2,3)", async (flaw) => {
			const extracted = menuExtraction();
			if (extracted.candidate.kind !== "weekly_menu") throw new Error("Menu fixture required");
			const meals = extracted.candidate.menu.meals;
			if (flaw === "duplicate slots") meals[20] = { ...meals[0] };
			if (flaw === "missing day") meals.splice(18, 3, ...meals.slice(0, 3));
			if (flaw === "daily menu") extracted.candidate.menu.meals = meals.slice(0, 3);
			if (flaw === "unknown vendor")
				extracted.evidence[0] = { ...extracted.evidence[0], rawValue: "Mystery Caterer" };
			if (flaw === "missing vendor") {
				extracted.candidate.menu.vendor = "cheftalk_regular";
				extracted.evidence = extracted.evidence.filter((e) => e.fieldPath !== "/menu/vendor");
			}
			if (flaw === "undated menu")
				extracted.evidence = extracted.evidence.filter(
					(e) => !e.fieldPath.startsWith("/dateRange/"),
				);
			if (flaw === "unreadable cell") meals[0].items[0] = "unreadable";
			if (flaw === "missing date evidence")
				extracted.evidence = extracted.evidence.filter((e) => e.fieldPath !== "/dateRange/start");
			const f = runtime([extracted, verified]);
			await f.deliver(message(flaw, { content: image }));
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
			});
			expect(await state(flaw)).toMatchObject({ state: "rejected", lease_token: null });
			await noWrites(flaw);
		});
		it("accepts the original October 31 IST typo announcement despite delayed processing (7,16)", async () => {
			const f = runtime([locationExtraction(), verified]);
			await f.deliver(message("original-ist"));
			expect(await f.processor.execute(new AbortController().signal)).toEqual({
				outcome: "accepted",
			});
			expect(
				await sql`SELECT meal_date, meal_slot, hostel_batches, college_batches FROM mess_meal_location_details`,
			).toEqual([
				{
					meal_date: "2026-11-01",
					meal_slot: "lunch",
					hostel_batches: ["ALL_BATCHES"],
					college_batches: [],
				},
			]);
			expect(f.fake.create).toHaveBeenCalledTimes(2);
			for (const [request, options] of f.fake.create.mock.calls as unknown as [
				unknown,
				unknown,
			][]) {
				expect(JSON.stringify(request)).toContain("2026-10-31 23:50 IST");
				expect(options).toMatchObject({ timeout: 180_000, maxRetries: 0 });
			}
		});
		it("rejects the identical text sent on November 1 IST with zero rows (8)", async () => {
			const f = runtime([locationExtraction(), verified]);
			await f.deliver(
				message("conflicting-date", { originalTimestamp: +new Date("2026-10-31T18:40:00Z") }),
			);
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
				reason: "conflicting_date",
			});
			await noWrites("conflicting-date");
		});
		it("rejects an undated announcement instead of supplying today's date (9)", async () => {
			const body = "Lunch will be arranged in the hostel for all batches",
				extraction = locationExtraction(body);
			extraction.evidence = textEvidence(body, "/announcement/locations/0", [
				["mealSlot", "Lunch"],
				["hostelBatches/0", "all batches"],
			]);
			const f = runtime([extraction, verified]);
			await f.deliver(
				message("undated", { content: { type: "text", text: body, mimeType: null } }),
			);
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
				reason: "missing_date",
			});
			await noWrites("undated");
		});
		it("rejects the complete mixed message when verification finds an ambiguous instruction (10)", async () => {
			const body = `${announcement}. Dinner might replace rice with something else.`;
			const extracted = locationExtraction();
			const f = runtime([
				extracted,
				{ ...verified, unsupportedClauses: ["Dinner might replace rice with something else."] },
			]);
			await f.deliver(message("mixed", { content: { type: "text", text: body, mimeType: null } }));
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
				reason: "ambiguous_content",
			});
			await noWrites("mixed");
			expect(f.fake.create).toHaveBeenCalledTimes(2);
		});
		it("rejects a mixed candidate's incomplete replacement even when both model passes accept (10)", async () => {
			const body = `${announcement}. 1/11/26 tcb dinner replace rice with something.`;
			const extracted = locationExtraction();
			if (extracted.candidate.kind !== "operational_announcement")
				throw new Error("Operational fixture required");
			extracted.candidate = {
				...extracted.candidate,
				announcement: {
					...extracted.candidate.announcement,
					changes: [
						{
							mealDate: "2026-11-01",
							mealSlot: "dinner",
							targetVendor: "tcb",
							changeType: "replacement",
							affectedItem: "something",
							originalItem: null,
						},
					],
				},
			};
			const f = runtime([extracted, verified]);
			await f.deliver(
				message("incomplete-replacement", {
					content: { type: "text", text: body, mimeType: null },
				}),
			);
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
				reason: "ambiguous_content",
			});
			await noWrites("incomplete-replacement");
		});
		it.each(["source", "target"])(
			"rejects all clauses when the swap %s meal is missing (10)",
			async (missing) => {
				const clause = "1/11/26 dinner will serve 2/11/26 lunch menu for tcb";
				const body = `${announcement}. ${clause}`,
					extracted = locationExtraction();
				if (extracted.candidate.kind !== "operational_announcement")
					throw new Error("Operational fixture required");
				extracted.candidate = {
					...extracted.candidate,
					announcement: {
						...extracted.candidate.announcement,
						swaps: [
							{
								sourceMealDate: "2026-11-02",
								sourceMealSlot: "lunch",
								targetMealDate: "2026-11-01",
								targetMealSlot: "dinner",
								targetVendor: "tcb",
							},
						],
					},
				};
				extracted.evidence.push(
					...textEvidence(
						body,
						"/announcement/swaps/0",
						[
							["sourceMealDate", "2/11/26"],
							["sourceMealSlot", "lunch"],
							["targetMealDate", "1/11/26"],
							["targetMealSlot", "dinner"],
							["targetVendor", "tcb"],
						],
						clause,
					),
				);
				// The repeated lunch/date words must point into the swap clause, not the earlier location.
				extracted.evidence = extracted.evidence.map((e) => {
					if (!e.fieldPath.startsWith("/announcement/swaps/")) return e;
					const start = body.indexOf(e.rawValue, body.indexOf(clause));
					return { ...e, location: { kind: "text", start, end: start + e.rawValue.length } };
				});
				const presentDate = missing === "source" ? "2026-11-01" : "2026-11-02",
					presentSlot = missing === "source" ? "dinner" : "lunch";
				await sql`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES (${presentDate}, ${presentSlot}, 'tcb', ARRAY['Existing Rice'], 'baseline')`;
				const f = runtime([extracted, verified]);
				await f.deliver(
					message("missing-swap", { content: { type: "text", text: body, mimeType: null } }),
				);
				expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
					outcome: "rejected",
					reason: "missing_prerequisite",
				});
				await noWrites("missing-swap");
				expect((await sql`SELECT items FROM mess_meals`)[0].items).toEqual(["Existing Rice"]);
			},
		);
		it("excludes media-only operational announcements and their captions (11)", async () => {
			const f = runtime([locationExtraction(), verified]);
			await f.deliver(message("operational-media", { content: { ...image, text: announcement } }));
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
				reason: "unsupported_type",
			});
			await noWrites("operational-media");
			expect(f.fake.create).toHaveBeenCalledTimes(1);
		});
		it("keeps append, pre-activation, missing timestamps and existing pending backlog out of extraction (12)", async () => {
			const f = runtime([]);
			await f.staging.stageMessage({
				id: "backlog",
				senderAddress: "123@lid",
				senderAddressType: "lid",
				messageType: "text",
				textBody: announcement,
				mediaMimeType: null,
				mediaBuffer: null,
				receivedAt: new Date(originalTime),
			});
			await f.deliver(message("backlog"));
			await f.deliver(message("append", { upsertType: "append" }));
			await f.deliver(
				message("old-notify", { originalTimestamp: +new Date("2026-10-29T00:00:00Z") }),
			);
			await f.deliver(message("missing-time", { originalTimestamp: null }));
			expect(await f.processor.execute(new AbortController().signal)).toBeNull();
			expect(f.fake.create).not.toHaveBeenCalled();
			expect(await state("backlog")).toBeUndefined();
			for (const id of ["append", "old-notify", "missing-time"]) {
				expect((await state(id)).state).toBe("ineligible");
				await noWrites(id);
			}
		});
		it("captures concurrent duplicate deliveries once and preserves accepted/rejected decisions across restart (13,14)", async () => {
			const f = runtime([
				locationExtraction(),
				verified,
				{ kind: "uncertain", detail: "Unclear food instruction." },
			]);
			await Promise.all([f.deliver(message("accepted")), f.deliver(message("accepted"))]);
			expect(await f.processor.execute(new AbortController().signal)).toEqual({
				outcome: "accepted",
			});
			await f.deliver(message("rejected"));
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "rejected",
			});
			const before = await sql`SELECT * FROM food_announcement_ingestions ORDER BY message_id`;
			const restarted = runtime([]);
			expect(await restarted.repo.initialize(group)).toEqual(new Date("2026-10-30T00:00:00Z"));
			await restarted.deliver(message("accepted"));
			await restarted.deliver(message("rejected"));
			expect(await restarted.processor.execute(new AbortController().signal)).toBeNull();
			expect(await sql`SELECT * FROM food_announcement_ingestions ORDER BY message_id`).toEqual(
				before,
			);
			expect(await sql`SELECT * FROM mess_meal_location_details`).toHaveLength(1);
			expect(await sql`SELECT * FROM mess_ingestion_operation_audits`).toHaveLength(1);
			expect(restarted.fake.create).not.toHaveBeenCalled();
			await noWrites("rejected");
		});
		it("does not capture wrong-group or bot-authored sources", async () => {
			const f = runtime([]);
			await f.deliver(message("wrong-group", { chatJid: "other@g.us" }));
			await f.deliver(message("bot", { fromMe: true }));
			expect(await sql`SELECT * FROM whatsapp_group_food_announcements_messages`).toHaveLength(0);
			expect(await f.processor.execute(new AbortController().signal)).toBeNull();
		});
		it("persists cancellation after inference without committing the candidate", async () => {
			const f = runtime([locationExtraction(), verified]),
				controller = new AbortController();
			await f.deliver(message("cancelled"));
			f.fake.create.mockImplementationOnce(async () => {
				controller.abort();
				return {
					id: "offline",
					object: "chat.completion",
					created: 1,
					model: "offline-fixture",
					choices: [],
				};
			});
			expect(await f.processor.execute(controller.signal)).toMatchObject({
				outcome: "failed",
				reason: "cancelled",
			});
			expect(await state("cancelled")).toMatchObject({ state: "failed", lease_token: null });
			await noWrites("cancelled");
		});
		it("rolls back every operational row when final acceptance fails after writes (15)", async () => {
			const f = runtime([menuExtraction(), verified]);
			await f.deliver(message("rollback", { content: image }));
			await sql.unsafe(
				"CREATE FUNCTION acceptance_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'accepted' THEN RAISE EXCEPTION 'forced acceptance rollback'; END IF; RETURN NEW; END $$",
			);
			await sql.unsafe(
				"CREATE TRIGGER acceptance_failure BEFORE UPDATE ON food_announcement_ingestions FOR EACH ROW EXECUTE FUNCTION acceptance_failure()",
			);
			try {
				expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
					outcome: "failed",
					reason: "unexpected_failure",
				});
				await noWrites("rollback");
				expect(await state("rollback")).toMatchObject({ state: "failed", candidate: null });
				expect(
					(
						await sql`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = 'rollback'`
					)[0].status,
				).toBe("pending");
			} finally {
				await sql.unsafe("DROP TRIGGER acceptance_failure ON food_announcement_ingestions");
				await sql.unsafe("DROP FUNCTION acceptance_failure()");
			}
		});
		it("uses the complete 300 DPI PDF output identically in both offline assessment requests (17)", async () => {
			const pdf = pdfFixture(),
				f = runtime([menuExtraction(), verified], pdf.rasterizer);
			await f.deliver(
				message("pdf-default", {
					content: { type: "document", text: null, mimeType: "application/pdf" },
					downloadMedia: async () => syntheticPdf,
				}),
			);
			expect(await f.processor.execute(new AbortController().signal)).toEqual({
				outcome: "accepted",
			});
			expect(await sql`SELECT * FROM mess_meals`).toHaveLength(21);
			const expectedImage = `data:image/png;base64,${png(300, 150).toString("base64")}`;
			for (const call of f.fake.create.mock.calls)
				expect(JSON.stringify(call)).toContain(expectedImage);
			const renderCalls = vi.mocked(pdf.runner).mock.calls.filter(([file]) => file === "pdftoppm");
			expect(renderCalls).toHaveLength(1);
			expect(renderCalls[0][1]).toContain("300");
			expect(renderCalls[0][2]).toMatchObject({
				timeout: 30_000,
				killSignal: "SIGKILL",
				maxBuffer: 65_536,
			});
		});
		it.each([
			["multiple pages", { pages: 2 }, "rejected"],
			["pixel limit", { points: 20_000 }, "failed"],
			["render failure", { failRender: true }, "failed"],
			["output byte limit", { oversizedOutput: true }, "failed"],
		] as const)(
			"rejects %s without cropping, model fallback or partial writes (17,18)",
			async (name, options, outcome) => {
				const pdf = pdfFixture(options),
					f = runtime([menuExtraction(), verified], pdf.rasterizer);
				await f.deliver(
					message(name, {
						content: { type: "document", text: null, mimeType: "application/pdf" },
						downloadMedia: async () => syntheticPdf,
					}),
				);
				expect(await f.processor.execute(new AbortController().signal)).toMatchObject({ outcome });
				expect(f.fake.create).not.toHaveBeenCalled();
				await noWrites(name);
				const paths = vi
					.mocked(pdf.runner)
					.mock.calls.map(([file, args]) => (file === "pdfinfo" ? args.at(-1)! : args.at(-2)!));
				for (const file of paths)
					await expect(fs.stat(file)).rejects.toMatchObject({ code: "ENOENT" });
			},
		);
		it("fails media exceeding the explicit 32 MiB limit before requesting inference (18)", async () => {
			const f = runtime([menuExtraction(), verified]);
			await f.deliver(
				message("oversized", {
					content: image,
					downloadMedia: async () => Buffer.alloc(32 * 1024 * 1024 + 1),
				}),
			);
			expect(await f.processor.execute(new AbortController().signal)).toMatchObject({
				outcome: "failed",
				reason: "media_limits",
			});
			expect(f.fake.create).not.toHaveBeenCalled();
			await noWrites("oversized");
		});
	},
);

describe("PDF and evaluation evidence boundaries (simulated rendering, no quality claim)", () => {
	it("keeps explicit 300 DPI and default 600 DPI geometry with four times the synthetic pixels (17)", async () => {
		const { rasterizer } = pdfFixture();
		const low = await rasterizer.renderFirstPage(syntheticPdf, 300),
			high = await rasterizer.renderFirstPage(syntheticPdf);
		expect([low.widthPixels, low.heightPixels, low.dpi]).toEqual([300, 150, 300]);
		expect([high.widthPixels, high.heightPixels, high.dpi]).toEqual([600, 300, 600]);
		expect(high.widthPixels * high.heightPixels).toBe(4 * low.widthPixels * low.heightPixels);
		expect(low.elapsedMs).toBeGreaterThanOrEqual(0);
		expect(high.elapsedMs).toBeGreaterThanOrEqual(0);
	});
	it("requires an explicit representative manifest before the evaluation tool can run (18)", async () => {
		await expect(
			promisify(execFile)(
				process.execPath,
				["node_modules/tsx/dist/cli.mjs", "scripts/evaluate-menu-extraction.ts"],
				{ timeout: 10_000, env: { ...process.env, MENU_EVAL_API_KEY: "", MENU_EVAL_BASE_URL: "" } },
			),
		).rejects.toMatchObject({ code: 1, stderr: expect.stringContaining("Usage:") });
	});
});
