import { describe, it, expect } from "vitest";
import { TriageMenuRenderer } from "../../../../src/adapters/inbound/cli/TriageMenuRenderer";
import type { StagedAnnouncementMessage } from "../../../../src/core/ports/MessStagingRepositoryPort";

describe("TriageMenuRenderer", () => {
	const renderer = new TriageMenuRenderer({ enableAnsi: false });

	const mockMessage: StagedAnnouncementMessage = {
		id: "MSG_MENU_001",
		senderAddress: "+919876543210",
		senderAddressType: "pn",
		messageType: "document",
		mediaMimeType: "application/pdf",
		mediaBuffer: Buffer.from("%PDF-1.4 test"),
		textBody: "MENU OCT 4-10.pdf",
		status: "pending",
		receivedAt: new Date("2026-10-08T06:12:15.000Z"),
		processedAt: null,
	};

	it("renders empty messages table", () => {
		const table = renderer.renderMessagesTable([]);
		expect(table).toContain("0 messages");
		expect(table).toContain("No staged food announcement messages found.");
	});

	it("renders populated messages table", () => {
		const table = renderer.renderMessagesTable([mockMessage]);
		expect(table).toContain("1 messages");
		expect(table).toContain("MSG_MENU_001");
		expect(table).toContain("+919876543210 (pn)");
		expect(table).toContain("document (pdf)");
	});

	it("renders inspection card with intent and without intent", () => {
		const withIntent = renderer.renderInspectionCard(mockMessage, "Weekly Menu", "1");
		expect(withIntent).toContain("MESSAGE INSPECTION & CONFIRMATION");
		expect(withIntent).toContain("Selected Action:[1] Weekly Menu");

		const withoutIntent = renderer.renderInspectionCard(mockMessage);
		expect(withoutIntent).toContain("MESSAGE INSPECTION");
		expect(withoutIntent).not.toContain("CONFIRMATION");
	});

	it("renders extraction error card with details", () => {
		const errorCard = renderer.renderExtractionErrorCard(
			new Error("Failed to parse"),
			"MSG_MENU_001",
		);
		expect(errorCard).toContain("EXTRACTION ENCOUNTERED AN ERROR");
		expect(errorCard).toContain("Failed to parse");
		expect(errorCard).toContain("Target Message:MSG_MENU_001");
	});

	it("renders ignore preview", () => {
		const preview = renderer.renderIgnorePreview(mockMessage);
		expect(preview).toContain("IGNORE STAGED MESSAGE");
		expect(preview).toContain("MSG_MENU_001");
	});

	it("renders processed message card", () => {
		const card = renderer.renderProcessedMessageCard({
			...mockMessage,
			status: "processed",
			processedAt: new Date("2026-10-08T07:00:00.000Z"),
		});
		expect(card).toContain("PROCESSED MESSAGE ACTIONS");
		expect(card).toContain("MSG_MENU_001");
		expect(card).toContain("Undo / Revert Ingestion");
	});
});
