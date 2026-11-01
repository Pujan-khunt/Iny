import { describe, it, expect } from "vitest";
import { mapDomainMessagesToOpenAI } from "../../../../src/adapters/outbound/llm/DeepseekRequestMapper";
import {
	Message,
	MessageFactory,
	AssistantTextMessage,
	ToolResultMessage,
} from "../../../../src/core/entities/Message";

describe("DeepseekRequestMapper", () => {
	describe("mapDomainMessagesToOpenAI", () => {
		it("should map system prompt and user message", () => {
			const messages: Message[] = [
				{ id: "1", userId: "u1", role: "user", content: "hello", timestamp: new Date() },
			];
			const result = mapDomainMessagesToOpenAI("You are Iny", messages);
			expect(result).toEqual([
				{ role: "system", content: "You are Iny" },
				{ role: "user", content: "hello" },
			]);
		});

		it("should map assistant text message with and without reasoning", () => {
			const textWithoutReasoning: AssistantTextMessage = {
				id: "2",
				userId: "u1",
				role: "assistant",
				content: "General response",
				timestamp: new Date(),
			};
			const textWithReasoning: AssistantTextMessage = {
				id: "3",
				userId: "u1",
				role: "assistant",
				content: "Reasoned response",
				reasoning: "deep thinking",
				timestamp: new Date(),
			};

			const result = mapDomainMessagesToOpenAI("System", [textWithoutReasoning, textWithReasoning]);
			expect(result[1]).toEqual({
				role: "assistant",
				content: "General response",
			});
			expect(result[2]).toMatchObject({
				role: "assistant",
				content: "Reasoned response",
				reasoning_content: "deep thinking",
			});
		});

		it("should map assistant with reasoning and valid tool calls", () => {
			const messages: Message[] = [
				{
					id: "4",
					userId: "u1",
					role: "assistant",
					reasoning: "thinking step",
					toolCalls: [{ type: "valid", id: "c1", name: "calc", arguments: { expr: "2+2" } }],
					timestamp: new Date(),
				},
			];
			const result = mapDomainMessagesToOpenAI("System", messages);
			expect(result[1]).toMatchObject({
				role: "assistant",
				content: null,
				reasoning_content: "thinking step",
				tool_calls: [
					{
						id: "c1",
						type: "function",
						function: { name: "calc", arguments: '{"expr":"2+2"}' },
					},
				],
			});
		});

		it("should map assistant with both natural content and reasoning alongside tool calls", () => {
			const messages: Message[] = [
				{
					id: "4b",
					userId: "u1",
					role: "assistant",
					content: "Let me run that computation.",
					reasoning: "Detailed plan",
					toolCalls: [{ type: "valid", id: "c1", name: "calc", arguments: { expr: "2+2" } }],
					timestamp: new Date(),
				},
			];
			const result = mapDomainMessagesToOpenAI("System", messages);
			expect(result[1]).toMatchObject({
				role: "assistant",
				content: "Let me run that computation.",
				reasoning_content: "Detailed plan",
				tool_calls: [
					{
						id: "c1",
						type: "function",
						function: { name: "calc", arguments: '{"expr":"2+2"}' },
					},
				],
			});
		});

		it("should preserve empty reasoning string as reasoning_content", () => {
			const messages: Message[] = [
				{
					id: "4c",
					userId: "u1",
					role: "assistant",
					content: "Direct answer",
					reasoning: "",
					timestamp: new Date(),
				},
			];
			const result = mapDomainMessagesToOpenAI("System", messages);
			expect(result[1]).toMatchObject({
				role: "assistant",
				content: "Direct answer",
				reasoning_content: "",
			});
		});

		it("should map assistant with malformed tool call using raw unparsed arguments", () => {
			const messages: Message[] = [
				{
					id: "5",
					userId: "u1",
					role: "assistant",
					toolCalls: [
						{
							type: "malformed",
							id: "c2",
							name: "calc",
							rawArguments: '{"expr": 2+',
							parseError: "Unexpected end of JSON input",
						},
					],
					timestamp: new Date(),
				},
			];
			const result = mapDomainMessagesToOpenAI("System", messages);
			const assistantMsg = result[1] as any;
			expect(assistantMsg.tool_calls[0]).toEqual({
				id: "c2",
				type: "function",
				function: {
					name: "calc",
					arguments: '{"expr": 2+',
				},
			});
		});

		it("should map tool message to tool role with tool_call_id and content", () => {
			const toolMsg: ToolResultMessage = {
				id: "6",
				userId: "u1",
				role: "tool",
				toolCallId: "c1",
				name: "calc",
				content: "4",
				timestamp: new Date(),
			};
			const result = mapDomainMessagesToOpenAI("System", [toolMsg]);
			expect(result[1]).toEqual({
				role: "tool",
				tool_call_id: "c1",
				content: "4",
			});
		});

		it("prefixes historical UserMessages with [Sent: YYYY-MM-DD HH:mm IST] but leaves the latest UserMessage untouched", () => {
			const historicalUser = MessageFactory.createUser({
				userId: "user-1",
				content: "Today's lunch",
				timestamp: new Date("2026-10-30T07:19:00.000Z"), // 12:49 IST
			});
			const assistantReply = MessageFactory.createAssistantText({
				userId: "user-1",
				content: "Here is Friday lunch",
			});
			const currentUser = MessageFactory.createUser({
				userId: "user-1",
				content: "Today's lunch",
				timestamp: new Date("2026-10-31T07:03:00.000Z"), // 12:33 IST
			});

			const result = mapDomainMessagesToOpenAI("System Prompt", [
				historicalUser,
				assistantReply,
				currentUser,
			]);

			expect(result[1]).toEqual({
				role: "user",
				content: "[Sent: 2026-10-30 12:49 IST] Today's lunch",
			});
			expect(result[3]).toEqual({
				role: "user",
				content: "Today's lunch",
			});
		});

		it("leaves the active UserMessage untouched during multi-turn tool execution when followed by assistant tool calls and tool results", () => {
			const historicalUser = MessageFactory.createUser({
				userId: "user-1",
				content: "Yesterday's query",
				timestamp: new Date("2026-10-30T07:19:00.000Z"),
			});
			const historicalReply = MessageFactory.createAssistantText({
				userId: "user-1",
				content: "Yesterday's answer",
			});
			const activeUser = MessageFactory.createUser({
				userId: "user-1",
				content: "Active query",
				timestamp: new Date("2026-10-31T07:03:00.000Z"),
			});
			const activeToolCall = MessageFactory.createAssistantToolCall({
				userId: "user-1",
				toolCalls: [{ type: "valid", id: "call_1", name: "query_mess_details", arguments: {} }],
			});
			const activeToolResult = MessageFactory.createToolResult({
				userId: "user-1",
				toolCallId: "call_1",
				name: "query_mess_details",
				content: '{"menu": "test"}',
			});

			const result = mapDomainMessagesToOpenAI("System Prompt", [
				historicalUser,
				historicalReply,
				activeUser,
				activeToolCall,
				activeToolResult,
			]);

			expect(result[1]).toEqual({
				role: "user",
				content: "[Sent: 2026-10-30 12:49 IST] Yesterday's query",
			});
			expect(result[3]).toEqual({
				role: "user",
				content: "Active query",
			});
		});

		it("should throw when an unhandled message role is passed at runtime", () => {
			const invalidMsg = {
				id: "7",
				userId: "u1",
				role: "unknown" as any,
				content: "invalid",
				timestamp: new Date(),
			};
			expect(() => mapDomainMessagesToOpenAI("System", [invalidMsg as Message])).toThrow(
				/Unhandled message:/,
			);
		});
	});
});
