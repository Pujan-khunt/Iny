import { TriageTerminalView } from "../../../../src/adapters/inbound/cli/TriageTerminalView";
import { TriageMenuRenderer } from "../../../../src/adapters/inbound/cli/TriageMenuRenderer";
import { TriagePreviewRenderer } from "../../../../src/adapters/inbound/cli/TriagePreviewRenderer";
import { TriageWeeklyMenuRenderer } from "../../../../src/adapters/inbound/cli/TriageWeeklyMenuRenderer";
import { TriageCompositeRenderer } from "../../../../src/adapters/inbound/cli/TriageCompositeRenderer";
import { TriageMessageActions } from "../../../../src/adapters/inbound/cli/TriageMessageActions";
import { TriageWeeklyMenuController } from "../../../../src/adapters/inbound/cli/TriageWeeklyMenuController";
import { TriageWeeklyMenuReview } from "../../../../src/adapters/inbound/cli/TriageWeeklyMenuReview";
import { TriageAnnouncementController } from "../../../../src/adapters/inbound/cli/TriageAnnouncementController";
import { MenuDishNormalizer } from "../../../../src/core/services/MenuDishNormalizer";
import { MealSwapResolver } from "../../../../src/core/services/MealSwapResolver";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { TriageCliController } from "../../../../src/adapters/inbound/cli/TriageCliController";
import type { StagedAnnouncementMessage } from "../../../../src/core/ports/MessStagingRepositoryPort";
import type { StagedWeeklyMenu } from "../../../../src/core/entities/MessAnnouncement";
import type { ExtractedCompositeAnnouncement } from "../../../../src/adapters/common/mess/ExtractionSchemas";
import { ExtractedCompositeAnnouncementSchema } from "../../../../src/adapters/common/mess/ExtractionSchemas";

class MockIo {
	private inputs: string[];
	public outputs: string[] = [];
	public isClosed = false;

	constructor(inputs: string[] = []) {
		this.inputs = [...inputs];
	}

	async prompt(_question: string): Promise<string> {
		const val = this.inputs.shift();
		if (val === undefined) {
			throw new Error(`MockIo ran out of inputs! Question was: ${_question}`);
		}
		return val;
	}

	print(msg: string): void {
		this.outputs.push(msg);
	}

	close(): void {
		this.isClosed = true;
	}
}

describe("TriageCliController", () => {
	let mockStagingRepo: any;
	let mockVisionExtractor: any;
	let mockTextExtractor: any;
	let mockPdfRasterizer: any;
	let mockEditor: any;
	let mockPreviewer: any;

	const mockWeeklyMenu: StagedWeeklyMenu = {
		vendor: "cheftalk_regular",
		meals: Array.from({ length: 21 }, (_, i) => ({
			mealDate: `2026-10-${String(4 + Math.floor(i / 3)).padStart(2, "0")}`,
			mealSlot: (["breakfast", "lunch", "dinner"] as const)[i % 3],
			items: [`Item ${i + 1}`],
		})),
	};

	const samplePendingPdfMessage: StagedAnnouncementMessage = {
		id: "MSG_PDF_01",
		senderAddress: "+919876543210",
		senderAddressType: "pn",
		messageType: "document",
		mediaMimeType: "application/pdf",
		mediaBuffer: Buffer.from("%PDF-1.4 test"),
		textBody: "Weekly menu Oct 4-10.pdf",
		status: "pending",
		receivedAt: new Date("2026-10-08T06:00:00Z"),
		processedAt: null,
	};

	const sampleProcessedMessage: StagedAnnouncementMessage = {
		id: "MSG_PROCESSED_01",
		senderAddress: "+919876543210",
		senderAddressType: "pn",
		messageType: "text",
		mediaMimeType: null,
		mediaBuffer: null,
		textBody: "Lunch today in hostel mess",
		status: "processed",
		receivedAt: new Date("2026-10-08T06:00:00Z"),
		processedAt: new Date("2026-10-08T07:00:00Z"),
	};

	function createController(deps: { io: MockIo }) {
		const io = deps.io;
		const view = new TriageTerminalView(
			new TriageMenuRenderer(),
			new TriagePreviewRenderer(new TriageWeeklyMenuRenderer(), new TriageCompositeRenderer()),
		);
		const review = new TriageWeeklyMenuReview(
			io,
			view,
			mockStagingRepo,
			mockEditor,
			MenuDishNormalizer,
		);
		return new TriageCliController(
			io,
			view,
			mockStagingRepo,
			new TriageMessageActions(io, view, mockStagingRepo, mockPreviewer),
			new TriageWeeklyMenuController(io, view, mockVisionExtractor, mockPdfRasterizer, review),
			new TriageAnnouncementController(
				io,
				view,
				mockStagingRepo,
				mockTextExtractor,
				mockEditor,
				new MealSwapResolver(mockStagingRepo),
			),
		);
	}

	beforeEach(() => {
		mockStagingRepo = {
			listStagedMessages: vi.fn(),
			getIngestionAudit: vi.fn().mockResolvedValue(null),
			getMessageById: vi.fn(),
			atomicCommit: vi.fn().mockResolvedValue(undefined),
			atomicCommitComposite: vi.fn().mockResolvedValue(undefined),
			markIgnored: vi.fn().mockResolvedValue(undefined),
			atomicUndo: vi.fn().mockResolvedValue(undefined),
			getMealsByDateAndSlot: vi.fn().mockResolvedValue([]),
		};

		mockVisionExtractor = {
			extractWeeklyMenu: vi.fn().mockResolvedValue({
				rawMenu: structuredClone(mockWeeklyMenu),
				menu: structuredClone(mockWeeklyMenu),
				corrections: [],
			}),
		};

		mockTextExtractor = {
			extractAnnouncementEvents: vi.fn(),
		};

		mockPdfRasterizer = {
			inspect: vi.fn().mockResolvedValue({ pageCount: 1, widthPoints: 72, heightPoints: 36 }),
			renderFirstPage: vi.fn().mockResolvedValue({
				pngBytes: new Uint8Array(Buffer.from("png-bytes")),
				widthPixels: 600,
				heightPixels: 300,
				dpi: 600,
				elapsedMs: 1,
			}),
		};

		mockEditor = {
			editJson: vi.fn(),
		};

		mockPreviewer = {
			previewMedia: vi.fn().mockResolvedValue({ success: true, filePath: "/tmp/test.pdf" }),
		};
	});

	it("exits gracefully when user selects [q]", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		const io = new MockIo(["q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockStagingRepo.listStagedMessages).toHaveBeenCalledTimes(1);
	});

	it("prints notice when no staged messages are found", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([]);
		const io = new MockIo([]);

		const controller = createController({ io });

		await controller.run();
		expect(io.outputs.some((o) => o.includes("No staged food announcement messages found"))).toBe(
			true,
		);
	});

	it("handles processed message undo action [u]", async () => {
		mockStagingRepo.listStagedMessages
			.mockResolvedValueOnce([sampleProcessedMessage])
			.mockResolvedValueOnce([]); // next loop returns empty and exits

		// Choices: select message 1 -> undo 'u' -> will loop, then exit on q or empty
		const io = new MockIo(["1", "u", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockStagingRepo.atomicUndo).toHaveBeenCalledWith("MSG_PROCESSED_01");
	});

	it("handles pending message mark ignored [5] -> [y]", async () => {
		mockStagingRepo.listStagedMessages
			.mockResolvedValueOnce([samplePendingPdfMessage])
			.mockResolvedValueOnce([]);

		// Select message 1 -> Intent 5 (mark ignored) -> confirm 'y' -> exit 'q'
		const io = new MockIo(["1", "5", "y", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockStagingRepo.markIgnored).toHaveBeenCalledWith("MSG_PDF_01");
	});

	it("inspects media preview [o] before proceeding with extraction", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

		// Select 1 -> Intent 1 -> Choice 'o' (open media) -> Choice 'c' (cancel) -> Exit 'q'
		const io = new MockIo(["1", "1", "o", "c", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockPreviewer.previewMedia).toHaveBeenCalledWith(
			samplePendingPdfMessage.mediaBuffer,
			samplePendingPdfMessage.mediaMimeType,
			samplePendingPdfMessage.textBody,
		);
	});

	it("handles non-fatal extraction error card and retries with [r]", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

		// First call throws, second call succeeds
		mockPdfRasterizer.renderFirstPage
			.mockRejectedValueOnce(new Error("Rate limit reached for deepseek-flash"))
			.mockResolvedValueOnce({
				pngBytes: new Uint8Array(Buffer.from("png-bytes")),
				widthPixels: 600,
				heightPixels: 300,
				dpi: 600,
				elapsedMs: 1,
			});

		// Select 1 -> Intent 1 -> Proceed 'y' -> Error occurs -> Retry 'r' -> Preview shown -> Commit 'y' -> Exit 'q'
		const io = new MockIo(["1", "1", "y", "r", "y", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
			messageId: "MSG_PDF_01",
			weeklyMenu: mockWeeklyMenu,
			extractionAudit: {
				rawMenu: mockWeeklyMenu,
				menu: mockWeeklyMenu,
				corrections: [],
				reviewedMenu: mockWeeklyMenu,
				reviewCorrections: [],
			},
		});
	});

	it("executes full weekly menu remediation (switch vendor [v], shift dates [d], edit [e], confirm [y])", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);

		const updatedMenuFromEditor: StagedWeeklyMenu = {
			...mockWeeklyMenu,
			vendor: "cheftalk_jain",
		};
		mockEditor.editJson.mockResolvedValue({
			success: true,
			data: updatedMenuFromEditor,
		});

		// 1 -> Intent 1 -> 'y' (proceed) -> Preview shown:
		// 'v' -> switch to [3] (tcb)
		// 'd' -> shift start date to '2026-10-05'
		// 'e' -> edit in vim
		// 'y' -> confirm commit
		// 'q' -> exit
		const io = new MockIo(["1", "1", "y", "v", "3", "d", "2026-10-05", "e", "y", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockPdfRasterizer.renderFirstPage).toHaveBeenCalled();
		expect(mockVisionExtractor.extractWeeklyMenu).toHaveBeenCalledWith(Buffer.from("png-bytes"), {
			mimeType: "image/png",
			textContext: samplePendingPdfMessage.textBody,
		});
		expect(mockEditor.editJson).toHaveBeenCalled();
		expect(mockStagingRepo.atomicCommit).toHaveBeenCalledWith({
			messageId: "MSG_PDF_01",
			weeklyMenu: expect.objectContaining({
				vendor: "cheftalk_jain",
			}),
			extractionAudit: expect.objectContaining({
				rawMenu: mockWeeklyMenu,
				menu: mockWeeklyMenu,
				corrections: [],
				reviewedMenu: updatedMenuFromEditor,
				reviewCorrections: [],
			}),
		});
	});

	it("preserves extraction audit independently through vendor, date, and mutable editor changes", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		const rawMenu = structuredClone(mockWeeklyMenu);
		rawMenu.meals[0].items = ["Frycrums"];
		const menu = structuredClone(rawMenu);
		menu.meals[0].items = ["Fryums"];
		const corrections = [
			{
				mealDate: "2026-10-04",
				mealSlot: "breakfast",
				itemIndex: 0,
				originalItem: "Frycrums",
				correctedItem: "Fryums",
				aliasId: "frycrums-to-fryums",
			},
		];
		const extraction = { rawMenu, menu, corrections };
		const snapshot = structuredClone(extraction);
		mockVisionExtractor.extractWeeklyMenu.mockResolvedValue(extraction);
		mockEditor.editJson.mockImplementation(async (working: StagedWeeklyMenu) => {
			expect(working.vendor).toBe("tcb");
			expect(working.meals[0].mealDate).toBe("2026-10-05");
			working.meals[0].items[0] = "Operator dish";
			return { success: true, data: working };
		});
		const io = new MockIo(["1", "1", "y", "v", "3", "d", "2026-10-05", "e", "y", "q"]);
		const controller = createController({ io });
		await controller.run();
		expect(extraction).toEqual(snapshot);
		const committed = mockStagingRepo.atomicCommit.mock.calls[0][0];
		expect(committed.weeklyMenu.meals[0].items).toEqual(["Operator dish"]);
		expect(committed.extractionAudit).toEqual({
			...snapshot,
			reviewedMenu: committed.weeklyMenu,
			reviewCorrections: [],
		});
		committed.weeklyMenu.meals[0].items[0] = "Later mutation";
		expect(committed.extractionAudit.reviewedMenu.meals[0].items).toEqual(["Operator dish"]);
	});

	it("retains initial corrections and normalizes edited dishes through the public sequence", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		const rawMenu = structuredClone(mockWeeklyMenu);
		rawMenu.meals[0].items = ["Frycrums", "Patrode"];
		const menu = structuredClone(rawMenu);
		menu.meals[0].items[0] = "Fryums";
		const extraction = {
			rawMenu,
			menu,
			corrections: [
				{
					mealDate: "2026-10-04",
					mealSlot: "breakfast",
					itemIndex: 0,
					originalItem: "Frycrums",
					correctedItem: "Fryums",
					aliasId: "frycrums-to-fryums",
				},
			],
		};
		mockVisionExtractor.extractWeeklyMenu.mockResolvedValue(extraction);
		mockEditor.editJson.mockImplementation(async (working: StagedWeeklyMenu) => {
			working.meals[1].items = ["Masala Frycrums/Papad"];
			return { success: true, data: working };
		});
		const io = new MockIo(["1", "1", "y", "e", "y", "q"]);
		const controller = createController({ io });
		await controller.run();
		const commit = mockStagingRepo.atomicCommit.mock.calls[0][0];
		expect(commit.weeklyMenu.meals[0].items).toEqual(["Fryums", "Patrode"]);
		expect(commit.weeklyMenu.meals[1].items).toEqual(["Masala Fryums/Papad"]);
		expect(commit.extractionAudit.rawMenu.meals[0].items).toContain("Frycrums");
		expect(commit.extractionAudit.corrections[0].aliasId).toBe("frycrums-to-fryums");
		expect(commit.extractionAudit.reviewedMenu.meals[1].items).toEqual(["Masala Frycrums/Papad"]);
		expect(commit.extractionAudit.reviewCorrections).toEqual([
			expect.objectContaining({
				originalItem: "Masala Frycrums/Papad",
				correctedItem: "Masala Fryums/Papad",
			}),
		]);
		expect(io.outputs.join("\n")).toContain("Frycrums -> Fryums");
		expect(extraction.menu.meals[1].items).toEqual(["Item 2"]);
	});

	it.each(["rejected", "failed"])(
		"inspects persisted %s reason without changing automatic state",
		async (state) => {
			mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
			mockStagingRepo.getIngestionAudit = vi.fn().mockResolvedValue({
				automatic: {
					state,
					decisionReason: "unreadable_content",
					decisionDetail: "Dinner cell is obscured",
				},
				operations: [],
			});
			const io = new MockIo(["1", "c", "q"]);
			await createController({ io }).run();
			expect(mockStagingRepo.getIngestionAudit).toHaveBeenCalledWith(samplePendingPdfMessage.id);
			expect(io.outputs.join("\n")).toContain("unreadable_content");
			expect(io.outputs.join("\n")).toContain("Dinner cell is obscured");
			expect(mockStagingRepo.atomicCommit).not.toHaveBeenCalled();
		},
	);

	it("keeps chronological edit corrections without duplicating them on cancelled edits", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		mockEditor.editJson
			.mockImplementationOnce(async (working: StagedWeeklyMenu) => {
				working.meals[0].items = ["Masala Frycrums"];
				return { success: true, data: working };
			})
			.mockResolvedValueOnce({ cancelled: true })
			.mockImplementationOnce(async (working: StagedWeeklyMenu) => {
				expect(working.meals[0].items).toEqual(["Masala Fryums"]);
				working.meals[0].items = ["Patrode"];
				working.meals[1].items = ["Frycrums/Papad"];
				return { success: true, data: working };
			});
		const io = new MockIo(["1", "1", "y", "e", "e", "e", "y", "q"]);
		await createController({ io }).run();
		const commit = mockStagingRepo.atomicCommit.mock.calls[0][0];
		expect(commit.extractionAudit.reviewCorrections.map((c: any) => c.originalItem)).toEqual([
			"Masala Frycrums",
			"Frycrums/Papad",
		]);
		expect(commit.weeklyMenu.meals[0].items).toEqual(["Patrode"]);
		expect(commit.weeklyMenu.meals[1].items).toEqual(["Fryums/Papad"]);
	});

	it.each([null, undefined])(
		"retains manual %s scope for only currently present source vendors",
		async (targetVendor) => {
			const message = {
				...samplePendingPdfMessage,
				messageType: "text",
				mediaBuffer: null,
				mediaMimeType: null,
			};
			mockStagingRepo.listStagedMessages.mockResolvedValue([message]);
			const swap = {
				sourceMealDate: "2026-10-04",
				sourceMealSlot: "lunch",
				targetMealDate: "2026-10-05",
				targetMealSlot: "dinner",
				targetVendor,
			};
			mockTextExtractor.extractAnnouncementEvents.mockResolvedValue({
				mealDate: "2026-10-05",
				mealSwaps: [swap],
			});
			mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
				async (mealDate: string, mealSlot: string) => [
					{
						mealDate,
						mealSlot,
						vendor: "tcb",
						items: [mealDate === "2026-10-04" ? "Source" : "Target"],
					},
				],
			);
			await createController({ io: new MockIo(["1", "1", "y", "q"]) }).run();
			const commit = mockStagingRepo.atomicCommitComposite.mock.calls[0][0];
			expect(commit.composite.mealSwaps[0].targetVendor).toBe(targetVendor);
			expect(commit.resolvedSwaps).toEqual([
				expect.objectContaining({ vendor: "tcb", newItems: ["Source"], previousItems: ["Target"] }),
			]);
		},
	);

	it.each([null, undefined])("blocks missing target for manual %s scope", async (targetVendor) => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([
			{ ...samplePendingPdfMessage, messageType: "text", mediaBuffer: null, mediaMimeType: null },
		]);
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue({
			mealDate: "2026-10-05",
			mealSwaps: [
				{
					sourceMealDate: "2026-10-04",
					sourceMealSlot: "lunch",
					targetMealDate: "2026-10-05",
					targetMealSlot: "dinner",
					targetVendor,
				},
			],
		});
		mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
			async (mealDate: string, mealSlot: string) =>
				mealDate === "2026-10-04" ? [{ mealDate, mealSlot, vendor: "tcb", items: ["Source"] }] : [],
		);
		const io = new MockIo(["1", "1", "y", "c", "q"]);
		await createController({ io }).run();
		expect(mockStagingRepo.atomicCommitComposite).not.toHaveBeenCalled();
		expect(io.outputs.join("\n")).toContain("Target menu for 2026-10-05");
	});

	it("keeps the previous menu after a mutable cancelled edit and allows retry", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		mockEditor.editJson
			.mockImplementationOnce(async (working: StagedWeeklyMenu) => {
				working.meals[0].items = ["Discard this"];
				return { success: false, cancelled: true };
			})
			.mockResolvedValueOnce({ success: false, error: "Invalid JSON" })
			.mockImplementationOnce(async (working: StagedWeeklyMenu) => {
				expect(working.meals[0].items).toEqual(["Item 1"]);
				working.meals[0].items = ["Operator dish"];
				return { success: true, data: working };
			});
		const io = new MockIo(["1", "1", "y", "e", "e", "e", "y", "q"]);
		await createController({ io }).run();
		expect(mockStagingRepo.atomicCommit.mock.calls[0][0].weeklyMenu.meals[0].items).toEqual([
			"Operator dish",
		]);
		expect(io.outputs.join("\n")).toContain("Edit error: Invalid JSON");
	});

	it("retries text extraction and preserves confirmation after an error", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([
			{ ...samplePendingPdfMessage, messageType: "text", mediaBuffer: null, mediaMimeType: null },
		]);
		mockTextExtractor.extractAnnouncementEvents
			.mockRejectedValueOnce(new Error("provider timeout"))
			.mockResolvedValueOnce({
				mealDate: "2026-10-05",
				mealChanges: [
					{
						mealDate: "2026-10-05",
						mealSlot: "dinner",
						targetVendor: "tcb",
						changeType: "addition",
						affectedItem: "Patrode",
					},
				],
			});
		await createController({ io: new MockIo(["1", "1", "r", "y", "q"]) }).run();
		expect(mockTextExtractor.extractAnnouncementEvents).toHaveBeenCalledTimes(2);
		expect(
			mockStagingRepo.atomicCommitComposite.mock.calls[0][0].composite.mealChanges[0].affectedItem,
		).toBe("Patrode");
	});

	it("returns to the inbox after extraction error cancellation", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([samplePendingPdfMessage]);
		mockVisionExtractor.extractWeeklyMenu.mockRejectedValue(new Error("provider unavailable"));
		await createController({ io: new MockIo(["1", "1", "y", "c", "q"]) }).run();
		expect(mockVisionExtractor.extractWeeklyMenu).toHaveBeenCalledTimes(1);
		expect(mockStagingRepo.atomicCommit).not.toHaveBeenCalled();
	});

	it.each(["ignore", "undo"])("cancels %s without mutating staging", async (action) => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([
			action === "undo" ? sampleProcessedMessage : samplePendingPdfMessage,
		]);
		const inputs = action === "undo" ? ["1", "c", "q"] : ["1", "4", "c", "q"];
		await createController({ io: new MockIo(inputs) }).run();
		expect(mockStagingRepo.atomicUndo).not.toHaveBeenCalled();
		expect(mockStagingRepo.markIgnored).not.toHaveBeenCalled();
	});

	it("handles pending text message mark ignored [2] -> [y]", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_TEXT_IGNORE_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "Some informal text message",
		};
		mockStagingRepo.listStagedMessages.mockResolvedValueOnce([textMsg]).mockResolvedValueOnce([]);

		// Select 1 -> Option 2 (Ignore Message) -> Confirm 'y' -> Exit 'q'
		const io = new MockIo(["1", "2", "y", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockStagingRepo.markIgnored).toHaveBeenCalledWith("MSG_TEXT_IGNORE_01");
	});

	it("handles media message streamlined menu choices (Open in Viewer [3], Ignore [4], Process Announcement [2])", async () => {
		const mediaMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_MEDIA_01",
			textBody: "Lunch notice with image",
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([mediaMsg]);

		const compositePayload: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: null,
			timingExtensions: [],
			mealChanges: [],
			mealSwaps: [],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositePayload);

		// 1 -> [3] Open in Viewer -> [2] Process Announcement -> [y] Confirm -> [q]
		const io = new MockIo(["1", "3", "2", "y", "q"]);

		const controller = createController({ io });

		await controller.run();
		expect(mockPreviewer.previewMedia).toHaveBeenCalled();
		expect(mockTextExtractor.extractAnnouncementEvents).toHaveBeenCalledWith(
			mediaMsg.textBody,
			mediaMsg.receivedAt,
		);
		expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
			messageId: "MSG_MEDIA_01",
			composite: compositePayload,
			resolvedSwaps: [],
		});
	});

	it("handles composite text announcement extraction and commit", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_COMPOSITE_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "2028 and 2029 in Hostel for lunch. Dinner extended till 10:30 PM.",
			receivedAt: new Date("2026-10-20T06:00:00Z"),
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

		const compositePayload: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: {
				mealDate: "2026-10-20",
				mealSlot: "lunch",
				hostelBatches: ["2028", "2029"],
				collegeBatches: ["ALL_OTHER_BATCHES"],
			},
			timingExtensions: [
				{
					mealDate: "2026-10-20",
					mealSlot: "dinner",
					targetVendor: null,
					extendedTimings: "Dinner extended till 10:30 PM",
				},
			],
			mealChanges: [],
			mealSwaps: [],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositePayload);

		// 1 (select message) -> 1 (Process Announcement) -> y (Confirm & Commit) -> q (exit)
		const io = new MockIo(["1", "1", "y", "q"]);

		const controller = createController({ io });

		await controller.run();

		expect(mockTextExtractor.extractAnnouncementEvents).toHaveBeenCalledWith(
			textMsg.textBody,
			textMsg.receivedAt,
		);
		expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
			messageId: "MSG_COMPOSITE_01",
			composite: compositePayload,
			resolvedSwaps: [],
		});
	});

	it("blocks commit when swap source menu is missing (Option B gate)", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_SWAP_MISSING_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "Today's dinner will serve tomorrow's lunch menu",
			receivedAt: new Date("2026-10-20T06:00:00Z"),
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

		const compositeWithSwap: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: null,
			timingExtensions: [],
			mealChanges: [],
			mealSwaps: [
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-25",
					sourceMealSlot: "lunch",
					targetVendor: "cheftalk_regular",
				},
			],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);
		mockStagingRepo.getMealsByDateAndSlot.mockResolvedValue([]); // Database check returns NO meals

		// 1 (select message) -> 1 (Process Announcement) -> y (rejected) -> c (cancel) -> q (quit)
		const io = new MockIo(["1", "1", "y", "c", "q"]);

		const controller = createController({ io });

		await controller.run();

		expect(mockStagingRepo.atomicCommitComposite).not.toHaveBeenCalled();
		expect(
			io.outputs.some(
				(out) =>
					out.includes("Cannot Commit Swap") &&
					out.includes("2026-10-25") &&
					out.includes("not found in database"),
			),
		).toBe(true);
	});

	it("blocks commit when swap target menu is missing (Option B gate)", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_SWAP_MISSING_TARGET_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "Today's dinner will serve tomorrow's lunch menu",
			receivedAt: new Date("2026-10-20T06:00:00Z"),
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

		const compositeWithSwap: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: null,
			timingExtensions: [],
			mealChanges: [],
			mealSwaps: [
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					targetVendor: "cheftalk_regular",
				},
			],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);

		// Source exists, but Target is missing
		mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
			async (mealDate: string, mealSlot: string) => {
				if (mealDate === "2026-10-21" && mealSlot === "lunch") {
					return [
						{
							id: "source-1",
							mealDate: "2026-10-21",
							mealSlot: "lunch",
							vendor: "cheftalk_regular",
							items: ["Rajma", "Rice"],
						},
					];
				}
				return []; // Target does not exist
			},
		);

		const io = new MockIo(["1", "1", "y", "c", "q"]);

		const controller = createController({ io });

		await controller.run();

		expect(mockStagingRepo.atomicCommitComposite).not.toHaveBeenCalled();
		expect(
			io.outputs.some(
				(out) =>
					out.includes("Cannot Commit Swap") &&
					out.includes("Target menu") &&
					out.includes("2026-10-20"),
			),
		).toBe(true);
	});

	it("commits meal swap successfully when source menu exists in database", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_SWAP_VALID_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "Today's dinner will serve tomorrow's lunch menu",
			receivedAt: new Date("2026-10-20T06:00:00Z"),
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

		const compositeWithSwap: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: null,
			timingExtensions: [],
			mealChanges: [],
			mealSwaps: [
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					targetVendor: "cheftalk_regular",
				},
			],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(compositeWithSwap);

		mockStagingRepo.getMealsByDateAndSlot.mockImplementation(
			async (mealDate: string, mealSlot: string, _vendor?: string) => {
				if (mealDate === "2026-10-21" && mealSlot === "lunch") {
					return [
						{
							id: "source-1",
							mealDate: "2026-10-21",
							mealSlot: "lunch",
							vendor: "cheftalk_regular",
							items: ["Rajma", "Jeera Rice", "Boondi Raita", "Roti", "Gulab Jamun"],
						},
					];
				}
				if (mealDate === "2026-10-20" && mealSlot === "dinner") {
					return [
						{
							id: "target-1",
							mealDate: "2026-10-20",
							mealSlot: "dinner",
							vendor: "cheftalk_regular",
							items: ["Original Dal", "Original Rice"],
						},
					];
				}
				return [];
			},
		);

		// 1 (select) -> 1 (Process Announcement) -> y (Confirm & Commit) -> q (exit)
		const io = new MockIo(["1", "1", "y", "q"]);

		const controller = createController({ io });

		await controller.run();

		expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
			messageId: "MSG_SWAP_VALID_01",
			composite: compositeWithSwap,
			resolvedSwaps: [
				{
					targetMealDate: "2026-10-20",
					targetMealSlot: "dinner",
					sourceMealDate: "2026-10-21",
					sourceMealSlot: "lunch",
					vendor: "cheftalk_regular",
					newItems: ["Rajma", "Jeera Rice", "Boondi Raita", "Roti", "Gulab Jamun"],
					previousItems: ["Original Dal", "Original Rice"],
				},
			],
		});
	});

	it("allows Neovim editing of composite JSON before commit", async () => {
		const textMsg: StagedAnnouncementMessage = {
			...samplePendingPdfMessage,
			id: "MSG_EDIT_01",
			messageType: "text",
			mediaBuffer: null,
			mediaMimeType: null,
			textBody: "2028 in Hostel for lunch",
			receivedAt: new Date("2026-10-20T06:00:00Z"),
		};
		mockStagingRepo.listStagedMessages.mockResolvedValue([textMsg]);

		const initialComposite: ExtractedCompositeAnnouncement = {
			mealDate: "2026-10-20",
			location: {
				mealDate: "2026-10-20",
				mealSlot: "lunch",
				hostelBatches: ["2028"],
				collegeBatches: [],
			},
			timingExtensions: [],
			mealChanges: [],
			mealSwaps: [],
		};
		mockTextExtractor.extractAnnouncementEvents.mockResolvedValue(initialComposite);

		const editedComposite: ExtractedCompositeAnnouncement = {
			...initialComposite,
			location: {
				mealDate: "2026-10-20",
				mealSlot: "lunch",
				hostelBatches: ["2028", "2029"],
				collegeBatches: ["ALL_OTHER_BATCHES"],
			},
		};
		mockEditor.editJson.mockResolvedValue({
			success: true,
			data: editedComposite,
		});

		// 1 (select) -> 1 (Process Announcement) -> e (edit in vim) -> y (confirm) -> q (exit)
		const io = new MockIo(["1", "1", "e", "y", "q"]);

		const controller = createController({ io });

		await controller.run();

		expect(mockEditor.editJson).toHaveBeenCalledWith(
			initialComposite,
			ExtractedCompositeAnnouncementSchema,
		);
		expect(mockStagingRepo.atomicCommitComposite).toHaveBeenCalledWith({
			messageId: "MSG_EDIT_01",
			composite: editedComposite,
			resolvedSwaps: [],
		});
	});

	it("ensures io.close() is called cleanly in finally when run() exits", async () => {
		mockStagingRepo.listStagedMessages.mockResolvedValue([]);
		const io = new MockIo([]);

		const controller = createController({ io });

		await controller.run();
		expect(io.isClosed).toBe(true);
	});
});
