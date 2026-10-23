import { Message, UserMessage, MessageFactory, ToolResultMessage } from "../entities/Message";
import {
	ToolCallRequest,
	ValidToolCallRequest,
	MalformedToolCallRequest,
} from "../entities/ToolCallRequest";
import { LLMPort } from "../ports/LLMPort";
import { ToolRegistryPort, ToolDefinition, ToolResult } from "../ports/ToolRegistryPort";
import { LoggerPort } from "../ports/LoggerPort";

/**
 * Configuration options for the ReAct reasoning agent loop.
 */
export interface AgentLoopConfig {
	/** Static system prompt instructing the language model on persona and rules. */
	systemPrompt: string;
	/** Maximum number of tool execution cycles before forcing text synthesis. Defaults to 5. */
	maxToolIterations?: number;
}

/**
 * Encapsulates the outcome of an AgentLoop execution cycle.
 */
export interface AgentLoopResult {
	/** The final natural language response synthesized by the model or terminal tool. */
	finalText: string;
	/** All chain-of-thought reasoning scratchpads emitted across all iterations of this turn. */
	reasoning: string[];
	/** All messages generated during this turn (user message, assistant tool calls, tool results, final text). */
	sessionMessages: Message[];
}

/**
 * Internal execution outcome for a single tool call request.
 */
export interface ToolExecutionOutcome {
	/** The formatted ToolResultMessage entity for conversational history. */
	readonly message: ToolResultMessage;
	/** The raw ToolResult returned by the tool implementation. */
	readonly toolResult: ToolResult;
	/** Whether the tool execution resulted in an error (runtime exception or argument malformation). */
	readonly isError: boolean;
}

/** Separator used to concatenate multiple terminal tool outputs into a single message. */
export const TERMINAL_OUTPUT_SEPARATOR = "\n\n---\n\n";

/**
 * Formats a message timestamp into a standardized Indian Standard Time (IST) string.
 *
 * @param timestamp Date object, timestamp number, or ISO string.
 * @returns Human-readable IST timestamp formatted for system prompt grounding.
 */
export function formatMessageTimeIST(timestamp?: Date | number | string): string {
	const date = timestamp instanceof Date ? timestamp : new Date(timestamp ?? Date.now());
	return date.toLocaleString("en-IN", {
		timeZone: "Asia/Kolkata",
		dateStyle: "full",
		timeStyle: "medium",
	});
}

/**
 * Injects temporal grounding context into the base system prompt.
 *
 * @param baseSystemPrompt Base system instructions.
 * @param timestamp Message timestamp to format in IST.
 * @returns System prompt appended with temporal grounding metadata.
 */
export function buildTemporallyGroundedSystemPrompt(
	baseSystemPrompt: string,
	timestamp?: Date | number | string,
): string {
	const istString = formatMessageTimeIST(timestamp);
	return `${baseSystemPrompt}\n\n[Current Time (IST): ${istString}]`;
}

/**
 * Evaluates the All-or-Nothing Early Termination condition:
 * Early termination applies if and only if at least one tool call was executed,
 * every executed tool succeeded without errors, and every executed tool is terminal.
 *
 * @param outcomes Execution outcomes of all tool calls in the current iteration batch.
 * @returns True if early termination conditions are satisfied, false otherwise.
 */
export function shouldTerminateEarly(outcomes: readonly ToolExecutionOutcome[]): boolean {
	return (
		outcomes.length > 0 &&
		outcomes.every((outcome) => !outcome.isError && outcome.toolResult.isTerminal === true)
	);
}

/**
 * Formats all terminal tool execution outputs into a combined response string.
 *
 * @param outcomes Execution outcomes of terminal tools.
 * @returns Concatenated terminal tool contents separated by the canonical separator.
 */
export function formatTerminalToolOutputs(outcomes: readonly ToolExecutionOutcome[]): string {
	return outcomes.map((outcome) => outcome.toolResult.content).join(TERMINAL_OUTPUT_SEPARATOR);
}

/**
 * Pure domain service executing the ReAct (Reasoning + Acting) loop.
 * Coordinates multi-turn LLM reasoning, concurrent tool execution via Promise.all,
 * malformed argument reflection, all-or-nothing early termination, and circuit-breaker forced synthesis.
 */
export class AgentLoop {
	private readonly maxToolIterations: number;
	private readonly systemPrompt: string;

	/**
	 * Initializes a new AgentLoop domain service instance.
	 *
	 * @param llm Outbound port for interacting with the language model provider.
	 * @param registry Outbound port for discovering and executing domain tools.
	 * @param config Agent loop operational parameters (system prompt, iteration limit).
	 */
	constructor(
		private readonly llm: LLMPort,
		private readonly registry: ToolRegistryPort,
		config: AgentLoopConfig,
	) {
		this.systemPrompt = config.systemPrompt;
		this.maxToolIterations = config.maxToolIterations ?? 5;
	}

	/**
	 * Runs the ReAct reasoning loop until a terminal tool triggers early termination,
	 * the model produces a text response, or the loop reaches max iterations.
	 *
	 * @param userMessage Inbound user message triggering this dialogue exchange.
	 * @param history Prior dialogue turns loaded from conversation history.
	 * @param tools Available tool definitions formatted for model function calling.
	 * @param log Request-scoped structured logger.
	 * @returns Synthesized final text, reasoning trace, and all turn session messages.
	 */
	async run(
		userMessage: UserMessage,
		history: Message[],
		tools: ToolDefinition[],
		log: LoggerPort,
	): Promise<AgentLoopResult> {
		const effectiveSystemPrompt = buildTemporallyGroundedSystemPrompt(
			this.systemPrompt,
			userMessage.timestamp,
		);

		const sessionMessages: Message[] = [userMessage];
		const reasoning: string[] = [];
		let iteration = 0;

		while (iteration < this.maxToolIterations) {
			const workingMessages = [...history, ...sessionMessages];
			const response = await this.llm.generateResponse(
				effectiveSystemPrompt,
				workingMessages,
				tools,
			);

			if (response.reasoning && response.reasoning.trim() !== "") {
				reasoning.push(response.reasoning);
				log.debug("Model reasoning step", { reasoning: response.reasoning, iteration });
			}

			if (response.type === "text") {
				const content =
					response.content.trim() !== ""
						? response.content
						: "I apologize, but I was unable to formulate a response.";
				const assistantMessage = MessageFactory.createAssistantText({
					userId: userMessage.userId,
					content,
					reasoning: response.reasoning,
				});
				sessionMessages.push(assistantMessage);
				return { finalText: content, reasoning, sessionMessages };
			}

			// Handle tool calls step
			const toolCallMessage = MessageFactory.createAssistantToolCall({
				userId: userMessage.userId,
				toolCalls: response.toolCalls,
				content: response.content,
				reasoning: response.reasoning,
			});
			sessionMessages.push(toolCallMessage);

			const toolExecutionResults = await this.executeToolsConcurrently(
				userMessage.userId,
				response.toolCalls,
				log,
			);
			sessionMessages.push(...toolExecutionResults.map((r) => r.message));

			// All-or-Nothing Early Termination Check
			if (shouldTerminateEarly(toolExecutionResults)) {
				const finalContent = formatTerminalToolOutputs(toolExecutionResults);

				const assistantMessage = MessageFactory.createAssistantText({
					userId: userMessage.userId,
					content: finalContent,
				});
				sessionMessages.push(assistantMessage);

				return {
					finalText: finalContent,
					reasoning,
					sessionMessages,
				};
			}

			iteration++;
		}

		// Circuit breaker forced synthesis
		return this.handleCircuitBreaker(
			userMessage.userId,
			history,
			sessionMessages,
			tools,
			log,
			reasoning,
			effectiveSystemPrompt,
		);
	}

	/**
	 * Concurrently executes multiple tool calls requested by the model.
	 * Isolates failures and returns structured ToolExecutionOutcome results.
	 */
	private async executeToolsConcurrently(
		userId: string,
		toolCalls: ToolCallRequest[],
		log: LoggerPort,
	): Promise<ToolExecutionOutcome[]> {
		return Promise.all(
			toolCalls.map((toolCall) => this.executeSingleToolCall(userId, toolCall, log)),
		);
	}

	/**
	 * Dispatches a single tool call depending on whether it is malformed or valid.
	 */
	private async executeSingleToolCall(
		userId: string,
		toolCall: ToolCallRequest,
		log: LoggerPort,
	): Promise<ToolExecutionOutcome> {
		if (toolCall.type === "malformed") {
			return this.handleMalformedToolCall(userId, toolCall, log);
		}
		return this.executeValidToolCall(userId, toolCall, log);
	}

	/**
	 * Handles a malformed tool call where JSON arguments failed schema parsing.
	 */
	private handleMalformedToolCall(
		userId: string,
		toolCall: MalformedToolCallRequest,
		log: LoggerPort,
	): ToolExecutionOutcome {
		log.warn("Tool call arguments were malformed", undefined, {
			toolName: toolCall.name,
			parseError: toolCall.parseError,
		});
		const content = `Error executing tool '${toolCall.name}': Failed to parse tool arguments: ${toolCall.parseError}`;
		const message = MessageFactory.createToolResult({
			userId,
			toolCallId: toolCall.id,
			name: toolCall.name,
			content,
		});
		return {
			message,
			toolResult: { content, isTerminal: false },
			isError: true,
		};
	}

	/**
	 * Executes a valid tool call through the tool registry, catching runtime errors gracefully.
	 */
	private async executeValidToolCall(
		userId: string,
		toolCall: ValidToolCallRequest,
		log: LoggerPort,
	): Promise<ToolExecutionOutcome> {
		try {
			log.info("Executing tool call", { toolName: toolCall.name });
			const toolResult = await this.registry.executeTool(toolCall.name, toolCall.arguments);
			const message = MessageFactory.createToolResult({
				userId,
				toolCallId: toolCall.id,
				name: toolCall.name,
				content: toolResult.content,
			});
			return {
				message,
				toolResult,
				isError: false,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			log.warn("Tool execution failed", error, { toolName: toolCall.name });
			const content = `Error executing tool '${toolCall.name}': ${errorMessage}`;
			const message = MessageFactory.createToolResult({
				userId,
				toolCallId: toolCall.id,
				name: toolCall.name,
				content,
			});
			return {
				message,
				toolResult: { content, isTerminal: false },
				isError: true,
			};
		}
	}

	/**
	 * Handles the circuit breaker condition when max tool iterations is reached.
	 * Forces the model to synthesize a final natural language answer without further tool calls.
	 */
	private async handleCircuitBreaker(
		userId: string,
		history: Message[],
		sessionMessages: Message[],
		tools: ToolDefinition[],
		log: LoggerPort,
		reasoning: string[],
		effectiveSystemPrompt: string,
	): Promise<AgentLoopResult> {
		log.warn("Max tool iterations reached, forcing synthesis", undefined, {
			maxIterations: this.maxToolIterations,
		});

		const workingMessages = [...history, ...sessionMessages];
		const forcedResponse = await this.llm.generateResponse(
			effectiveSystemPrompt,
			workingMessages,
			tools,
			{ forcedSynthesis: true },
		);

		if (forcedResponse.reasoning && forcedResponse.reasoning.trim() !== "") {
			reasoning.push(forcedResponse.reasoning);
			log.debug("Model circuit-breaker reasoning step", { reasoning: forcedResponse.reasoning });
		}

		const rawContent = forcedResponse.type === "text" ? forcedResponse.content : "";
		const content =
			rawContent.trim() !== ""
				? rawContent
				: "I've reached the maximum number of tool iterations and was unable to complete your request.";

		const assistantMessage = MessageFactory.createAssistantText({
			userId,
			content,
			reasoning: forcedResponse.reasoning,
		});
		sessionMessages.push(assistantMessage);

		return { finalText: content, reasoning, sessionMessages };
	}
}
