import { DialogueTurn } from "../../../../core/entities/DialogueTurn";
import { Message } from "../../../../core/entities/Message";

function isAssistantTextMessage(msg: unknown): boolean {
	return Boolean(
		msg &&
		typeof msg === "object" &&
		"role" in msg &&
		msg.role === "assistant" &&
		!("toolCalls" in msg && msg.toolCalls !== undefined),
	);
}

function assertTurnMessages(msgs: Message[]): void {
	if (!Array.isArray(msgs) || msgs.length < 2) {
		throw new Error(`Invalid turn: expected at least 2 messages, got ${msgs.length}`);
	}

	const first = msgs[0];
	if (first.role !== "user") {
		throw new Error(`Invalid turn: first message must be UserMessage, got role '${first.role}'`);
	}

	const last = msgs[msgs.length - 1];
	if (!isAssistantTextMessage(last)) {
		const roleDesc = last.role === "assistant" ? "AssistantToolCallMessage" : `role '${last.role}'`;
		throw new Error(`Invalid turn: final message must be AssistantTextMessage, got ${roleDesc}`);
	}
}

function assertTurnTimestamps(startedAt: Date, completedAt: Date): void {
	if (completedAt.getTime() < startedAt.getTime()) {
		throw new Error(
			`Invalid turn: completedAt cannot precede startedAt (${completedAt.toISOString()} < ${startedAt.toISOString()})`,
		);
	}
}

/**
 * Validates dialogue turn structural and temporal invariants.
 */
export function assertValidDialogueTurn(turn: DialogueTurn): void {
	assertTurnMessages(turn.messages);
	assertTurnTimestamps(turn.startedAt, turn.completedAt);
}
