import OpenAI from "openai";
import {
	Message,
	UserMessage,
	AssistantMessage,
	AssistantTextMessage,
	AssistantToolCallMessage,
	ToolResultMessage,
} from "../../../core/entities/Message";
import { formatHistoricalMessageTimeIST } from "../../../core/utils/Temporal";

export type DeepseekAssistantMessageParam = OpenAI.Chat.ChatCompletionAssistantMessageParam & {
	reasoning_content?: string | null;
};

/**
 * Maps system prompt and domain messages into OpenAI ChatCompletion message parameters.
 *
 * @param systemPrompt The system prompt instructions for the model.
 * @param messages The chronological sequence of domain messages.
 * @returns Array of OpenAI ChatCompletion message parameters.
 */
export function mapDomainMessagesToOpenAI(
	systemPrompt: string,
	messages: Message[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
	const lastUserIndex = findLastUserIndex(messages);
	return [
		{ role: "system", content: systemPrompt },
		...messages.map((msg, index) => mapSingleMessage(msg, index === lastUserIndex)),
	];
}

/**
 * Finds the index of the latest UserMessage in the chronological sequence.
 */
function findLastUserIndex(messages: Message[]): number {
	for (let i = messages.length - 1; i >= 0; i--) {
		if (messages[i].role === "user") return i;
	}
	return -1;
}

/**
 * Maps an individual domain message into an OpenAI ChatCompletion message parameter.
 *
 * @param msg The domain message to map.
 * @param isLatest Whether this is the latest (active) message in the chronological sequence.
 * @returns The corresponding OpenAI ChatCompletion message parameter.
 */
function mapSingleMessage(msg: Message, isLatest: boolean): OpenAI.Chat.ChatCompletionMessageParam {
	switch (msg.role) {
		case "user":
			return mapUserMessage(msg, isLatest);
		case "assistant":
			return mapAssistantMessage(msg);
		case "tool":
			return mapToolResultMessage(msg);
		default:
			return assertNever(msg);
	}
}

/**
 * Maps a UserMessage entity to an OpenAI user message parameter.
 * Historical messages are prefixed with their IST send timestamp.
 */
function mapUserMessage(
	msg: UserMessage,
	isLatest: boolean,
): OpenAI.Chat.ChatCompletionUserMessageParam {
	const prefix = isLatest ? "" : `[Sent: ${formatHistoricalMessageTimeIST(msg.timestamp)}] `;
	return {
		role: "user",
		content: `${prefix}${msg.content}`,
	};
}

/**
 * Dispatches an AssistantMessage to either text or tool-call mapping based on the presence of toolCalls.
 */
function mapAssistantMessage(msg: AssistantMessage): DeepseekAssistantMessageParam {
	if (msg.toolCalls !== undefined) {
		return mapAssistantToolCallMessage(msg);
	}
	return mapAssistantTextMessage(msg);
}

/**
 * Maps an AssistantTextMessage entity to an OpenAI/DeepSeek assistant message parameter.
 */
function mapAssistantTextMessage(msg: AssistantTextMessage): DeepseekAssistantMessageParam {
	return {
		role: "assistant",
		content: msg.content,
		...(typeof msg.reasoning === "string" ? { reasoning_content: msg.reasoning } : {}),
	};
}

/**
 * Maps an AssistantToolCallMessage entity to an OpenAI/DeepSeek assistant message parameter,
 * formatting tool calls and preserving chain-of-thought reasoning in `reasoning_content`
 * as required by the DeepSeek API.
 */
function mapAssistantToolCallMessage(msg: AssistantToolCallMessage): DeepseekAssistantMessageParam {
	const hasContent = typeof msg.content === "string" && msg.content.trim() !== "";
	return {
		role: "assistant",
		content: hasContent ? msg.content : null,
		tool_calls: msg.toolCalls.map((tc) => ({
			id: tc.id,
			type: "function" as const,
			function: {
				name: tc.name,
				arguments: tc.type === "valid" ? JSON.stringify(tc.arguments) : tc.rawArguments,
			},
		})),
		...(typeof msg.reasoning === "string" ? { reasoning_content: msg.reasoning } : {}),
	};
}

/**
 * Maps a ToolResultMessage entity to an OpenAI tool message parameter.
 */
function mapToolResultMessage(msg: ToolResultMessage): OpenAI.Chat.ChatCompletionToolMessageParam {
	return {
		role: "tool",
		tool_call_id: msg.toolCallId,
		content: msg.content,
	};
}

/**
 * Pure assertion helper for compile-time exhaustiveness checks.
 *
 * @throws Error if invoked at runtime with an unhandled discriminated union variant.
 */
function assertNever(x: never): never {
	throw new Error(`Unhandled message: ${JSON.stringify(x)}`);
}
