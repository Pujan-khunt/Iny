import { describe, it, expect, vi } from "vitest";
import { AgentLoop } from "../../../src/core/use-cases/AgentLoop";
import { ToolRegistryPort } from "../../../src/core/ports/ToolRegistryPort";
import { LLMPort } from "../../../src/core/ports/LLMPort";
import { LoggerPort } from "../../../src/core/ports/LoggerPort";
import { MessageFactory, AssistantTextMessage } from "../../../src/core/entities/Message";
import { ToolCallRequestFactory } from "../../../src/core/entities/ToolCallRequest";

describe("AgentLoop Early Termination (All-or-Nothing)", () => {
	const mockLogger: LoggerPort = {
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		debug: vi.fn(),
		fatal: vi.fn(),
		child: () => mockLogger,
	};

	it("short-circuits LLM synthesis when a single terminal tool succeeds", async () => {
		const mockToolRegistry: ToolRegistryPort = {
			getToolDefinitions: vi.fn().mockReturnValue([]),
			executeTool: vi.fn().mockResolvedValue({
				content: "*LUNCH MENU*",
				isTerminal: true,
			}),
		};

		const mockLlm: LLMPort = {
			generateResponse: vi.fn().mockResolvedValueOnce({
				type: "tool_calls",
				toolCalls: [
					ToolCallRequestFactory.createValid({
						id: "call_1",
						name: "display_mess_card",
						arguments: {},
					}),
				],
			}),
		};

		const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: "Test prompt" });
		const userMessage = MessageFactory.createUser({
			userId: "user_123",
			content: "what is for lunch",
		});
		const result = await loop.run(userMessage, [], [], mockLogger);

		expect(mockLlm.generateResponse).toHaveBeenCalledTimes(1);
		expect(result.finalText).toBe("*LUNCH MENU*");
		expect(result.sessionMessages).toHaveLength(4);
		expect(result.sessionMessages[0].role).toBe("user");
		expect(result.sessionMessages[1].role).toBe("assistant");
		expect(result.sessionMessages[2].role).toBe("tool");
		expect(result.sessionMessages[3].role).toBe("assistant");
		expect((result.sessionMessages[3] as AssistantTextMessage).content).toBe("*LUNCH MENU*");
	});

	it("concatenates outputs with canonical separator when multiple terminal tools succeed", async () => {
		const mockToolRegistry: ToolRegistryPort = {
			getToolDefinitions: vi.fn().mockReturnValue([]),
			executeTool: vi.fn().mockImplementation(async (name) => {
				if (name === "tool_a") {
					return { content: "Output A", isTerminal: true };
				}
				if (name === "tool_b") {
					return { content: "Output B", isTerminal: true };
				}
				throw new Error(`Tool "${name}" not found.`);
			}),
		};

		const mockLlm: LLMPort = {
			generateResponse: vi.fn().mockResolvedValueOnce({
				type: "tool_calls",
				toolCalls: [
					ToolCallRequestFactory.createValid({
						id: "call_a",
						name: "tool_a",
						arguments: {},
					}),
					ToolCallRequestFactory.createValid({
						id: "call_b",
						name: "tool_b",
						arguments: {},
					}),
				],
			}),
		};

		const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: "Test prompt" });
		const userMessage = MessageFactory.createUser({
			userId: "user_123",
			content: "run both terminal tools",
		});
		const result = await loop.run(userMessage, [], [], mockLogger);

		expect(mockLlm.generateResponse).toHaveBeenCalledTimes(1);
		expect(result.finalText).toBe("Output A\n\n---\n\nOutput B");
		expect(result.sessionMessages).toHaveLength(5); // user, assistantToolCall, toolA, toolB, assistantText
		expect((result.sessionMessages[4] as AssistantTextMessage).content).toBe(
			"Output A\n\n---\n\nOutput B",
		);
	});

	it("falls back to 2nd round-trip LLM synthesis when a tool throws a runtime error", async () => {
		const mockToolRegistry: ToolRegistryPort = {
			getToolDefinitions: vi.fn().mockReturnValue([]),
			executeTool: vi.fn().mockImplementation(async (name) => {
				if (name === "terminal_tool") {
					return { content: "*LUNCH MENU*", isTerminal: true };
				}
				if (name === "failing_tool") {
					throw new Error("Database timeout");
				}
				throw new Error(`Tool "${name}" not found.`);
			}),
		};

		const mockLlm: LLMPort = {
			generateResponse: vi
				.fn()
				.mockResolvedValueOnce({
					type: "tool_calls",
					toolCalls: [
						ToolCallRequestFactory.createValid({
							id: "call_1",
							name: "terminal_tool",
							arguments: {},
						}),
						ToolCallRequestFactory.createValid({
							id: "call_2",
							name: "failing_tool",
							arguments: {},
						}),
					],
				})
				.mockResolvedValueOnce({
					type: "text",
					content: "Encountered a database timeout while fetching details.",
				}),
		};

		const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: "Test prompt" });
		const userMessage = MessageFactory.createUser({
			userId: "user_123",
			content: "check lunch and details",
		});
		const result = await loop.run(userMessage, [], [], mockLogger);

		expect(mockLlm.generateResponse).toHaveBeenCalledTimes(2);
		expect(result.finalText).toBe("Encountered a database timeout while fetching details.");
		expect(
			(result.sessionMessages[result.sessionMessages.length - 1] as AssistantTextMessage).content,
		).toBe("Encountered a database timeout while fetching details.");
	});

	it("falls back to 2nd round-trip LLM synthesis when any executed tool is non-terminal", async () => {
		const mockToolRegistry: ToolRegistryPort = {
			getToolDefinitions: vi.fn().mockReturnValue([]),
			executeTool: vi.fn().mockImplementation(async (name) => {
				if (name === "terminal_tool") {
					return { content: "*LUNCH MENU*", isTerminal: true };
				}
				if (name === "query_tool") {
					return { content: "Timing: 12:30 PM - 02:30 PM", isTerminal: false };
				}
				throw new Error(`Tool "${name}" not found.`);
			}),
		};

		const mockLlm: LLMPort = {
			generateResponse: vi
				.fn()
				.mockResolvedValueOnce({
					type: "tool_calls",
					toolCalls: [
						ToolCallRequestFactory.createValid({
							id: "call_1",
							name: "terminal_tool",
							arguments: {},
						}),
						ToolCallRequestFactory.createValid({
							id: "call_2",
							name: "query_tool",
							arguments: {},
						}),
					],
				})
				.mockResolvedValueOnce({
					type: "text",
					content: "Here is your lunch menu along with the timings.",
				}),
		};

		const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: "Test prompt" });
		const userMessage = MessageFactory.createUser({
			userId: "user_123",
			content: "menu and timings",
		});
		const result = await loop.run(userMessage, [], [], mockLogger);

		expect(mockLlm.generateResponse).toHaveBeenCalledTimes(2);
		expect(result.finalText).toBe("Here is your lunch menu along with the timings.");
	});

	it("falls back to 2nd round-trip LLM synthesis when a tool call has malformed arguments", async () => {
		const mockToolRegistry: ToolRegistryPort = {
			getToolDefinitions: vi.fn().mockReturnValue([]),
			executeTool: vi.fn().mockResolvedValue({
				content: "*LUNCH MENU*",
				isTerminal: true,
			}),
		};

		const mockLlm: LLMPort = {
			generateResponse: vi
				.fn()
				.mockResolvedValueOnce({
					type: "tool_calls",
					toolCalls: [
						ToolCallRequestFactory.createValid({
							id: "call_1",
							name: "terminal_tool",
							arguments: {},
						}),
						ToolCallRequestFactory.createMalformed({
							id: "call_2",
							name: "malformed_tool",
							rawArguments: "{bad_json",
							parseError: "Unexpected token in JSON",
						}),
					],
				})
				.mockResolvedValueOnce({
					type: "text",
					content: "A tool argument was malformed so I synthesized a recovery response.",
				}),
		};

		const loop = new AgentLoop(mockLlm, mockToolRegistry, { systemPrompt: "Test prompt" });
		const userMessage = MessageFactory.createUser({
			userId: "user_123",
			content: "trigger malformed tool",
		});
		const result = await loop.run(userMessage, [], [], mockLogger);

		expect(mockLlm.generateResponse).toHaveBeenCalledTimes(2);
		expect(result.finalText).toBe(
			"A tool argument was malformed so I synthesized a recovery response.",
		);
	});
});
