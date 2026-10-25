import { Message, UserMessage, MessageFactory, ToolResultMessage } from "../entities/Message";
import { ToolCallRequest } from "../entities/ToolCallRequest";
import { LLMPort } from "../ports/LLMPort";
import { ToolRegistryPort, ToolDefinition, ToolResult } from "../ports/ToolRegistryPort";
import { LoggerPort } from "../ports/LoggerPort";
import { buildTemporallyGroundedSystemPrompt } from "../utils/Temporal";

/** Configuration options for the iterative agent loop. */
export interface AgentLoopConfig {
	systemPrompt: string;
	maxToolIterations?: number;
}
/** Outcome of the agent loop execution including final text, reasoning, and session history. */
export interface AgentLoopResult {
	finalText: string;
	reasoning: string[];
	sessionMessages: Message[];
}
interface ToolExecutionOutcome {
	readonly message: ToolResultMessage;
	readonly toolResult: ToolResult;
	readonly isError: boolean;
}

const shouldTerminateEarly = (outcomes: readonly ToolExecutionOutcome[]): boolean =>
	outcomes.length > 0 && outcomes.every((o) => !o.isError && o.toolResult.isTerminal === true);
const formatTerminalToolOutputs = (outcomes: readonly ToolExecutionOutcome[]): string =>
	outcomes.map((o) => o.toolResult.content).join("\n\n---\n\n");

const toResult = (
	userId: string,
	content: string,
	reasoning: string[],
	session: Message[],
	resReasoning?: string,
): AgentLoopResult => {
	session.push(MessageFactory.createAssistantText({ userId, content, reasoning: resReasoning }));
	return { finalText: content, reasoning, sessionMessages: session };
};

const createToolOutcome = (
	userId: string,
	tc: ToolCallRequest,
	content: string,
	isError: boolean,
	res?: ToolResult,
): ToolExecutionOutcome => ({
	message: MessageFactory.createToolResult({ userId, toolCallId: tc.id, name: tc.name, content }),
	toolResult: res ?? { content, isTerminal: false },
	isError,
});

/** Multi-turn tool-calling LLM reasoning loop orchestrator. */
export class AgentLoop {
	private readonly maxIters: number;
	private readonly prompt: string;

	constructor(
		private readonly llm: LLMPort,
		private readonly registry: ToolRegistryPort,
		config: AgentLoopConfig,
	) {
		this.prompt = config.systemPrompt;
		this.maxIters = config.maxToolIterations ?? 5;
	}

	/** Executes the conversational loop until text is synthesized or iterations expire. */
	async run(
		userMessage: UserMessage,
		history: Message[],
		tools: ToolDefinition[],
		log: LoggerPort,
	): Promise<AgentLoopResult> {
		const prompt = buildTemporallyGroundedSystemPrompt(this.prompt, userMessage.timestamp);
		const session: Message[] = [userMessage];
		const reasoning: string[] = [];
		const { userId } = userMessage;

		for (let i = 0; i < this.maxIters; i++) {
			const res = await this.llm.generateResponse(prompt, [...history, ...session], tools);
			if (res.reasoning?.trim()) {
				reasoning.push(res.reasoning);
				log.debug("Model reasoning step", { reasoning: res.reasoning, iteration: i });
			}
			if (res.type === "text") {
				const text = res.content.trim() || "I apologize, but I was unable to formulate a response.";
				return toResult(userId, text, reasoning, session, res.reasoning);
			}
			session.push(MessageFactory.createAssistantToolCall({ userId, ...res }));
			const outcomes = await Promise.all(
				res.toolCalls.map((tc) => this.executeToolCall(userId, tc, log)),
			);
			session.push(...outcomes.map((o) => o.message));
			if (shouldTerminateEarly(outcomes)) {
				return toResult(userId, formatTerminalToolOutputs(outcomes), reasoning, session);
			}
		}

		const msgs = [...history, ...session];
		return this.circuitBreaker(userId, msgs, tools, log, reasoning, prompt, session);
	}

	private async executeToolCall(
		userId: string,
		tc: ToolCallRequest,
		log: LoggerPort,
	): Promise<ToolExecutionOutcome> {
		if (tc.type === "malformed") {
			log.warn("Tool call arguments were malformed", undefined, {
				toolName: tc.name,
				parseError: tc.parseError,
			});
			const err = `Error executing tool '${tc.name}': Failed to parse tool arguments: ${tc.parseError}`;
			return createToolOutcome(userId, tc, err, true);
		}
		try {
			log.info("Executing tool call", { toolName: tc.name });
			const res = await this.registry.executeTool(tc.name, tc.arguments);
			return createToolOutcome(userId, tc, res.content, false, res);
		} catch (error) {
			const msg = error instanceof Error ? error.message : String(error);
			log.warn("Tool execution failed", error, { toolName: tc.name });
			return createToolOutcome(userId, tc, `Error executing tool '${tc.name}': ${msg}`, true);
		}
	}

	private async circuitBreaker(
		userId: string,
		msgs: Message[],
		tools: ToolDefinition[],
		log: LoggerPort,
		reasoning: string[],
		prompt: string,
		session: Message[],
	): Promise<AgentLoopResult> {
		log.warn("Max tool iterations reached, forcing synthesis", undefined, {
			maxIterations: this.maxIters,
		});
		const forced = await this.llm.generateResponse(prompt, msgs, tools, { forcedSynthesis: true });
		if (forced.reasoning?.trim()) {
			reasoning.push(forced.reasoning);
			log.debug("Model circuit-breaker reasoning step", { reasoning: forced.reasoning });
		}
		const fallback =
			"I've reached the maximum number of tool iterations and was unable to complete your request.";
		const text = (forced.type === "text" && forced.content.trim()) || fallback;
		return toResult(userId, text, reasoning, session, forced.reasoning);
	}
}
