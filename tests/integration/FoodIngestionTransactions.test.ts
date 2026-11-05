import OpenAI from "openai";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { FoodIngestionWorker } from "../../src/adapters/inbound/workers/FoodIngestionWorker";
import { ProcessNextFoodAnnouncement } from "../../src/core/use-cases/ProcessNextFoodAnnouncement";
import { MealSwapResolver } from "../../src/core/services/MealSwapResolver";
import { DeepseekFoodAssessmentAdapter } from "../../src/adapters/outbound/mess/extraction/DeepseekFoodAssessmentAdapter";
import { PdfRasterizer } from "../../src/adapters/outbound/mess/extraction/PdfRasterizer";
import { PostgresMessStagingRepository } from "../../src/adapters/outbound/mess/postgres/PostgresMessStagingRepository";
import { PostgresMessAuditRestorer } from "../../src/adapters/outbound/mess/postgres/PostgresMessAuditRestorer";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import type { ValidatedFoodCommit } from "../../src/core/entities/FoodIngestion";
import { PostgresFoodFinalizer } from "../../src/adapters/outbound/mess/postgres/PostgresFoodFinalizer";
import { PostgresFoodIngestionRepository } from "../../src/adapters/outbound/mess/postgres/PostgresFoodIngestionRepository";
import type { FoodAnnouncementSource } from "../../src/core/entities/FoodAnnouncement";
import { PostgresFoodWorkQueue } from "../../src/adapters/outbound/mess/postgres/PostgresFoodWorkQueue";
import type { Vendor } from "../../src/core/entities/MessMeal";
import type { ResolvedMealSwapInput } from "../../src/core/entities/MessCommit";
import { PostgresMessWriteGuard } from "../../src/adapters/outbound/mess/postgres/PostgresMessWriteGuard";
import { PostgresMessOperationAudit } from "../../src/adapters/outbound/mess/postgres/PostgresMessOperationAudit";
import { PostgresOperationalWriter } from "../../src/adapters/outbound/mess/postgres/PostgresOperationalWriter";
import { PostgresFoodAdmission } from "../../src/adapters/outbound/mess/postgres/PostgresFoodAdmission";

import { PostgresMealRollback } from "../../src/adapters/outbound/mess/postgres/PostgresMealRollback";
import { PostgresMealCommitter } from "../../src/adapters/outbound/mess/postgres/PostgresMealCommitter";
import { PostgresSwapWriter } from "../../src/adapters/outbound/mess/postgres/PostgresSwapWriter";
import { PostgresStagingQueue } from "../../src/adapters/outbound/mess/postgres/PostgresStagingQueue";
import { MenuDishNormalizer } from "../../src/core/services/MenuDishNormalizer";
import type { LoggerPort } from "../../src/core/ports/LoggerPort";

import { PostgresMessProvenance } from "../../src/adapters/outbound/mess/postgres/PostgresMessProvenance";
import { PostgresMessCommitPreparation } from "../../src/adapters/outbound/mess/postgres/PostgresMessCommitPreparation";

const databaseUrl = process.env.FOOD_INGESTION_TEST_DATABASE_URL;
const schemaName = `iny_food_test_${randomUUID().replaceAll("-", "")}`;
const groupJid = "food-announcements@g.us";
let admin: ReturnType<typeof postgres>;
let client: ReturnType<typeof postgres>;
let activatedAt: Date;
let secondClient: ReturnType<typeof postgres>;

function inspectionQueue(logger: LoggerPort) {
	const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
	return new PostgresStagingQueue(
		drizzle(client),
		logger,
		new PostgresMessWriteGuard(audit),
		audit,
	);
}

function createQueue(connection = client) {
	return new PostgresFoodWorkQueue(drizzle(connection));
}

async function workRow(messageId: string) {
	const [row] =
		await client`SELECT *, extract(epoch FROM (next_attempt_at - clock_timestamp())) AS retry_seconds, extract(epoch FROM (lease_expires_at - clock_timestamp())) AS lease_seconds FROM food_announcement_ingestions WHERE message_id = ${messageId}`;
	return row;
}

async function ready(messageId: string) {
	await client`UPDATE food_announcement_ingestions SET next_attempt_at = clock_timestamp() - interval '1 second' WHERE message_id = ${messageId}`;
}

async function expire(messageId: string) {
	await client`UPDATE food_announcement_ingestions SET lease_expires_at = clock_timestamp() - interval '1 second' WHERE message_id = ${messageId}`;
}

function createRepository() {
	return new PostgresFoodAdmission(drizzle(client));
}

function makeSource(overrides: Partial<FoodAnnouncementSource> = {}): FoodAnnouncementSource {
	return {
		messageId: randomUUID(),
		groupJid,
		senderAddress: "123@lid",
		senderAddressType: "lid",
		deliveryMode: "notify",
		originalCreatedAt: new Date(activatedAt.getTime() + 1000),
		capturedAt: new Date(activatedAt.getTime() + 2000),
		messageType: "text",
		textBody: "Today's dinner is at the hostel.",
		mediaMimeType: null,
		mediaBytes: null,
		...overrides,
	};
}

async function countWorkRows(messageId: string) {
	const [row] =
		await client`SELECT count(*)::int AS count FROM food_announcement_ingestions WHERE message_id = ${messageId}`;
	return row.count;
}

async function applyMessMigrations() {
	for (const name of ["0005_soft_scalphunter", "0006_automated_food_ingestion"]) {
		const sql = await readFile(`drizzle/migrations/${name}.sql`, "utf8");
		for (const statement of sql.split("--> statement-breakpoint")) {
			// Generated public-qualified enum/foreign-key references must stay in this fixture schema.
			await client.unsafe(statement.replaceAll('"public".', `"${schemaName}".`));
		}
	}
}

describe.skipIf(!databaseUrl)(
	"food admission transactions (disposable PostgreSQL required)",
	() => {
		beforeAll(async () => {
			admin = postgres(databaseUrl!, { max: 1, onnotice: () => {} });
			await admin.unsafe(`CREATE SCHEMA "${schemaName}"`);
			client = postgres(databaseUrl!, {
				max: 8,
				connection: { search_path: schemaName },
				onnotice: () => {},
			});
			secondClient = postgres(databaseUrl!, {
				max: 1,
				connection: { search_path: schemaName },
				onnotice: () => {},
			});
			await applyMessMigrations();
		});

		afterAll(async () => {
			if (secondClient) await secondClient.end();
			if (client) await client.end();
			if (admin) {
				await admin.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
				await admin.end();
			}
		});

		beforeEach(async () => {
			await client`TRUNCATE mess_meals, mess_meal_location_details, mess_meal_timing_extensions, mess_meal_changes, mess_ingestion_operation_audits, food_announcement_ingestions, food_ingestion_settings, whatsapp_group_food_announcements_messages CASCADE`;
			activatedAt = await createRepository().initialize(groupJid);
		});

		describe("fenced automatic finalization", () => {
			const date = "2026-11-04";
			function repository(connection = client) {
				const db = drizzle(connection);
				const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
				const guard = new PostgresMessWriteGuard(audit);
				const committer = new PostgresMealCommitter(
					db,
					{ info: vi.fn() } as unknown as LoggerPort,
					new PostgresOperationalWriter(),
					new PostgresSwapWriter(),
					guard,
					audit,
					new PostgresMessCommitPreparation(),
				);
				return new PostgresFoodIngestionRepository(
					new PostgresFoodAdmission(db),
					new PostgresFoodWorkQueue(db),
					new PostgresFoodFinalizer(db, guard, committer),
				);
			}
			describe("worker with strict assessment and real persistence", () => {
				const text = "4/11/26 lunch in hostel for all batches";
				function extraction() {
					return {
						kind: "candidate",
						candidate: {
							kind: "operational_announcement",
							announcement: {
								locations: [
									{
										mealDate: date,
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
						evidence: [
							["mealDate", "4/11/26"],
							["mealSlot", "lunch"],
							["hostelBatches/0", "all batches"],
						].map(([field, rawValue]) => ({
							fieldPath: `/announcement/locations/0/${field}`,
							rawValue,
							clause: text,
							location: {
								kind: "text",
								start: text.indexOf(rawValue),
								end: text.indexOf(rawValue) + rawValue.length,
							},
						})),
					};
				}
				function processing(fetch: typeof globalThis.fetch, connection = client) {
					const db = drizzle(connection);
					const logger = { info: vi.fn(), error: vi.fn() } as unknown as LoggerPort;
					const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
					const guard = new PostgresMessWriteGuard(audit);
					const staging = new PostgresMessStagingRepository(
						new PostgresStagingQueue(db, logger, guard, audit),
						new PostgresMealCommitter(
							db,
							logger,
							new PostgresOperationalWriter(),
							new PostgresSwapWriter(),
							guard,
							audit,
							new PostgresMessCommitPreparation(),
						),
						new PostgresMealRollback(
							db,
							logger,
							guard,
							new PostgresMessAuditRestorer(audit),
							audit,
						),
					);
					const sdk = new OpenAI({
						apiKey: "offline-only",
						baseURL: "https://offline.invalid/v1",
						fetch,
					});
					const assessment = new DeepseekFoodAssessmentAdapter(
						sdk,
						new PdfRasterizer(promisify(execFile)),
						"test-model",
						logger,
					);
					return {
						logger,
						process: new ProcessNextFoodAnnouncement(
							repository(connection),
							assessment,
							new MealSwapResolver(staging),
							logger,
						),
					};
				}
				function worker(fetch: typeof globalThis.fetch) {
					const runtime = processing(fetch);
					return new FoodIngestionWorker(runtime.process, runtime.logger);
				}
				function completion(value: unknown) {
					return new Response(
						JSON.stringify({
							id: "offline",
							object: "chat.completion",
							created: 1,
							model: "test-model",
							choices: [
								{
									index: 0,
									finish_reason: "stop",
									logprobs: null,
									message: { role: "assistant", content: JSON.stringify(value), refusal: null },
								},
							],
						}),
						{ headers: { "content-type": "application/json" } },
					);
				}
				function pausedInference() {
					let resume!: () => void, entered!: () => void;
					const waiting = new Promise<void>((resolve) => {
						entered = resolve;
					});
					const blocked = new Promise<void>((resolve) => {
						resume = resolve;
					});
					const responses = [
						extraction(),
						{
							verdict: "accept",
							completeCoverage: true,
							missingFields: [],
							conflictingFields: [],
							unsupportedClauses: [],
						},
					];
					const fetch = vi.fn(async () => {
						if (responses.length === 2) {
							entered();
							await blocked;
						}
						return completion(responses.shift());
					});
					return { waiting, resume, fetch };
				}
				function immediateInference() {
					const responses = [
						extraction(),
						{
							verdict: "accept",
							completeCoverage: true,
							missingFields: [],
							conflictingFields: [],
							unsupportedClauses: [],
						},
					];
					return vi.fn(async () => completion(responses.shift()));
				}
				it("fences inference running on a separate connection when manual ignore wins", async () => {
					await repository().capture(makeSource({ messageId: "inference-manual", textBody: text }));
					const inference = pausedInference();
					const pending = processing(inference.fetch, secondClient).process.execute(
						new AbortController().signal,
					);
					try {
						await inference.waiting;
						expect((await workRow("inference-manual")).state).toBe("processing");
						await inspectionQueue({ info: vi.fn() } as unknown as LoggerPort).markIgnored(
							"inference-manual",
						);
					} finally {
						inference.resume();
					}
					expect(await pending).toEqual({ outcome: "lease_lost" });
					expect(await workRow("inference-manual")).toMatchObject({
						state: "rejected",
						decision_reason: "manual_override",
						lease_token: null,
					});
					await noOperationalWrites("inference-manual");
					expect(inference.fetch).toHaveBeenCalledTimes(2);
				});
				it("accepts only the takeover owner when the first inference outlives its lease", async () => {
					await repository().capture(
						makeSource({ messageId: "inference-takeover", textBody: text }),
					);
					const inference = pausedInference();
					const pending = processing(inference.fetch, secondClient).process.execute(
						new AbortController().signal,
					);
					try {
						await inference.waiting;
						await expire("inference-takeover");
						expect(
							await processing(immediateInference()).process.execute(new AbortController().signal),
						).toEqual({ outcome: "accepted" });
					} finally {
						inference.resume();
					}
					expect(await pending).toEqual({ outcome: "lease_lost" });
					expect(await workRow("inference-takeover")).toMatchObject({
						state: "accepted",
						attempt_count: 2,
						lease_token: null,
					});
					expect(await operationRows("inference-takeover")).toHaveLength(1);
					expect(await client`SELECT * FROM mess_meal_location_details`).toMatchObject([
						{
							meal_date: date,
							meal_slot: "lunch",
							hostel_batches: ["ALL_BATCHES"],
							source_message_id: "inference-takeover",
						},
					]);
				});
				it.each([
					[1000, "stale_source"],
					[2000, "equal_timestamp_conflict"],
				] as const)(
					"rejects a late source at offset %i after newer accepted inference without a partial audit",
					async (offset, reason) => {
						await repository().capture(
							makeSource({
								messageId: "newer-inference",
								textBody: text,
								originalCreatedAt: new Date(activatedAt.getTime() + 2000),
							}),
						);
						expect(
							await processing(immediateInference()).process.execute(new AbortController().signal),
						).toEqual({ outcome: "accepted" });
						await repository(secondClient).capture(
							makeSource({
								messageId: "late-inference",
								textBody: text,
								originalCreatedAt: new Date(activatedAt.getTime() + offset),
							}),
						);
						expect(
							await processing(immediateInference(), secondClient).process.execute(
								new AbortController().signal,
							),
						).toMatchObject({ outcome: "rejected", reason });
						await noOperationalWrites("late-inference");
						expect(await client`SELECT source_message_id FROM mess_meal_location_details`).toEqual([
							{ source_message_id: "newer-inference" },
						]);
					},
				);
				it("restarts only admitted unfinished inference while preserving activation and terminal decisions", async () => {
					await repository().capture(
						makeSource({ messageId: "terminal-accepted", textBody: text }),
					);
					expect(
						await processing(immediateInference()).process.execute(new AbortController().signal),
					).toEqual({ outcome: "accepted" });
					await repository().capture(
						makeSource({ messageId: "terminal-rejected", textBody: text }),
					);
					const rejected = (await repository().claimNext())!;
					await repository().reject(rejected.lease, {
						outcome: "rejected",
						reason: "ambiguous_content",
						detail: "Unclear source",
					});
					await client`INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, text_body) VALUES ('unadmitted-backlog', '123@lid', 'lid', 'text', 'historical')`;
					await repository().capture(
						makeSource({
							messageId: "unfinished",
							textBody: text,
							originalCreatedAt: new Date(activatedAt.getTime() + 3000),
						}),
					);
					const abandoned = (await repository().claimNext())!;
					await expire("unfinished");
					const terminal =
						await client`SELECT * FROM food_announcement_ingestions WHERE message_id LIKE 'terminal-%' ORDER BY message_id`;
					const restarted = repository(secondClient);
					expect(await restarted.initialize(groupJid)).toEqual(activatedAt);
					expect(
						await restarted.capture(
							makeSource({ messageId: "unadmitted-backlog", textBody: text }),
						),
					).toBe("duplicate");
					expect(
						await processing(immediateInference(), secondClient).process.execute(
							new AbortController().signal,
						),
					).toEqual({ outcome: "accepted" });
					expect(await workRow("unfinished")).toMatchObject({
						state: "accepted",
						attempt_count: 2,
					});
					expect(await repository().accept(abandoned.lease, commit())).toEqual({
						outcome: "lease_lost",
					});
					expect(
						await client`SELECT * FROM food_announcement_ingestions WHERE message_id LIKE 'terminal-%' ORDER BY message_id`,
					).toEqual(terminal);
					expect(await countWorkRows("unadmitted-backlog")).toBe(0);
					expect(await restarted.claimNext()).toBeNull();
				});
				it("recovers admitted work, independently verifies it and writes one terminal audit", async () => {
					const repo = repository();
					await repo.capture(makeSource({ messageId: "worker-accept", textBody: text }));
					const expired = await repo.claimNext();
					await expire(expired!.lease.messageId);
					const replies = [
						extraction(),
						{
							verdict: "accept",
							completeCoverage: true,
							missingFields: [],
							conflictingFields: [],
							unsupportedClauses: [],
						},
					];
					const fetch = vi.fn(async () => completion(replies.shift()));
					const running = worker(fetch);
					running.start();
					try {
						await vi.waitFor(
							async () => expect((await workRow("worker-accept")).state).toBe("accepted"),
							{ timeout: 5_000 },
						);
					} finally {
						await running.stop();
					}
					expect(fetch).toHaveBeenCalledTimes(2);
					expect(await workRow("worker-accept")).toMatchObject({
						state: "accepted",
						attempt_count: 2,
						lease_token: null,
						model: "test-model",
					});
					expect(await client`SELECT * FROM mess_meal_location_details`).toMatchObject([
						{
							meal_date: date,
							meal_slot: "lunch",
							hostel_batches: ["ALL_BATCHES"],
							source_message_id: "worker-accept",
						},
					]);
					expect(await operationRows("worker-accept")).toHaveLength(1);
					expect(await repo.accept(expired!.lease, commit())).toEqual({ outcome: "lease_lost" });
					expect(
						await repo.capture(makeSource({ messageId: "worker-accept", textBody: text })),
					).toBe("duplicate");
				});
				it("disables SDK retries and durably schedules a single transient worker attempt", async () => {
					await repository().capture(
						makeSource({ messageId: "worker-rate-limit", textBody: text }),
					);
					const fetch = vi.fn(
						async () =>
							new Response(JSON.stringify({ error: { message: "offline limit" } }), {
								status: 429,
								headers: { "retry-after": "20", "content-type": "application/json" },
							}),
					);
					const running = worker(fetch);
					running.start();
					try {
						await vi.waitFor(
							async () =>
								expect((await workRow("worker-rate-limit")).decision_reason).toBe(
									"assessment_failure",
								),
							{ timeout: 5_000 },
						);
					} finally {
						await running.stop();
					}
					expect(fetch).toHaveBeenCalledTimes(1);
					expect(await workRow("worker-rate-limit")).toMatchObject({
						state: "queued",
						attempt_count: 1,
						lease_token: null,
					});
					expect(Number((await workRow("worker-rate-limit")).retry_seconds)).toBeGreaterThan(15);
					expect(await operationRows("worker-rate-limit")).toHaveLength(0);
					expect(await client`SELECT * FROM mess_meal_location_details`).toHaveLength(0);
				});
			});

			function commit(): ValidatedFoodCommit {
				return {
					candidate: {
						kind: "operational_announcement",
						announcement: {
							locations: [
								{ mealDate: date, mealSlot: "dinner", hostelBatches: ["all"], collegeBatches: [] },
							],
							timings: [
								{
									mealDate: date,
									mealSlot: "dinner",
									targetVendor: null,
									extendedTimings: "until 9 PM",
								},
							],
							changes: [],
							swaps: [],
						},
					},
					evidence: [
						{
							fieldPath: "/announcement/locations/0/mealDate",
							rawValue: "Today",
							location: { kind: "text", start: 0, end: 5 },
							clause: "Today's dinner is at the hostel.",
						},
					],
					verification: {
						verdict: "accept",
						completeCoverage: true,
						missingFields: [],
						conflictingFields: [],
						unsupportedClauses: [],
					},
					rawExtraction: '{"complete":true}',
					rawVerification: '{"verdict":"accept"}',
					model: "offline-fixture-model",
					promptVersion: "v1",
					resolvedSwaps: [],
				};
			}
			async function claim(id = "automatic") {
				await repository().capture(makeSource({ messageId: id }));
				return (await repository().claimNext())!.lease;
			}
			async function operationRows(id: string) {
				return client`SELECT * FROM mess_ingestion_operation_audits WHERE source_message_id = ${id}`;
			}
			async function noOperationalWrites(id: string) {
				expect(await operationRows(id)).toHaveLength(0);
				for (const table of [
					"mess_meals",
					"mess_meal_location_details",
					"mess_meal_timing_extensions",
					"mess_meal_changes",
				])
					expect(
						await client.unsafe(`SELECT * FROM ${table} WHERE source_message_id = $1`, [id]),
					).toHaveLength(0);
			}
			it("commits exactly one concurrent acceptance with all evidence and operational rows", async () => {
				const lease = await claim();
				const value = commit();
				const decisions = await Promise.all([
					repository().accept({ ...lease, expiresAt: new Date(0), attempt: 99 }, value),
					repository(secondClient).accept(lease, value),
				]);
				expect(decisions.filter((d) => d.outcome === "accepted")).toHaveLength(1);
				expect(decisions.filter((d) => d.outcome === "lease_lost")).toHaveLength(1);
				expect(await operationRows(lease.messageId)).toHaveLength(1);
				expect(await client`SELECT * FROM mess_meal_location_details`).toHaveLength(1);
				expect(await client`SELECT * FROM mess_meal_timing_extensions`).toHaveLength(1);
				expect(await workRow(lease.messageId)).toMatchObject({
					state: "accepted",
					lease_token: null,
					candidate: value.candidate,
					evidence: value.evidence,
					verification: value.verification,
					raw_extraction: value.rawExtraction,
					raw_verification: value.rawVerification,
					model: value.model,
					prompt_version: value.promptVersion,
					recognized_type: "operational_announcement",
				});
				expect(
					Number.isFinite(new Date((await workRow(lease.messageId)).completed_at).getTime()),
				).toBe(true);
				expect(
					(await operationRows(lease.messageId))[0].extraction_evidence.assessment,
				).toMatchObject(value);
				expect(
					(await client`SELECT status FROM whatsapp_group_food_announcements_messages`)[0].status,
				).toBe("processed");
			});
			it("atomically persists canonical menu and original correction evidence", async () => {
				const lease = await claim();
				const menu = {
					vendor: "tcb" as const,
					meals: Array.from({ length: 7 }, (_, i) =>
						(["breakfast", "lunch", "dinner"] as const).map((mealSlot) => ({
							mealDate: `2026-11-${String(4 + i).padStart(2, "0")}`,
							mealSlot,
							items: ["Masala Frycrums/Papad"],
						})),
					).flat(),
				};
				const extraction = MenuDishNormalizer.normalize(menu);
				const value = {
					...commit(),
					candidate: {
						kind: "weekly_menu" as const,
						menu,
						dateRange: { start: date, end: "2026-11-10" },
					},
					menuExtraction: extraction,
				};
				expect(await repository().accept(lease, value)).toEqual({ outcome: "accepted" });
				const rows = await client`SELECT items FROM mess_meals`;
				expect(rows).toHaveLength(21);
				expect(rows.every((row) => row.items[0] === "Masala Fryums/Papad")).toBe(true);
				const audit = (await operationRows(lease.messageId))[0];
				expect(audit.extraction_evidence.extractionAudit).toEqual({
					...extraction,
					reviewCorrections: [],
				});
				expect(audit.corrections.initial).toHaveLength(21);
				expect((await workRow(lease.messageId)).corrections).toEqual(extraction.corrections);
			});
			it("persists a rejection and typed source diagnostics once without operational writes", async () => {
				const lease = await claim();
				const value = commit();
				const decision = {
					outcome: "rejected" as const,
					reason: "ambiguous_content",
					detail: "Conflicting clauses",
					diagnostics: {
						rawExtraction: "malformed raw {",
						rawVerification: "not JSON",
						model: value.model,
						promptVersion: value.promptVersion,
						recognizedType: value.candidate.kind,
						candidate: value.candidate,
						evidence: value.evidence,
						verification: value.verification,
					},
				};
				expect(await repository().reject(lease, decision)).toEqual({
					outcome: "rejected",
					reason: decision.reason,
					detail: decision.detail,
				});
				expect(await repository().accept(lease, value)).toEqual({ outcome: "lease_lost" });
				expect(await repository().reject(lease, { ...decision, reason: "replacement" })).toEqual({
					outcome: "lease_lost",
				});
				expect(await repository().claimNext()).toBeNull();
				expect(
					(
						await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = ${lease.messageId}`
					)[0].status,
				).toBe("ignored");
				expect(await workRow(lease.messageId)).toMatchObject({
					state: "rejected",
					decision_reason: "ambiguous_content",
					raw_extraction: "malformed raw {",
					raw_verification: "not JSON",
					model: value.model,
					prompt_version: "v1",
					recognized_type: value.candidate.kind,
					candidate: value.candidate,
					evidence: value.evidence,
					verification: value.verification,
				});
				await noOperationalWrites(lease.messageId);
			});
			it("inspects recognized type and raw rejection responses even when no candidate exists", async () => {
				const lease = await claim();
				await repository().reject(lease, {
					outcome: "rejected",
					reason: "ambiguous_content",
					detail: "Verifier found unsupported clauses",
					diagnostics: {
						recognizedType: "operational_announcement",
						model: "fixture-model",
						promptVersion: "v1",
						rawExtraction: "unparseable extraction {",
						rawVerification: "unparseable verification [",
					},
				});
				const inspection = await inspectionQueue({
					debug: vi.fn(),
				} as unknown as LoggerPort).getIngestionAudit(lease.messageId);
				expect(inspection?.automatic?.recognizedType).toBe("operational_announcement");
				expect(inspection?.automatic).toMatchObject({
					state: "rejected",
					candidate: null,
					rawExtraction: "unparseable extraction {",
					rawVerification: "unparseable verification [",
					model: "fixture-model",
					promptVersion: "v1",
				});
				expect(inspection?.operations).toHaveLength(0);
			});

			it("serializes an acceptance racing a rejection into exactly one immutable decision", async () => {
				const lease = await claim();
				const decisions = await Promise.all([
					repository().accept(lease, commit()),
					repository(secondClient).reject(lease, {
						outcome: "rejected",
						reason: "ambiguous_content",
						detail: "No full agreement",
					}),
				]);
				expect(decisions.filter((d) => d.outcome === "lease_lost")).toHaveLength(1);
				const final = await workRow(lease.messageId);
				expect(["accepted", "rejected"]).toContain(final.state);
				expect(await operationRows(lease.messageId)).toHaveLength(
					final.state === "accepted" ? 1 : 0,
				);
				expect(
					await repository().reject(lease, {
						outcome: "rejected",
						reason: "replacement",
						detail: "late",
					}),
				).toEqual({ outcome: "lease_lost" });
				expect((await workRow(lease.messageId)).state).toBe(final.state);
			});

			it.each(["accept", "reject"] as const)(
				"fences %s after expiry and replacement without changing the new owner",
				async (action) => {
					const lease = await claim();
					const run = () =>
						action === "accept"
							? repository().accept(lease, commit())
							: repository().reject(lease, { outcome: "rejected", reason: "old", detail: "old" });
					await expire(lease.messageId);
					expect(await run()).toEqual({ outcome: "lease_lost" });
					const fresh = (await repository().claimNext())!.lease;
					expect(await run()).toEqual({ outcome: "lease_lost" });
					expect(await workRow(lease.messageId)).toMatchObject({
						state: "processing",
						lease_token: fresh.token,
						decision_reason: null,
					});
					await noOperationalWrites(lease.messageId);
				},
			);
			it.each(["accept", "reject"] as const)(
				"returns lease_lost for missing %s work",
				async (action) => {
					const lease = {
						messageId: "missing",
						token: randomUUID(),
						expiresAt: new Date(),
						attempt: 1,
					};
					expect(
						await (action === "accept"
							? repository().accept(lease, commit())
							: repository().reject(lease, {
									outcome: "rejected",
									reason: "absent",
									detail: "absent",
								})),
					).toEqual({ outcome: "lease_lost" });
				},
			);
			it.each(["accept", "reject"] as const)(
				"rechecks database expiry after %s waits on a row lock",
				async (action) => {
					const lease = await claim();
					await client`UPDATE food_announcement_ingestions SET lease_expires_at = clock_timestamp() + interval '1 second' WHERE message_id = ${lease.messageId}`;
					const [worker] = await secondClient`SELECT pg_backend_pid() AS pid`;
					let pending: Promise<unknown> | undefined;
					await client.begin(async (lock) => {
						await lock`SELECT message_id FROM food_announcement_ingestions WHERE message_id = ${lease.messageId} FOR UPDATE`;
						pending =
							action === "accept"
								? repository(secondClient).accept(lease, commit())
								: repository(secondClient).reject(lease, {
										outcome: "rejected",
										reason: "late",
										detail: "late",
									});
						await waitForLock(worker.pid);
						await lock`SELECT pg_sleep(greatest(0, extract(epoch FROM (lease_expires_at - clock_timestamp()))) + 0.02) FROM food_announcement_ingestions WHERE message_id = ${lease.messageId}`;
					});
					expect(await pending).toEqual({ outcome: "lease_lost" });
					expect((await workRow(lease.messageId)).state).toBe("processing");
					await noOperationalWrites(lease.messageId);
				},
			);
			async function waitForLock(pid: number) {
				for (let poll = 0; poll < 200; poll++) {
					const [row] =
						await admin`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${pid}`;
					if (row?.wait_event_type === "Lock") return;
				}
				throw new Error("Worker did not wait for database lock");
			}
			it("acquires advisory lock before lease row and rechecks expiry after advisory wait", async () => {
				const lease = await claim();
				await client`UPDATE food_announcement_ingestions SET lease_expires_at = clock_timestamp() + interval '1 second' WHERE message_id = ${lease.messageId}`;
				const [worker] = await secondClient`SELECT pg_backend_pid() AS pid`;
				let pending: Promise<unknown> | undefined;
				await client.begin(async (lock) => {
					await lock`SELECT pg_advisory_xact_lock(730201, 1)`;
					pending = repository(secondClient).accept(lease, commit());
					await waitForLock(worker.pid);
					// A finalizer holding the lease row before its advisory wait would make this NOWAIT fail.
					await lock`SELECT message_id FROM food_announcement_ingestions WHERE message_id = ${lease.messageId} FOR UPDATE NOWAIT`;
					await lock`SELECT pg_sleep(greatest(0, extract(epoch FROM (lease_expires_at - clock_timestamp()))) + 0.02) FROM food_announcement_ingestions WHERE message_id = ${lease.messageId}`;
				});
				expect(await pending).toEqual({ outcome: "lease_lost" });
				await noOperationalWrites(lease.messageId);
			});
			it("cannot commit after a simulated manual ignore invalidates the lease under the shared lock", async () => {
				const lease = await claim();
				const [worker] = await secondClient`SELECT pg_backend_pid() AS pid`;
				let pending: Promise<unknown> | undefined;
				await client.begin(async (lock) => {
					await lock`SELECT pg_advisory_xact_lock(730201, 1)`;
					pending = repository(secondClient).accept(lease, commit());
					await waitForLock(worker.pid);
					await lock`UPDATE whatsapp_group_food_announcements_messages SET status = 'ignored' WHERE id = ${lease.messageId}`;
					await lock`UPDATE food_announcement_ingestions SET state = 'rejected', decision_reason = 'manual_override', decision_detail = 'Manually ignored', completed_at = clock_timestamp(), lease_token = NULL, lease_expires_at = NULL WHERE message_id = ${lease.messageId}`;
				});
				expect(await pending).toEqual({ outcome: "lease_lost" });
				expect(await workRow(lease.messageId)).toMatchObject({
					state: "rejected",
					decision_reason: "manual_override",
				});
				await noOperationalWrites(lease.messageId);
			});
			it("rejects a nonpending staging source even if its lease was not yet invalidated", async () => {
				const lease = await claim();
				await client`UPDATE whatsapp_group_food_announcements_messages SET status = 'ignored' WHERE id = ${lease.messageId}`;
				expect(await repository().accept(lease, commit())).toMatchObject({
					outcome: "rejected",
					reason: "staging_conflict",
				});
				expect((await workRow(lease.messageId)).state).toBe("rejected");
				await noOperationalWrites(lease.messageId);
			});
			it("rejects changed swap snapshots and retains assessment diagnostics", async () => {
				const lease = await claim();
				await repository().capture(
					makeSource({ messageId: "prior-menu", originalCreatedAt: activatedAt }),
				);
				await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Changed source'], 'prior-menu'), ('2026-11-05', 'dinner', 'tcb', ARRAY['Target'], 'prior-menu')`;
				const base = commit();
				const value: ValidatedFoodCommit = {
					...base,
					candidate: {
						kind: "operational_announcement",
						announcement: {
							locations: [],
							timings: [],
							changes: [],
							swaps: [
								{
									sourceMealDate: date,
									sourceMealSlot: "lunch",
									targetMealDate: "2026-11-05",
									targetMealSlot: "dinner",
									targetVendor: "tcb",
								},
							],
						},
					},
					resolvedSwaps: [
						{
							sourceMealDate: date,
							sourceMealSlot: "lunch",
							targetMealDate: "2026-11-05",
							targetMealSlot: "dinner",
							vendor: "tcb",
							newItems: ["Original source"],
							previousItems: ["Target"],
						},
					],
				};
				expect(await repository().accept(lease, value)).toMatchObject({
					outcome: "rejected",
					reason: "changed_prerequisite",
				});
				expect(
					(
						await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = ${lease.messageId}`
					)[0].status,
				).toBe("ignored");
				expect(await workRow(lease.messageId)).toMatchObject({
					state: "rejected",
					candidate: value.candidate,
					raw_extraction: value.rawExtraction,
					model: value.model,
				});
				expect(
					(await client`SELECT items FROM mess_meals WHERE meal_date = '2026-11-05'`)[0].items,
				).toEqual(["Target"]);
				await noOperationalWrites(lease.messageId);
			});
			it.each([
				["accept", "processed"],
				["accept", "ignored"],
				["reject", "processed"],
				["reject", "ignored"],
			] as const)(
				"preserves manually %s/%s staging during automatic rejection",
				async (action, status) => {
					const lease = await claim();
					await client`UPDATE whatsapp_group_food_announcements_messages SET status = ${status}, processed_at = '2026-11-02T09:00:00Z' WHERE id = ${lease.messageId}`;
					const [before] =
						await client`SELECT status, processed_at FROM whatsapp_group_food_announcements_messages WHERE id = ${lease.messageId}`;
					const result =
						action === "accept"
							? await repository().accept(lease, commit())
							: await repository().reject(lease, {
									outcome: "rejected",
									reason: "ambiguous_content",
									detail: "Unclear instruction",
								});
					expect(result.outcome).toBe("rejected");
					expect(
						(
							await client`SELECT status, processed_at FROM whatsapp_group_food_announcements_messages WHERE id = ${lease.messageId}`
						)[0],
					).toEqual(before);
					await noOperationalWrites(lease.messageId);
				},
			);
			it.each([
				["accept", "staging"],
				["accept", "decision"],
				["reject", "staging"],
				["reject", "decision"],
			] as const)(
				"rolls back paired rejection updates when %s/%s persistence fails",
				async (action, phase) => {
					const lease = await claim();
					const table =
						phase === "staging"
							? "whatsapp_group_food_announcements_messages"
							: "food_announcement_ingestions";
					const predicate =
						phase === "staging" ? "NEW.status = 'ignored'" : "NEW.state = 'rejected'";
					await client.unsafe(
						`CREATE FUNCTION fail_rejection() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'paired rejection failed'; END IF; RETURN NEW; END $$`,
					);
					await client.unsafe(
						`CREATE TRIGGER fail_rejection BEFORE UPDATE ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_rejection()`,
					);
					try {
						const value: ValidatedFoodCommit = {
							...commit(),
							candidate: {
								kind: "operational_announcement",
								announcement: {
									locations: [],
									timings: [],
									changes: [],
									swaps: [
										{
											sourceMealDate: date,
											sourceMealSlot: "lunch",
											targetMealDate: "2026-11-05",
											targetMealSlot: "dinner",
											targetVendor: "tcb",
										},
									],
								},
							},
						};
						const result =
							action === "accept"
								? repository().accept(lease, value)
								: repository().reject(lease, {
										outcome: "rejected",
										reason: "ambiguous_content",
										detail: "Unclear instruction",
										diagnostics: { rawExtraction: "rejected raw" },
									});
						await expect(result).rejects.toThrow();
						expect(await workRow(lease.messageId)).toMatchObject({
							state: "processing",
							lease_token: lease.token,
							decision_reason: null,
							raw_extraction: null,
						});
						expect(
							(
								await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = ${lease.messageId}`
							)[0].status,
						).toBe("pending");
						await noOperationalWrites(lease.messageId);
					} finally {
						await client.unsafe(`DROP TRIGGER fail_rejection ON ${table}`);
						await client.unsafe("DROP FUNCTION fail_rejection()");
					}
				},
			);

			it("rolls back operational writes, audit and staging when final accepted persistence throws", async () => {
				const lease = await claim();
				await client.unsafe(
					"CREATE FUNCTION fail_accept() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.state = 'accepted' THEN RAISE EXCEPTION 'decision failed'; END IF; RETURN NEW; END $$",
				);
				await client.unsafe(
					"CREATE TRIGGER fail_accept BEFORE UPDATE ON food_announcement_ingestions FOR EACH ROW EXECUTE FUNCTION fail_accept()",
				);
				try {
					await expect(repository().accept(lease, commit())).rejects.toThrow();
					await noOperationalWrites(lease.messageId);
					expect(await workRow(lease.messageId)).toMatchObject({
						state: "processing",
						lease_token: lease.token,
					});
					expect(
						(await client`SELECT status FROM whatsapp_group_food_announcements_messages`)[0].status,
					).toBe("pending");
					const outcome = await repository().fail(lease, {
						code: "database_error",
						detail: "commit rolled back",
						retriable: true,
						diagnostics: { rawExtraction: "malformed {", model: "fixture" },
					});
					expect(outcome.outcome).toBe("retry_scheduled");
					expect(await workRow(lease.messageId)).toMatchObject({
						state: "queued",
						decision_reason: "database_error",
						raw_extraction: "malformed {",
						model: "fixture",
					});
				} finally {
					await client.unsafe("DROP TRIGGER fail_accept ON food_announcement_ingestions");
					await client.unsafe("DROP FUNCTION fail_accept()");
				}
			});
		});

		describe("manual override and audited restoration", () => {
			const date = "2026-11-04";
			const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as LoggerPort;
			function components(connection = client) {
				const db = drizzle(connection);
				const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
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
				return {
					committer,
					queue: new PostgresStagingQueue(db, logger, guard, audit),
					rollback: new PostgresMealRollback(
						db,
						logger,
						guard,
						new PostgresMessAuditRestorer(audit),
						audit,
					),
					automatic: new PostgresFoodFinalizer(db, guard, committer),
				};
			}
			async function stage(id: string, offset = 1000) {
				await createRepository().capture(
					makeSource({
						messageId: id,
						originalCreatedAt: new Date(activatedAt.getTime() + offset),
					}),
				);
			}
			async function menu(id: string, items = [id], offset = 1000) {
				await stage(id, offset);
				await components().committer.atomicCommit(id, {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items }],
				});
			}
			async function meals() {
				return client`SELECT * FROM mess_meals ORDER BY meal_date, meal_slot, vendor`;
			}
			function acceptedCommit(): ValidatedFoodCommit {
				return {
					candidate: {
						kind: "operational_announcement",
						announcement: {
							locations: [
								{ mealDate: date, mealSlot: "dinner", hostelBatches: ["all"], collegeBatches: [] },
							],
							timings: [],
							changes: [],
							swaps: [],
						},
					},
					evidence: [],
					verification: {
						verdict: "accept",
						completeCoverage: true,
						missingFields: [],
						conflictingFields: [],
						unsupportedClauses: [],
					},
					rawExtraction: "{}",
					rawVerification: "{}",
					model: "fixture",
					promptVersion: "fixture",
					resolvedSwaps: [],
				};
			}
			it.each(["ignore", "commit"])(
				"fences an active automatic lease after manual %s",
				async (action) => {
					await stage("active");
					const lease = (await createQueue().claimNext())!.lease;
					if (action === "ignore") await components().queue.markIgnored("active");
					else
						await components().committer.atomicCommit("active", {
							meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Reviewed"] }],
						});
					expect(await workRow("active")).toMatchObject({
						state: "rejected",
						decision_reason: "manual_override",
						lease_token: null,
						lease_expires_at: null,
					});
					expect(await components().automatic.accept(lease, acceptedCommit())).toEqual({
						outcome: "lease_lost",
					});
					expect(await client`SELECT * FROM mess_meal_location_details`).toHaveLength(0);
					expect(await createQueue().claimNext()).toBeNull();
				},
			);
			it("restores an audited overwrite with exact original provenance and immutable accepted decision", async () => {
				await menu("original", ["Original menu"]);
				const original = await meals();
				await stage("overwrite", 2000);
				const lease = (await createQueue().claimNext())!.lease;
				const commit = {
					...acceptedCommit(),
					candidate: {
						kind: "weekly_menu",
						menu: {
							vendor: "tcb",
							meals: [{ mealDate: date, mealSlot: "lunch", items: ["Replacement"] }],
						},
						dateRange: { start: date, end: date },
					},
				} as ValidatedFoodCommit;
				await components().automatic.accept(lease, commit);
				const decision = await workRow("overwrite");
				await components().rollback.atomicUndo("overwrite");
				expect(await meals()).toEqual(original);
				expect(await workRow("overwrite")).toEqual(decision);
				expect(decision.state).toBe("accepted");
				expect(await createQueue().claimNext()).toBeNull();
				const inspection = await components().queue.getIngestionAudit("overwrite");
				expect(inspection?.operations[0]).toMatchObject({ reversalReason: "manual_undo" });
				expect(inspection?.operations[0].reversedAt).toBeInstanceOf(Date);
			});
			it.each(["restore", "later-owner"])(
				"stamps swap target and preserves complete endpoint provenance for %s",
				async (action) => {
					await menu("source", ["Source"]);
					await stage("target", 1500);
					await components().committer.atomicCommit("target", {
						meals: [
							{ mealDate: "2026-11-05", mealSlot: "dinner", vendor: "tcb", items: ["Target"] },
						],
					});
					const original = await meals();
					await stage("swap", 2000);
					const stale = (await createQueue().claimNext())!.lease;
					const swap = {
						sourceMealDate: date,
						sourceMealSlot: "lunch" as const,
						targetMealDate: "2026-11-05",
						targetMealSlot: "dinner" as const,
						targetVendor: "tcb" as const,
					};
					await components().committer.atomicCommitComposite({
						messageId: "swap",
						composite: { mealDate: date, mealSwaps: [swap] },
						resolvedSwaps: [
							{ ...swap, vendor: "tcb", newItems: ["Source"], previousItems: ["Target"] },
						],
					});
					expect((await meals())[1]).toMatchObject({
						source_message_id: "swap",
						items: ["Source"],
					});
					const audit = await components().queue.getIngestionAudit("swap");
					expect(audit?.operations[0].beforeImages).toMatchObject({
						["menu/2026-11-05/dinner/tcb"]: [{ sourceMessageId: "target", items: ["Target"] }],
					});
					expect(audit?.operations[0].afterImages).toMatchObject({
						["menu/2026-11-04/lunch/tcb"]: [{ sourceMessageId: "source", items: ["Source"] }],
						["menu/2026-11-05/dinner/tcb"]: [{ sourceMessageId: "swap", items: ["Source"] }],
					});
					expect(await components().automatic.accept(stale, acceptedCommit())).toEqual({
						outcome: "lease_lost",
					});
					if (action === "later-owner") {
						await stage("later", 3000);
						await components().committer.atomicCommit("later", {
							meals: [
								{
									mealDate: "2026-11-05",
									mealSlot: "dinner",
									vendor: "tcb",
									items: ["Later owner"],
								},
							],
						});
						const later = await meals();
						await expect(components().rollback.atomicUndo("swap")).rejects.toThrow(
							/owner|after-image/i,
						);
						expect(await meals()).toEqual(later);
						expect(await client`SELECT * FROM mess_meal_changes`).toHaveLength(1);
						return;
					}
					await components().rollback.atomicUndo("swap");
					expect(await meals()).toEqual(original);
					expect(await client`SELECT * FROM mess_meal_changes`).toHaveLength(0);
				},
			);
			it("refuses entire audited undo when one current after-image changes", async () => {
				await menu("original");
				await stage("mixed", 2000);
				await components().committer.atomicCommit("mixed", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["New"] }],
					locationDetail: {
						mealDate: date,
						mealSlot: "dinner",
						hostelBatches: ["all"],
						collegeBatches: [],
					},
				});
				await client`UPDATE mess_meals SET source_message_id = 'later-owner'`;
				const before = await meals();
				await expect(components().rollback.atomicUndo("mixed")).rejects.toThrow(
					/changed|owner|after-image/i,
				);
				expect(await meals()).toEqual(before);
				expect(await client`SELECT * FROM mess_meal_location_details`).toHaveLength(1);
			});
			it.each(["later", null])("refuses legacy swap restore over %s ownership", async (owner) => {
				await stage("legacy");
				await client`INSERT INTO mess_meals (id,meal_date,meal_slot,vendor,items,source_message_id) VALUES (${randomUUID()},${date},'lunch','tcb',ARRAY['Later'],${owner})`;
				await client`INSERT INTO mess_meal_changes (id,meal_date,meal_slot,target_vendor,change_type,affected_item,original_item,source_message_id) VALUES (${randomUUID()},${date},'lunch','tcb','replacement','Legacy menu','["Old"]','legacy')`;
				await expect(components().rollback.atomicUndo("legacy")).rejects.toThrow(
					/owner|provenance/i,
				);
				expect((await meals())[0].items).toEqual(["Later"]);
			});
			it("preserves activation and terminal histories while reset disables outstanding jobs", async () => {
				await stage("accepted");
				const lease = (await createQueue().claimNext())!.lease;
				await components().automatic.accept(lease, acceptedCommit());
				await stage("rejected");
				await components().automatic.reject((await createQueue().claimNext())!.lease, {
					outcome: "rejected",
					reason: "ambiguous_content",
					detail: "preserve",
				});
				const accepted = await workRow("accepted"),
					rejected = await workRow("rejected");
				await stage("processing");
				const stale = (await createQueue().claimNext())!.lease;
				await stage("queued");
				await client`UPDATE food_announcement_ingestions SET raw_extraction = 'diagnostic' WHERE message_id = 'processing'`;
				await components().rollback.atomicReset();
				expect(await workRow("accepted")).toEqual(accepted);
				expect(await workRow("rejected")).toEqual(rejected);
				for (const id of ["processing", "queued"])
					expect(await workRow(id)).toMatchObject({
						state: "rejected",
						decision_reason: "manual_reset",
						lease_token: null,
						next_attempt_at: null,
					});
				expect((await workRow("processing")).raw_extraction).toBe("diagnostic");
				expect(await createRepository().initialize(groupJid)).toEqual(activatedAt);
				expect(await components().automatic.accept(stale, acceptedCommit())).toEqual({
					outcome: "lease_lost",
				});
				expect(await createQueue().claimNext()).toBeNull();
			});
			it("restores every audited operational before-image including row identities and provenance", async () => {
				await stage("old");
				const payload = {
					locationDetails: [
						{
							mealDate: date,
							mealSlot: "dinner" as const,
							hostelBatches: ["A"],
							collegeBatches: ["B"],
						},
					],
					timingExtensions: [
						{
							mealDate: date,
							mealSlot: "dinner" as const,
							targetVendor: "tcb" as const,
							extendedTimings: "8 PM",
						},
					],
					mealChanges: [
						{
							mealDate: date,
							mealSlot: "dinner" as const,
							targetVendor: "tcb" as const,
							changeType: "addition" as const,
							affectedItem: "Original",
						},
					],
				};
				await components().committer.atomicCommit("old", payload);
				const snapshot = async () => ({
					locations: await client`SELECT * FROM mess_meal_location_details ORDER BY id`,
					timings: await client`SELECT * FROM mess_meal_timing_extensions ORDER BY id`,
					changes: await client`SELECT * FROM mess_meal_changes ORDER BY id`,
				});
				const before = await snapshot();
				await stage("new", 2000);
				await components().committer.atomicCommit("new", {
					...payload,
					locationDetails: [{ ...payload.locationDetails[0], hostelBatches: ["New"] }],
					timingExtensions: [{ ...payload.timingExtensions[0], extendedTimings: "9 PM" }],
					mealChanges: [{ ...payload.mealChanges[0], affectedItem: "New" }],
				});
				await components().rollback.atomicUndo("new");
				expect(await snapshot()).toEqual(before);
			});
			it("retains surgical legacy deletion only for the current source owner", async () => {
				await stage("legacy");
				await client`INSERT INTO mess_meals(id,meal_date,meal_slot,vendor,items,source_message_id) VALUES (${randomUUID()},${date},'lunch','tcb',ARRAY['Legacy'],'legacy'), (${randomUUID()},${date},'dinner','tcb',ARRAY['Other'],'unrelated')`;
				await components().rollback.atomicUndo("legacy");
				expect(await meals()).toMatchObject([{ source_message_id: "unrelated", items: ["Other"] }]);
				expect(await workRow("legacy")).toMatchObject({
					state: "rejected",
					decision_reason: "manual_override",
				});
				expect(await createQueue().claimNext()).toBeNull();
			});
			it("preserves a permitted legacy swap target with original items and known provenance", async () => {
				await stage("legacy");
				const targetId = randomUUID();
				await client`INSERT INTO mess_meals(id,meal_date,meal_slot,vendor,items,source_message_id) VALUES (${targetId},${date},'lunch','tcb',ARRAY['Swapped'],'legacy'), (${randomUUID()},${date},'dinner','tcb',ARRAY['Created by operation'],'legacy'), (${randomUUID()},${date},'dinner','cheftalk_regular',ARRAY['Unrelated'],'other')`;
				const [target] = await client`SELECT * FROM mess_meals WHERE id = ${targetId}`;
				await client`INSERT INTO mess_meal_changes(id,meal_date,meal_slot,target_vendor,change_type,affected_item,original_item,source_message_id) VALUES (${randomUUID()},${date},'lunch','tcb','replacement','Legacy swap','["Original"]','legacy')`;
				await components().rollback.atomicUndo("legacy");
				expect(await client`SELECT * FROM mess_meals WHERE id = ${targetId}`).toEqual([
					{ ...target, items: ["Original"] },
				]);
				expect(await meals()).toHaveLength(2);
				expect(
					await client`SELECT * FROM mess_meals WHERE source_message_id = 'other'`,
				).toHaveLength(1);
				expect(
					await client`SELECT * FROM mess_meal_changes WHERE source_message_id = 'legacy'`,
				).toHaveLength(0);
				expect(await components().queue.getMessageById("legacy")).toMatchObject({
					status: "pending",
					processedAt: null,
				});
				expect(await workRow("legacy")).toMatchObject({
					state: "rejected",
					decision_reason: "manual_override",
				});
				expect(await createQueue().claimNext()).toBeNull();
			});

			it("rolls back the whole legacy undo on a corrupt swap backup", async () => {
				await stage("legacy");
				for (const [slot, backup] of [
					["lunch", '["Original"]'],
					["dinner", "[invalid"],
				]) {
					await client`INSERT INTO mess_meals(id,meal_date,meal_slot,vendor,items,source_message_id) VALUES (${randomUUID()},${date},${slot},'tcb',ARRAY['New'],'legacy')`;
					await client`INSERT INTO mess_meal_changes(id,meal_date,meal_slot,target_vendor,change_type,affected_item,original_item,source_message_id) VALUES (${randomUUID()},${date},${slot},'tcb','replacement','Legacy',${backup},'legacy')`;
				}
				const before = await meals();
				await expect(components().rollback.atomicUndo("legacy")).rejects.toThrow();
				expect(await meals()).toEqual(before);
				expect(await client`SELECT * FROM mess_meal_changes`).toHaveLength(2);
				expect((await workRow("legacy")).state).toBe("queued");
			});
			it.each(["ignore", "commit", "undo", "reset"])(
				"takes advisory lock before any work row lock for %s",
				async (action) => {
					await stage("lock-order");
					let release!: () => void;
					let held!: () => void;
					const holding = new Promise<void>((resolve) => {
						held = resolve;
					});
					const blocker = client.begin(async (tx) => {
						await tx`SELECT pg_advisory_xact_lock(730201,1)`;
						held();
						await new Promise<void>((resolve) => {
							release = resolve;
						});
					});
					await holding;
					const [backend] = await secondClient`SELECT pg_backend_pid() AS pid`;
					const ops = components(secondClient);
					const pending =
						action === "ignore"
							? ops.queue.markIgnored("lock-order")
							: action === "commit"
								? ops.committer.atomicCommit("lock-order", {})
								: action === "undo"
									? ops.rollback.atomicUndo("lock-order")
									: ops.rollback.atomicReset();
					try {
						await vi.waitFor(async () => {
							const [state] =
								await client`SELECT wait_event FROM pg_stat_activity WHERE pid = ${backend.pid}`;
							expect(state.wait_event).toBe("advisory");
						});
						await client.begin(async (tx) => {
							const rows =
								await tx`SELECT message_id FROM food_announcement_ingestions WHERE message_id = 'lock-order' FOR UPDATE NOWAIT`;
							expect(rows).toHaveLength(1);
						});
					} finally {
						release();
						await blocker;
						await pending;
					}
				},
			);

			it("keeps an original rejection immutable during manual commit, undo and ignore", async () => {
				await stage("rejected");
				await components().automatic.reject((await createQueue().claimNext())!.lease, {
					outcome: "rejected",
					reason: "ambiguous_content",
					detail: "original",
				});
				const decision = await workRow("rejected");
				await components().committer.atomicCommit("rejected", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Reviewed"] }],
				});
				await components().rollback.atomicUndo("rejected");
				await components().queue.markIgnored("rejected");
				expect(await workRow("rejected")).toEqual(decision);
				expect(await createQueue().claimNext()).toBeNull();
			});
		});

		describe("shared atomic commits", () => {
			const date = "2026-11-04";
			const logger = { debug: vi.fn(), info: vi.fn() } as unknown as LoggerPort;
			function committer() {
				const audit = new PostgresMessOperationAudit(new PostgresMessProvenance());
				return new PostgresMealCommitter(
					drizzle(client),
					logger,
					new PostgresOperationalWriter(),
					new PostgresSwapWriter(),
					new PostgresMessWriteGuard(audit),
					audit,
					new PostgresMessCommitPreparation(),
				);
			}
			async function stage(id: string) {
				await createRepository().capture(makeSource({ messageId: id }));
			}
			async function audits(id: string) {
				return client`SELECT * FROM mess_ingestion_operation_audits WHERE source_message_id = ${id}`;
			}
			it.each([null, undefined])(
				"preserves manual unspecified scope %s with one available vendor",
				async (targetVendor) => {
					await stage("manual-seed");
					await committer().atomicCommit("manual-seed", {
						vendor: "tcb",
						meals: [
							{ mealDate: date, mealSlot: "lunch", items: ["Source"] },
							{ mealDate: "2026-11-05", mealSlot: "dinner", items: ["Target"] },
						],
					});
					await createRepository().capture(
						makeSource({
							messageId: "manual-scope",
							originalCreatedAt: new Date(activatedAt.getTime() + 3000),
						}),
					);
					const swap = {
						sourceMealDate: date,
						sourceMealSlot: "lunch" as const,
						targetMealDate: "2026-11-05",
						targetMealSlot: "dinner" as const,
						targetVendor,
					};
					const resolved = {
						...swap,
						vendor: "tcb" as const,
						newItems: ["Source"],
						previousItems: ["Target"],
					};
					await committer().atomicCommitComposite({
						messageId: "manual-scope",
						composite: { mealDate: date, mealSwaps: [swap] },
						resolvedSwaps: [resolved],
					});
					expect(
						(await client`SELECT items FROM mess_meals WHERE meal_date = '2026-11-05'`)[0].items,
					).toEqual(["Source"]);
					const [audit] = await audits("manual-scope");
					expect(audit.review_evidence.swaps[0]).toEqual(JSON.parse(JSON.stringify(swap)));
				},
			);
			it.each([null, undefined])(
				"blocks missing manual unspecified-scope %s target atomically",
				async (targetVendor) => {
					await stage("manual-missing");
					await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Source'])`;
					const swap = {
						sourceMealDate: date,
						sourceMealSlot: "lunch" as const,
						targetMealDate: "2026-11-05",
						targetMealSlot: "dinner" as const,
						targetVendor,
					};
					await expect(
						committer().atomicCommitComposite({
							messageId: "manual-missing",
							composite: { mealDate: date, mealSwaps: [swap] },
							resolvedSwaps: [
								{ ...swap, vendor: "tcb", newItems: ["Source"], previousItems: ["Target"] },
							],
						}),
					).rejects.toThrow("changed_prerequisite");
					expect(await audits("manual-missing")).toHaveLength(0);
				},
			);
			it("normalizes edited dishes while retaining every extraction and correction stage", async () => {
				await stage("edited");
				const extracted = MenuDishNormalizer.normalize({
					vendor: "tcb",
					meals: [{ mealDate: date, mealSlot: "lunch", items: ["Frycrums"] }],
				});
				const reviewed = {
					vendor: "tcb" as const,
					meals: [{ mealDate: date, mealSlot: "lunch" as const, items: ["Masala Frycrums"] }],
				};
				await committer().atomicCommit({
					messageId: "edited",
					weeklyMenu: reviewed,
					extractionAudit: { ...extracted, reviewedMenu: reviewed, reviewCorrections: [] },
				});
				expect((await client`SELECT items FROM mess_meals`)[0].items).toEqual(["Masala Fryums"]);
				const [audit] = await audits("edited");
				expect(audit.extraction_evidence.extractionAudit).toEqual(
					JSON.parse(
						JSON.stringify({ ...extracted, reviewedMenu: reviewed, reviewCorrections: [] }),
					),
				);
				expect(audit.review_evidence.weeklyMenu).toEqual(reviewed);
				expect(audit.corrections).toMatchObject({
					initial: [{ originalItem: "Frycrums", correctedItem: "Fryums" }],
					review: [],
					commit: [{ originalItem: "Masala Frycrums", correctedItem: "Masala Fryums" }],
				});
				expect(audit.extraction_evidence.source.textBody).toBe("Today's dinner is at the hostel.");
				expect(await workRow("edited")).toMatchObject({
					state: "rejected",
					decision_reason: "manual_override",
				});
			});
			it("captures before-image including original row provenance on replacement", async () => {
				await stage("first");
				await committer().atomicCommit("first", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Original"] }],
				});
				await createRepository().capture(
					makeSource({
						messageId: "second",
						originalCreatedAt: new Date(activatedAt.getTime() + 2000),
					}),
				);
				await committer().atomicCommit("second", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Replaced"] }],
				});
				const [audit] = await audits("second");
				expect(audit.before_images["menu/2026-11-04/lunch/tcb"]).toMatchObject([
					{
						items: ["Original"],
						sourceMessageId: "first",
						id: expect.any(String),
						ingestedAt: expect.any(String),
					},
				]);
				expect(audit.after_images["menu/2026-11-04/lunch/tcb"]).toMatchObject([
					{ items: ["Replaced"], sourceMessageId: "second" },
				]);
			});
			it("rolls back menu replacement, mixed writes, audit and processed marker on last insert failure", async () => {
				await stage("mixed-original");
				await committer().atomicCommit("mixed-original", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Original dishes"] }],
				});
				await createRepository().capture(
					makeSource({
						messageId: "mixed",
						originalCreatedAt: new Date(activatedAt.getTime() + 2000),
					}),
				);
				await client.unsafe(
					"CREATE FUNCTION fail_mixed() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.source_message_id = 'mixed' THEN RAISE EXCEPTION 'last insert failed'; END IF; RETURN NEW; END $$",
				);
				await client.unsafe(
					"CREATE TRIGGER fail_mixed BEFORE INSERT ON mess_ingestion_operation_audits FOR EACH ROW EXECUTE FUNCTION fail_mixed()",
				);
				try {
					await expect(
						committer().atomicCommit("mixed", {
							meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Changed"] }],
							locationDetails: [
								{ mealDate: date, mealSlot: "lunch", hostelBatches: ["all"], collegeBatches: [] },
							],
							timingExtension: { mealDate: date, mealSlot: "lunch", extendedTimings: "until 3 PM" },
							mealChange: {
								mealDate: date,
								mealSlot: "lunch",
								targetVendor: "tcb",
								changeType: "addition",
								affectedItem: "Salad",
							},
						}),
					).rejects.toThrow();
					expect(
						await client`SELECT * FROM mess_meals WHERE source_message_id = 'mixed'`,
					).toHaveLength(0);
					for (const table of [
						"mess_meal_location_details",
						"mess_meal_timing_extensions",
						"mess_meal_changes",
					])
						expect(
							await client.unsafe(`SELECT * FROM ${table} WHERE source_message_id = 'mixed'`),
						).toHaveLength(0);
					expect(await audits("mixed")).toHaveLength(0);
					expect((await client`SELECT items, source_message_id FROM mess_meals`)[0]).toMatchObject({
						items: ["Original dishes"],
						source_message_id: "mixed-original",
					});
					expect(
						(
							await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = 'mixed'`
						)[0].status,
					).toBe("pending");
				} finally {
					await client.unsafe("DROP TRIGGER fail_mixed ON mess_ingestion_operation_audits");
					await client.unsafe("DROP FUNCTION fail_mixed()");
				}
			});
			it("rejects duplicate location keys and stale manual source before any write", async () => {
				await stage("duplicate");
				const loc = {
					mealDate: date,
					mealSlot: "lunch" as const,
					hostelBatches: ["all"],
					collegeBatches: [],
				};
				await expect(
					committer().atomicCommit("duplicate", { locationDetails: [loc, loc] }),
				).rejects.toThrow(/duplicate/i);
				expect(await client`SELECT * FROM mess_meal_location_details`).toHaveLength(0);
				await stage("newer");
				await committer().atomicCommit("newer", { locationDetail: loc });
				await createRepository().capture(
					makeSource({ messageId: "older", originalCreatedAt: activatedAt }),
				);
				await expect(committer().atomicCommit("older", { locationDetail: loc })).rejects.toThrow(
					/stale_source/,
				);
				expect(
					(await client`SELECT source_message_id FROM mess_meal_location_details`)[0]
						.source_message_id,
				).toBe("newer");
			});
			it("retains the initial correction when commit normalization is already idempotent", async () => {
				await stage("canonical");
				const extracted = MenuDishNormalizer.normalize({
					vendor: "tcb",
					meals: [{ mealDate: date, mealSlot: "lunch", items: ["Frycrums"] }],
				});
				await committer().atomicCommit({
					messageId: "canonical",
					weeklyMenu: extracted.menu,
					extractionAudit: { ...extracted, reviewCorrections: [] },
				});
				expect((await audits("canonical"))[0].corrections).toMatchObject({
					initial: [{ originalItem: "Frycrums", correctedItem: "Fryums" }],
					commit: [],
				});
			});
			it("uses the caller transaction so a later finalization failure rolls back every effect", async () => {
				await stage("outer");
				await expect(
					drizzle(client).transaction(async (tx) => {
						expect(
							await committer().commitWithinTransaction(tx, {
								messageId: "outer",
								mode: "automatic",
								payload: {
									meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Rice"] }],
								},
							}),
						).toEqual({ outcome: "accepted" });
						throw new Error("finalization failed");
					}),
				).rejects.toThrow("finalization failed");
				expect(await client`SELECT * FROM mess_meals`).toHaveLength(0);
				expect(await audits("outer")).toHaveLength(0);
				expect(
					(
						await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = 'outer'`
					)[0].status,
				).toBe("pending");
			});
			it("preserves swap source and target provenance and blocks a changed prerequisite", async () => {
				await stage("swap-source");
				await committer().atomicCommit("swap-source", {
					meals: [
						{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Source dishes"] },
						{ mealDate: "2026-11-05", mealSlot: "dinner", vendor: "tcb", items: ["Target dishes"] },
					],
				});
				const resolvedSwaps = [
					{
						sourceMealDate: date,
						sourceMealSlot: "lunch" as const,
						targetMealDate: "2026-11-05",
						targetMealSlot: "dinner" as const,
						vendor: "tcb" as const,
						newItems: ["Source dishes"],
						previousItems: ["Target dishes"],
					},
				];
				const composite = {
					mealDate: date,
					mealSwaps: [
						{
							sourceMealDate: date,
							sourceMealSlot: "lunch" as const,
							targetMealDate: "2026-11-05",
							targetMealSlot: "dinner" as const,
							targetVendor: "tcb" as const,
						},
					],
				};
				await createRepository().capture(
					makeSource({
						messageId: "swap",
						originalCreatedAt: new Date(activatedAt.getTime() + 2000),
					}),
				);
				await committer().atomicCommitComposite({ messageId: "swap", composite, resolvedSwaps });
				const [audit] = await audits("swap");
				await createRepository().capture(
					makeSource({
						messageId: "stale-after-swap",
						originalCreatedAt: new Date(activatedAt.getTime() + 1500),
					}),
				);
				await expect(
					committer().atomicCommit("stale-after-swap", {
						meals: [
							{
								mealDate: "2026-11-05",
								mealSlot: "dinner",
								vendor: "tcb",
								items: ["Stale target"],
							},
						],
					}),
				).rejects.toThrow(/stale_source/);
				expect(
					(await client`SELECT items FROM mess_meals WHERE meal_date = '2026-11-05'`)[0].items,
				).toEqual(["Source dishes"]);

				expect(audit.before_images["menu/2026-11-04/lunch/tcb"]).toMatchObject([
					{ sourceMessageId: "swap-source", items: ["Source dishes"] },
				]);
				expect(audit.before_images["menu/2026-11-05/dinner/tcb"]).toMatchObject([
					{ sourceMessageId: "swap-source", items: ["Target dishes"] },
				]);
				expect(
					(
						await client`SELECT original_item FROM mess_meal_changes WHERE source_message_id = 'swap'`
					)[0].original_item,
				).toBe('["Target dishes"]');
				await createRepository().capture(
					makeSource({
						messageId: "swap-again",
						originalCreatedAt: new Date(activatedAt.getTime() + 3000),
					}),
				);
				await expect(
					committer().atomicCommitComposite({ messageId: "swap-again", composite, resolvedSwaps }),
				).rejects.toThrow(/changed_prerequisite/);
				expect(await audits("swap-again")).toHaveLength(0);
			});

			it("normalizes historical swap dishes without changing raw source or resolver evidence", async () => {
				await stage("old-menu");
				await committer().atomicCommit("old-menu", {
					meals: [
						{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Rice"] },
						{
							mealDate: "2026-11-05",
							mealSlot: "dinner",
							vendor: "tcb",
							items: ["Original dinner"],
						},
					],
				});
				await client`UPDATE mess_meals SET items = ARRAY['Masala Frycrums'] WHERE meal_date = ${date}`;
				await createRepository().capture(
					makeSource({
						messageId: "historical-swap",
						originalCreatedAt: new Date(activatedAt.getTime() + 2000),
					}),
				);
				const resolvedSwaps = [
					{
						sourceMealDate: date,
						sourceMealSlot: "lunch" as const,
						targetMealDate: "2026-11-05",
						targetMealSlot: "dinner" as const,
						vendor: "tcb" as const,
						newItems: ["Masala Frycrums"],
						previousItems: ["Original dinner"],
					},
				];
				await committer().atomicCommitComposite({
					messageId: "historical-swap",
					composite: {
						mealDate: date,
						mealSwaps: [
							{
								sourceMealDate: date,
								sourceMealSlot: "lunch",
								targetMealDate: "2026-11-05",
								targetMealSlot: "dinner",
								targetVendor: "tcb",
							},
						],
					},
					resolvedSwaps,
				});
				expect(
					(await client`SELECT items FROM mess_meals WHERE meal_date = '2026-11-05'`)[0].items,
				).toEqual(["Masala Fryums"]);
				const [audit] = await audits("historical-swap");
				expect(audit.review_evidence.resolvedSwaps[0].newItems).toEqual(["Masala Frycrums"]);
				expect(audit.corrections.commit).toMatchObject([
					{
						mealDate: "2026-11-05",
						originalItem: "Masala Frycrums",
						correctedItem: "Masala Fryums",
					},
				]);
				expect(
					(await client`SELECT items FROM mess_meals WHERE meal_date = ${date}`)[0].items,
				).toEqual(["Masala Frycrums"]);
			});

			it("joins persisted automatic decision with independent manual operation history", async () => {
				await stage("inspection");
				await client`UPDATE food_announcement_ingestions SET state = 'rejected', completed_at = clock_timestamp(), decision_reason = 'unclear', raw_extraction = 'original model response', model = 'test-model' WHERE message_id = 'inspection'`;
				await committer().atomicCommit("inspection", {
					meals: [{ mealDate: date, mealSlot: "lunch", vendor: "tcb", items: ["Rice"] }],
				});
				const audit = await inspectionQueue(logger).getIngestionAudit("inspection");
				expect(audit).toMatchObject({
					automatic: {
						state: "rejected",
						decisionReason: "unclear",
						rawExtraction: "original model response",
						model: "test-model",
					},
					operations: [{ sourceMessageId: "inspection", mode: "manual" }],
				});
				expect(await inspectionQueue(logger).getIngestionAudit("absent")).toBeNull();
			});
		});

		describe("mess write ordering", () => {
			const fact = "menu/2026-11-04/lunch/tcb";
			const newerTime = new Date("2026-11-02T10:00:00Z");
			const olderTime = new Date("2026-11-02T09:00:00Z");

			async function auditedOwner(key: string, mode: "manual" | "automatic", at = newerTime) {
				await client`INSERT INTO mess_ingestion_operation_audits (source_message_id, original_created_at, mode, affected_fact_keys, before_images, after_images) VALUES ('newer', ${at.toISOString()}, ${mode}, ${[key]}, '{}', '{}')`;
			}

			async function attemptWrite(at = olderTime, keys = [fact]) {
				return drizzle(client).transaction(async (tx) => {
					const guard = new PostgresMessWriteGuard(
						new PostgresMessOperationAudit(new PostgresMessProvenance()),
					);
					await guard.lock(tx);
					const decision = await guard.checkOrder(
						tx,
						{ messageId: "older", originalCreatedAt: at },
						keys,
					);
					if (decision.outcome !== "accepted") return decision;
					await new PostgresOperationalWriter().commitMeals(tx, "older", {
						meals: [
							{ mealDate: "2026-11-04", mealSlot: "lunch", vendor: "tcb", items: ["Older menu"] },
						],
					});
					return { outcome: "accepted" };
				});
			}

			it.each(["manual", "automatic"] as const)(
				"rejects an older source over a newer %s menu without writes",
				async (mode) => {
					await auditedOwner(fact, mode);
					await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Newer menu'], 'newer')`;
					expect(await attemptWrite()).toMatchObject({
						outcome: "rejected",
						reason: "stale_source",
					});
					expect((await client`SELECT items FROM mess_meals`)[0].items).toEqual(["Newer menu"]);
				},
			);

			it("rejects a distinct equal-second source instead of ordering IDs", async () => {
				await auditedOwner(fact, "automatic");
				expect(await attemptWrite(newerTime)).toMatchObject({
					outcome: "rejected",
					reason: "equal_timestamp_conflict",
				});
			});
			it.each([
				["location/2026-11-04/lunch", "manual"],
				["timing/2026-11-04/lunch", "automatic"],
				["change/2026-11-04/lunch/tcb", "manual"],
			] as const)("rejects older cross-mode writes for %s", async (key, mode) => {
				await auditedOwner(key, mode);
				expect(await attemptWrite(olderTime, [key])).toMatchObject({
					outcome: "rejected",
					reason: "stale_source",
				});
			});

			it.each([null, "unknown"])(
				"rejects overwrite with unknown current-row provenance %s",
				async (owner) => {
					await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Unknown menu'], ${owner})`;
					expect(await attemptWrite()).toMatchObject({
						outcome: "rejected",
						reason: "unknown_provenance",
					});
					expect((await client`SELECT items FROM mess_meals`)[0].items).toEqual(["Unknown menu"]);
				},
			);
			it("allows an unaudited historical manual first write to an empty key", async () => {
				const guard = new PostgresMessWriteGuard(
					new PostgresMessOperationAudit(new PostgresMessProvenance()),
				);
				await drizzle(client).transaction(async (tx) => {
					await guard.lock(tx);
					expect(
						await guard.checkOrder(tx, { messageId: "legacy", originalCreatedAt: null }, [fact]),
					).toEqual({ outcome: "accepted" });
				});
			});

			async function order(keys: string[], at: Date | null = olderTime, messageId = "older") {
				const guard = new PostgresMessWriteGuard(
					new PostgresMessOperationAudit(new PostgresMessProvenance()),
				);
				return drizzle(client).transaction(async (tx) => {
					await guard.lock(tx);
					return guard.checkOrder(tx, { messageId, originalCreatedAt: at }, keys);
				});
			}

			it.each([
				[
					"menu/2026-11-04/lunch/tcb",
					"INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Newer menu'], 'newer')",
				],
				[
					"location/2026-11-04/lunch",
					"INSERT INTO mess_meal_location_details (meal_date, meal_slot, hostel_batches, college_batches, source_message_id) VALUES ('2026-11-04', 'lunch', ARRAY['all'], ARRAY[]::text[], 'newer')",
				],
				[
					"timing/2026-11-04/lunch",
					"INSERT INTO mess_meal_timing_extensions (meal_date, meal_slot, target_vendor, extended_timings, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', 'until 3', 'newer')",
				],
				[
					"change/2026-11-04/lunch/tcb",
					"INSERT INTO mess_meal_changes (meal_date, meal_slot, target_vendor, change_type, affected_item, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', 'addition', 'Salad', 'newer')",
				],
			])("checks current-row provenance independently of audits for %s", async (key, insert) => {
				await createRepository().capture(
					makeSource({ messageId: "newer", originalCreatedAt: newerTime }),
				);
				await client.unsafe(insert);
				expect(await order([key])).toMatchObject({ outcome: "rejected", reason: "stale_source" });
				expect(await order([key], newerTime)).toMatchObject({
					outcome: "rejected",
					reason: "equal_timestamp_conflict",
				});
				expect(await order([key], new Date(newerTime.getTime() + 1000))).toEqual({
					outcome: "accepted",
				});
			});

			it("does not infer provenance from legacy staging receivedAt", async () => {
				await client`INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, text_body, received_at) VALUES ('newer', '1@lid', 'lid', 'text', 'legacy', ${newerTime.toISOString()})`;
				await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items, source_message_id) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Legacy'], 'newer')`;
				expect(await order([fact])).toMatchObject({
					outcome: "rejected",
					reason: "unknown_provenance",
				});
			});

			it("ignores reversed audits without rows, accepts same-source equality, and rejects missing incoming time on overwrite", async () => {
				await auditedOwner(fact, "manual");
				expect(await order([fact], newerTime, "newer")).toEqual({ outcome: "accepted" });
				expect(await order([fact], null)).toMatchObject({
					outcome: "rejected",
					reason: "unknown_provenance",
				});
				await client`UPDATE mess_ingestion_operation_audits SET reversed_at = now()`;
				expect(await order([fact])).toEqual({ outcome: "accepted" });
			});

			it("derives every conservative key with timing scopes shared and swap menu plus change", () => {
				const keys = PostgresMessOperationAudit.factKeys(
					{
						weeklyMenu: {
							vendor: "tcb",
							meals: [{ mealDate: "2026-11-04", mealSlot: "lunch", items: ["Rice"] }],
						},
						vendor: "cheftalk_regular",
						meals: [{ mealDate: "2026-11-04", mealSlot: "dinner", items: ["Rice"] }],
						locationDetails: [
							{ mealDate: "2026-11-04", hostelBatches: ["all"], collegeBatches: [] },
						],
						timingExtensions: [
							{
								mealDate: "2026-11-04",
								mealSlot: "lunch",
								targetVendor: null,
								extendedTimings: "3pm",
							},
							{
								mealDate: "2026-11-04",
								mealSlot: "lunch",
								targetVendor: "tcb",
								extendedTimings: "3pm",
							},
						],
						mealChanges: [
							{
								mealDate: "2026-11-04",
								mealSlot: "lunch",
								targetVendor: "cheftalk_jain",
								changeType: "addition",
								affectedItem: "Salad",
							},
						],
					},
					[
						{
							sourceMealDate: "2026-11-04",
							sourceMealSlot: "lunch",
							targetMealDate: "2026-11-05",
							targetMealSlot: "dinner",
							vendor: "tcb",
							newItems: ["Rice"],
							previousItems: ["Bread"],
						},
					],
				);
				expect(keys.sort()).toEqual(
					[
						"menu/2026-11-04/lunch/tcb",
						"menu/2026-11-04/dinner/cheftalk_regular",
						"location/2026-11-04/lunch",
						"timing/2026-11-04/lunch",
						"change/2026-11-04/lunch/cheftalk_jain",
						"menu/2026-11-05/dinner/tcb",
						"change/2026-11-05/dinner/tcb",
					].sort(),
				);
			});

			it("uses one transaction advisory lock across connections and releases it on rollback", async () => {
				const guard = new PostgresMessWriteGuard(
					new PostgresMessOperationAudit(new PostgresMessProvenance()),
				);
				await expect(
					drizzle(client).transaction(async (tx) => {
						await guard.lock(tx);
						await secondClient.begin(async (other) => {
							expect(
								(await other`SELECT pg_try_advisory_xact_lock(730201, 1) AS acquired`)[0].acquired,
							).toBe(false);
						});
						throw new Error("rollback requested");
					}),
				).rejects.toThrow("rollback requested");
				await secondClient.begin(async (other) => {
					expect(
						(await other`SELECT pg_try_advisory_xact_lock(730201, 1) AS acquired`)[0].acquired,
					).toBe(true);
				});
			});

			describe("swap snapshot recheck", () => {
				const allVendors: readonly Vendor[] = ["cheftalk_regular", "cheftalk_jain", "tcb"];
				const swap = {
					sourceMealDate: "2026-11-04",
					sourceMealSlot: "lunch" as const,
					targetMealDate: "2026-11-05",
					targetMealSlot: "dinner" as const,
					targetVendor: null,
				};
				let snapshots: ResolvedMealSwapInput[];
				beforeEach(async () => {
					snapshots = allVendors.map((vendor) => ({
						...swap,
						vendor,
						newItems: [`Source ${vendor}`],
						previousItems: [`Target ${vendor}`],
					}));
					for (const row of snapshots) {
						await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items) VALUES (${row.sourceMealDate}, ${row.sourceMealSlot}, ${row.vendor}, ${row.newItems}), (${row.targetMealDate}, ${row.targetMealSlot}, ${row.vendor}, ${row.previousItems})`;
					}
				});
				async function check(
					resolvedSwaps = snapshots,
					targetVendor: Vendor | null | undefined = null,
				) {
					const guard = new PostgresMessWriteGuard(
						new PostgresMessOperationAudit(new PostgresMessProvenance()),
					);
					return drizzle(client).transaction(async (tx) => {
						await guard.lock(tx);
						return guard.checkSwapSnapshots(tx, {
							swaps: [{ ...swap, targetVendor }],
							resolvedSwaps,
						});
					});
				}
				it("accepts exact all-vendor snapshots and explicit vendor scope", async () => {
					expect(await check()).toEqual({ outcome: "accepted" });
					expect(
						await check(
							snapshots.filter((row) => row.vendor === "tcb"),
							"tcb",
						),
					).toEqual({ outcome: "accepted" });
				});
				it("keeps automatic null scope strict with only one available vendor", async () => {
					await client`DELETE FROM mess_meals WHERE vendor != 'tcb'`;
					expect(
						await check(
							snapshots.filter((row) => row.vendor === "tcb"),
							null,
						),
					).toMatchObject({ outcome: "rejected", reason: "changed_prerequisite" });
				});
				it("retains undefined legacy manual scope as the complete current source vendor set", async () => {
					await client`DELETE FROM mess_meals WHERE vendor != 'tcb'`;
					const guard = new PostgresMessWriteGuard(
						new PostgresMessOperationAudit(new PostgresMessProvenance()),
					);
					await drizzle(client).transaction(async (tx) => {
						await guard.lock(tx);
						expect(
							await guard.checkSwapSnapshots(tx, {
								mode: "manual",
								swaps: [{ ...swap, targetVendor: undefined }],
								resolvedSwaps: snapshots.filter((row) => row.vendor === "tcb"),
							}),
						).toEqual({ outcome: "accepted" });
					});
				});

				it.each(["source", "target"])("rejects missing %s rows", async (endpoint) => {
					const date = endpoint === "source" ? swap.sourceMealDate : swap.targetMealDate;
					await client`DELETE FROM mess_meals WHERE meal_date = ${date} AND vendor = 'tcb'`;
					expect(await check()).toMatchObject({
						outcome: "rejected",
						reason: "changed_prerequisite",
					});
				});
				it.each(["source", "target"])(
					"rejects changed %s items before writing",
					async (endpoint) => {
						const date = endpoint === "source" ? swap.sourceMealDate : swap.targetMealDate;
						await client`UPDATE mess_meals SET items = ARRAY['Changed'] WHERE meal_date = ${date} AND vendor = 'tcb'`;
						expect(await check()).toMatchObject({
							outcome: "rejected",
							reason: "changed_prerequisite",
						});
						expect((await client`SELECT count(*)::int AS n FROM mess_meal_changes`)[0].n).toBe(0);
					},
				);
				it("rejects incomplete snapshots when additional vendors exist instead of checking listed rows only", async () => {
					expect(await check(snapshots.slice(0, 1))).toMatchObject({
						outcome: "rejected",
						reason: "changed_prerequisite",
					});
				});
				it("rejects a newly added source/target prerequisite omitted by an earlier snapshot", async () => {
					const incomplete = snapshots.filter((row) => row.vendor !== "tcb");
					await client`DELETE FROM mess_meals WHERE vendor = 'tcb'`;
					await client`INSERT INTO mess_meals (meal_date, meal_slot, vendor, items) VALUES ('2026-11-04', 'lunch', 'tcb', ARRAY['Added source']), ('2026-11-05', 'dinner', 'tcb', ARRAY['Added target'])`;
					expect(await check(incomplete)).toMatchObject({
						outcome: "rejected",
						reason: "changed_prerequisite",
					});
				});
				it("rejects extraneous, duplicate and cross-endpoint snapshots", async () => {
					for (const invalid of [
						[...snapshots, snapshots[0]],
						snapshots.map((row) => ({ ...row, sourceMealDate: "2026-11-03" })),
					]) {
						expect(await check(invalid)).toMatchObject({
							outcome: "rejected",
							reason: "changed_prerequisite",
						});
					}
				});
			});
		});

		it("returns one immutable activation boundary under concurrent first initialization", async () => {
			await client`DELETE FROM food_ingestion_settings`;
			const start = Date.now();
			const boundaries = await Promise.all(
				Array.from({ length: 12 }, () => createRepository().initialize(groupJid)),
			);
			expect(new Set(boundaries.map((time) => time.getTime())).size).toBe(1);
			expect(boundaries[0].getTime()).toBeGreaterThanOrEqual(start);
			expect(boundaries[0].getTime()).toBeLessThanOrEqual(Date.now());
			expect(await createRepository().initialize(groupJid)).toEqual(boundaries[0]);
			expect(await client`SELECT * FROM food_ingestion_settings`).toHaveLength(1);
		});

		it("admits notify at the exact activation boundary and preserves raw media and transport metadata", async () => {
			const source = makeSource({
				originalCreatedAt: activatedAt,
				messageType: "image",
				mediaMimeType: "image/png",
				mediaBytes: new Uint8Array([0, 255, 3]),
				textBody: "Original caption",
			});
			const repository = createRepository();
			expect(await repository.capture(source)).toBe("admitted");
			expect(await repository.capture(source)).toBe("duplicate");
			expect(await countWorkRows(source.messageId)).toBe(1);
			const [row] =
				await client`SELECT * FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`;
			expect(row).toMatchObject({
				group_jid: groupJid,
				delivery_mode: "notify",

				state: "queued",
				attempt_count: 0,
				completed_at: null,
			});
			const [staging] =
				await client`SELECT * FROM whatsapp_group_food_announcements_messages WHERE id = ${source.messageId}`;
			expect(staging).toMatchObject({
				sender_address: source.senderAddress,
				sender_address_type: "lid",
				message_type: "image",
				media_mime_type: "image/png",
				text_body: "Original caption",
				status: "pending",
			});
			expect(new Date(row.original_created_at)).toEqual(activatedAt);
			expect(new Date(row.captured_at)).toEqual(source.capturedAt);
			expect(new Date(staging.received_at)).toEqual(activatedAt);
			expect(staging.media_buffer).toEqual(Buffer.from(source.mediaBytes!));
		});

		it("has exactly one admission when the same new source is captured concurrently", async () => {
			const source = makeSource();
			const outcomes = await Promise.all(
				Array.from({ length: 8 }, () => createRepository().capture(source)),
			);
			expect(outcomes.filter((result) => result === "admitted")).toHaveLength(1);
			expect(outcomes.filter((result) => result === "duplicate")).toHaveLength(7);
			expect(await countWorkRows(source.messageId)).toBe(1);
		});

		it.each([
			["append", { deliveryMode: "append" as const }, "append_delivery"],
			["missing timestamp", { originalCreatedAt: null }, "missing_original_timestamp"],
			["invalid timestamp", { originalCreatedAt: new Date(NaN) }, "invalid_original_timestamp"],
			["uninitialized group", { groupJid: "other@g.us" }, "group_not_initialized"],
		])("captures %s as terminal ineligible", async (_name, overrides, reason) => {
			const source = makeSource(overrides);
			expect(await createRepository().capture(source)).toBe("ineligible");
			const [row] =
				await client`SELECT * FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`;
			expect(row).toMatchObject({
				state: "ineligible",
				eligibility_reason: reason,
				decision_reason: reason,
				lease_token: null,
				lease_expires_at: null,
				next_attempt_at: null,
			});
			expect(Number.isFinite(new Date(row.completed_at).getTime())).toBe(true);
		});

		it("uses original time rather than a fresh capture time for old notify", async () => {
			const source = makeSource({ originalCreatedAt: new Date(activatedAt.getTime() - 1) });
			expect(await createRepository().capture(source)).toBe("ineligible");
			const [row] =
				await client`SELECT * FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`;
			expect(row.eligibility_reason).toBe("before_activation");
			expect(new Date(row.original_created_at)).toEqual(source.originalCreatedAt);
		});

		it("never retrofits a pre-existing pending staging row", async () => {
			const source = makeSource();
			await client`INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, text_body) VALUES (${source.messageId}, 'original@lid', 'lid', 'text', 'Historical raw source')`;
			expect(await createRepository().capture(source)).toBe("duplicate");
			expect(await countWorkRows(source.messageId)).toBe(0);
			const [row] =
				await client`SELECT text_body FROM whatsapp_group_food_announcements_messages WHERE id = ${source.messageId}`;
			expect(row.text_body).toBe("Historical raw source");
		});

		it("rolls staging and admission back together when work insertion fails", async () => {
			const source = makeSource();
			await client.unsafe(
				`CREATE FUNCTION reject_test_work() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected work failure'; END $$`,
			);
			await client.unsafe(
				`CREATE TRIGGER reject_test_work BEFORE INSERT ON food_announcement_ingestions FOR EACH ROW EXECUTE FUNCTION reject_test_work()`,
			);
			try {
				await expect(createRepository().capture(source)).rejects.toThrow();
				expect(await countWorkRows(source.messageId)).toBe(0);
				expect(
					await client`SELECT id FROM whatsapp_group_food_announcements_messages WHERE id = ${source.messageId}`,
				).toHaveLength(0);
			} finally {
				await client.unsafe(`DROP TRIGGER reject_test_work ON food_announcement_ingestions`);
				await client.unsafe(`DROP FUNCTION reject_test_work()`);
			}
			expect(await createRepository().capture(source)).toBe("admitted");
		});

		it("propagates raw capture failures without creating a semantic rejection", async () => {
			const source = makeSource({ textBody: null, mediaBytes: null });
			await expect(createRepository().capture(source)).rejects.toThrow();
			expect(await countWorkRows(source.messageId)).toBe(0);
		});

		it.each(["accepted", "rejected", "failed"])(
			"can retain malformed raw assessment audit for %s outcomes",
			async (state) => {
				const source = makeSource();
				await createRepository().capture(source);
				await client`UPDATE food_announcement_ingestions SET state = ${state}, completed_at = now(), raw_extraction = 'not JSON {', raw_verification = 'also not JSON', model = 'model', prompt_version = 'v1', recognized_type = 'weekly_menu' WHERE message_id = ${source.messageId}`;
				const [row] =
					await client`SELECT * FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`;
				expect(row).toMatchObject({
					raw_extraction: "not JSON {",
					raw_verification: "also not JSON",
					model: "model",
					prompt_version: "v1",
					recognized_type: "weekly_menu",
				});
				expect(await createRepository().capture(source)).toBe("duplicate");
				expect(
					(
						await client`SELECT state FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`
					)[0].state,
				).toBe(state);
			},
		);

		it("claims exactly once across separate PostgreSQL connections and preserves the source", async () => {
			const source = makeSource({
				messageType: "image",
				mediaMimeType: "image/png",
				mediaBytes: new Uint8Array([1, 255]),
			});
			await createRepository().capture(source);
			const [firstPid] = await client`SELECT pg_backend_pid() AS pid`;
			const [secondPid] = await secondClient`SELECT pg_backend_pid() AS pid`;
			expect(firstPid.pid).not.toBe(secondPid.pid);
			const claims = await Promise.all([
				createQueue().claimNext(),
				createQueue(secondClient).claimNext(),
			]);
			expect(claims.filter(Boolean)).toHaveLength(1);
			const claim = claims.find(Boolean)!;
			expect(claim.source).toEqual(source);
			expect(claim.lease).toMatchObject({ messageId: source.messageId, attempt: 1 });
			expect(claim.lease.token).toMatch(/^[a-f0-9-]{36}$/);
			const row = await workRow(source.messageId);
			expect(Number(row.lease_seconds)).toBeGreaterThan(295);
			expect(Number(row.lease_seconds)).toBeLessThanOrEqual(300);
			expect(new Date(row.lease_expires_at)).toEqual(claim.lease.expiresAt);
		});

		it("orders ready work by original timestamp then message ID and skips locked work", async () => {
			const sources = [
				makeSource({ messageId: "b" }),
				makeSource({ messageId: "a" }),
				makeSource({ messageId: "early", originalCreatedAt: activatedAt }),
			];
			for (const source of sources) await createRepository().capture(source);
			await secondClient.begin(async (tx) => {
				await tx`SELECT message_id FROM food_announcement_ingestions WHERE message_id = 'early' FOR UPDATE`;
				expect((await createQueue().claimNext())?.source.messageId).toBe("a");
			});
			expect((await createQueue().claimNext())?.source.messageId).toBe("early");
			expect((await createQueue().claimNext())?.source.messageId).toBe("b");
		});

		it("reclaims an expired lease with a fresh fence and ignores caller attempt and expiry", async () => {
			const source = makeSource();
			await createRepository().capture(source);
			const first = (await createQueue().claimNext())!;
			await expire(source.messageId);
			expect(
				await createQueue().fail(
					{ ...first.lease, expiresAt: new Date("2100-01-01") },
					{ code: "timeout", detail: "old", retriable: true },
				),
			).toEqual({ outcome: "lease_lost" });
			const second = (await createQueue(secondClient).claimNext())!;
			expect(second.lease.attempt).toBe(2);
			expect(second.lease.token).not.toBe(first.lease.token);
			expect(
				await createQueue().fail(first.lease, { code: "old", detail: "stale", retriable: false }),
			).toEqual({ outcome: "lease_lost" });
			expect(await workRow(source.messageId)).toMatchObject({
				state: "processing",
				lease_token: second.lease.token,
			});
			const result = await createQueue().fail(
				{ ...second.lease, attempt: 99, expiresAt: new Date(0) },
				{ code: "timeout", detail: "current", retriable: true },
			);
			expect(result.outcome).toBe("retry_scheduled");
			expect(Number((await workRow(source.messageId)).retry_seconds)).toBeGreaterThan(29);
		});

		it("rechecks database expiry after waiting for a row lock before recording failure", async () => {
			const source = makeSource();
			await createRepository().capture(source);
			const claim = (await createQueue().claimNext())!;
			await client`UPDATE food_announcement_ingestions SET lease_expires_at = clock_timestamp() + interval '2 seconds' WHERE message_id = ${source.messageId}`;
			const [worker] = await secondClient`SELECT pg_backend_pid() AS pid`;
			let result: ReturnType<PostgresFoodWorkQueue["fail"]> | undefined;
			await client.begin(async (lock) => {
				await lock`SELECT message_id FROM food_announcement_ingestions WHERE message_id = ${source.messageId} FOR UPDATE`;
				result = createQueue(secondClient).fail(claim.lease, {
					code: "timeout",
					detail: "late failure",
					retriable: true,
				});
				let waiting = false;
				for (let poll = 0; poll < 100; poll++) {
					const [activity] =
						await admin`SELECT wait_event_type FROM pg_stat_activity WHERE pid = ${worker.pid}`;
					if (activity.wait_event_type === "Lock") {
						waiting = true;
						break;
					}
				}
				expect(waiting).toBe(true);
				// Only a short test-controlled expiry elapses; the production five-minute lease is never awaited.
				await lock`SELECT pg_sleep(greatest(0, extract(epoch FROM (lease_expires_at - clock_timestamp()))) + 0.02) FROM food_announcement_ingestions WHERE message_id = ${source.messageId}`;
			});
			expect(await result).toEqual({ outcome: "lease_lost" });
			expect(await workRow(source.messageId)).toMatchObject({
				state: "processing",
				lease_token: claim.lease.token,
				decision_reason: null,
				next_attempt_at: null,
			});
		});

		it("allows only three attempts with 5 then 30 second delays and preserves diagnostics", async () => {
			const source = makeSource();
			await createRepository().capture(source);
			const failure = {
				code: "timeout",
				detail: "service unavailable",
				retriable: true,
				diagnostics: {
					rawExtraction: "broken JSON {",
					rawVerification: "not JSON",
					model: "model",
					promptVersion: "v1",
					recognizedType: "weekly_menu" as const,
				},
			};
			for (const [attempt, delay] of [
				[1, 5],
				[2, 30],
				[3, 0],
			]) {
				const claim = (await createQueue().claimNext())!;
				expect(claim.lease.attempt).toBe(attempt);
				const result = await createQueue().fail({ ...claim.lease, attempt: 0 }, failure);
				const row = await workRow(source.messageId);
				expect(row).toMatchObject({
					lease_token: null,
					lease_expires_at: null,
					decision_reason: failure.code,
					decision_detail: failure.detail,
					raw_extraction: "broken JSON {",
					raw_verification: "not JSON",
					model: "model",
					prompt_version: "v1",
					recognized_type: "weekly_menu",
				});
				if (delay > 0) {
					expect(result).toMatchObject({
						outcome: "retry_scheduled",
						nextAttemptAt: new Date(row.next_attempt_at),
					});
					expect(Number(row.retry_seconds)).toBeGreaterThan(delay - 1);
					expect(Number(row.retry_seconds)).toBeLessThanOrEqual(delay);
					expect(await createQueue().claimNext()).toBeNull();
					await ready(source.messageId);
				} else {
					expect(result).toEqual({
						outcome: "failed",
						reason: failure.code,
						detail: failure.detail,
					});
					expect(row.completed_at).not.toBeNull();
					expect(row.next_attempt_at).toBeNull();
				}
			}
			expect(await createQueue().claimNext()).toBeNull();
			expect(
				(
					await client`SELECT status FROM whatsapp_group_food_announcements_messages WHERE id = ${source.messageId}`
				)[0].status,
			).toBe("pending");
		});

		it("honors longer provider retry-after using database time", async () => {
			await createRepository().capture(makeSource());
			const claim = (await createQueue().claimNext())!;
			const result = await createQueue().fail(claim.lease, {
				code: "http_429",
				detail: "rate limited",
				retriable: true,
				retryAfterMs: 90000,
			});
			expect(result.outcome).toBe("retry_scheduled");
			const row = await workRow(claim.lease.messageId);
			expect(Number(row.retry_seconds)).toBeGreaterThan(89);
			expect(Number(row.retry_seconds)).toBeLessThanOrEqual(90);
		});

		it.each([
			["invalid_model_response", true],
			["media_limits", false],
		])("makes %s terminal even when marked retriable=%s", async (code, retriable) => {
			await createRepository().capture(makeSource());
			const claim = (await createQueue().claimNext())!;
			const failure = {
				code,
				retriable,
				detail: "invalid",
				diagnostics: { rawExtraction: "bad {" },
			};
			expect(await createQueue().fail(claim.lease, failure)).toEqual({
				outcome: "failed",
				reason: code,
				detail: "invalid",
			});
			expect(await workRow(claim.lease.messageId)).toMatchObject({
				state: "failed",
				raw_extraction: "bad {",
				lease_token: null,
			});
			expect(await createQueue().claimNext()).toBeNull();
			expect(
				await createQueue().fail(claim.lease, { code: "replace", retriable: true, detail: "late" }),
			).toEqual({ outcome: "lease_lost" });
		});

		it("terminalizes exhausted crash recovery and continues to later queued work", async () => {
			const source = makeSource({ messageId: "crashed" });
			await createRepository().capture(source);
			for (let attempt = 1; attempt <= 3; attempt++) {
				const claim = (await createQueue().claimNext())!;
				expect(claim.lease.attempt).toBe(attempt);
				await expire(source.messageId);
			}
			await client`UPDATE food_announcement_ingestions SET raw_extraction = 'prior malformed {', model = 'prior-model' WHERE message_id = ${source.messageId}`;
			await createRepository().capture(makeSource({ messageId: "later" }));
			expect((await createQueue().claimNext())?.source.messageId).toBe("later");
			expect(await workRow(source.messageId)).toMatchObject({
				state: "failed",
				attempt_count: 3,
				decision_reason: "attempts_exhausted",
				lease_token: null,
				lease_expires_at: null,
				next_attempt_at: null,
				raw_extraction: "prior malformed {",
				model: "prior-model",
			});
			expect((await workRow(source.messageId)).completed_at).not.toBeNull();
		});

		it("does not claim historical staging, terminal states, or future scheduled work", async () => {
			await client`INSERT INTO whatsapp_group_food_announcements_messages (id, sender_address, sender_address_type, message_type, text_body) VALUES ('historical', '123@lid', 'lid', 'text', 'old')`;
			for (const state of ["accepted", "rejected", "failed", "ineligible"]) {
				await createRepository().capture(makeSource({ messageId: state }));
				await client`UPDATE food_announcement_ingestions SET state = ${state}, completed_at = clock_timestamp() WHERE message_id = ${state}`;
			}
			await createRepository().capture(makeSource({ messageId: "future" }));
			await client`UPDATE food_announcement_ingestions SET next_attempt_at = clock_timestamp() + interval '1 hour' WHERE message_id = 'future'`;
			expect(await createQueue().claimNext()).toBeNull();
		});

		it("enforces attempts, lease, terminal completion, and source identity in PostgreSQL", async () => {
			const source = makeSource();
			await createRepository().capture(source);
			await expect(
				client`UPDATE food_announcement_ingestions SET attempt_count = -1 WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
			await expect(
				client`UPDATE food_announcement_ingestions SET state = 'processing' WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
			await expect(
				client`UPDATE food_announcement_ingestions SET lease_token = ${randomUUID()} WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
			await expect(
				client`UPDATE food_announcement_ingestions SET state = 'accepted' WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
			await expect(
				client`UPDATE food_announcement_ingestions SET group_jid = '' WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
			await expect(
				client`UPDATE food_announcement_ingestions SET message_id = 'missing-source' WHERE message_id = ${source.messageId}`,
			).rejects.toThrow();
		});
	},
);
