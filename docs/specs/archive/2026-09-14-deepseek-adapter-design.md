# Deepseek LLM Adapter Design

## 1. Overview
This document specifies the design for the Deepseek LLM Adapter, which serves as the "brain" for Iny. It implements the `LLMPort` to allow the core business logic to generate responses and execute function calls (tools) using the deepseek-flash model.

## 2. Configuration & Zod (Fail-Fast)
To ensure the application fails immediately if required environment variables are missing or malformed, we will introduce `zod`.
- **Environment Injection:** We will NOT use the `dotenv` package. Instead, we will rely on Node's native `--env-file=.env` CLI flag. `package.json` scripts must be updated to include this flag.
  - Development (`npm run dev`): `"tsx --env-file=.env src/index.ts"`
  - Production (`npm start`): `"node --env-file=.env dist/index.js"` (after building via `tsc -p tsconfig.build.json`)
  - Note: Vitest automatically loads `.env` files for testing.
- **File:** `src/config.ts`
- **Responsibility:** Parse `process.env` on startup. Ensure `DEEPSEEK_API_KEY` is present. Export a strictly typed `config` object.

## 3. Core Modifications (Business Rules)
Since the system persona (how the bot behaves) is a business rule, it must originate from the Core Use Case, not the infrastructure adapter.
- **`LLMPort.ts`**: The `generateResponse` method signature will be updated to accept a `systemPrompt: string` as its first argument.
- **`ProcessIncomingMessage.ts`**: The Use Case will pass the following system prompt to the LLMPort: 
  *"You are Iny, a friendly and highly concise assistant for college students. Never use emojis and keep answers under 2 sentences."*

## 4. Deepseek Adapter Implementation
- **File:** `src/adapters/driven/llm/DeepseekAdapter.ts`
- **Library:** We will use the official `openai` NPM package, taking advantage of Deepseek's API compatibility to get robust types and streaming support.
- **Initialization:** The adapter will initialize the OpenAI client using the `DEEPSEEK_API_KEY` from `src/config.ts` and set the `baseURL` to `https://api.deepseek.com`.
- **Data Mapping:**
  - It will map the provided `systemPrompt` into an OpenAI `{ role: "system" }` message.
  - It will map our internal `Message` entities into OpenAI `{ role: "user" | "assistant" }` messages.
  - It will map our `Plugin` array into the `tools` JSON Schema format expected by the API.
- **Response Parsing:**
  - If the model returns a `tool_calls` array, it returns our internal `ToolCall` object.
  - If it returns text, it returns the text string.

## 5. Scope & Next Steps
This adapter is strictly responsible for communicating with Deepseek. It does not handle database storage or actual plugin execution. Once implemented, the mock LLM in `src/index.ts` will be replaced with this real adapter.
