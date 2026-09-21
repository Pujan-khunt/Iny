# Iny Core Architecture Design

## 1. Overview
Iny is a universal, natural language interface designed to unify access to various college tools, announcements, and information systems (e.g., Mess QR, Ticketing, Booking, PDFs). By using WhatsApp as the primary interface, it provides a zero-friction experience for students. 

This document outlines the architecture for the **Core Bot Engine**, which acts as the foundation for processing messages, maintaining conversation state, and routing user intents to specific plugins using LLM function calling.

## 2. Tech Stack
- **Language/Runtime:** TypeScript / Node.js
- **Architecture Pattern:** Ports & Adapters (Hexagonal Architecture)
- **Primary Interface:** WhatsApp (via `Baileys` library) and a local CLI for testing
- **AI / LLM:** 
  - Generation & Function Calling: Deepseek-v4.1-flash
  - Embeddings (for future RAG/semantic tasks): OpenAI text-embedding-3-small
- **Database:** PostgreSQL (for storing Baileys auth state and conversation history)

## 3. Architecture Structure

The codebase is strictly separated to adhere to SOLID principles and ensure high maintainability and extensibility.

### 3.1. `src/core/` (Domain & Business Logic)
The core contains the business rules and does not depend on any external libraries (no Baileys, no Deepseek SDK, no Postgres).
- **`entities/`**: Core data structures (e.g., `Message`, `User`, `Conversation`).
- **`ports/`**: TypeScript interfaces defining what the core needs to function:
  - `MessageSenderPort`: Interface for sending text back to the user.
  - `LLMPort`: Interface for generating text and executing function calls.
  - `ChatRepositoryPort`: Interface for saving/retrieving conversation history.
  - `PluginRegistryPort`: Interface for discovering available tools.
- **`use-cases/`**: The orchestration logic. Primarily `ProcessIncomingMessage`, which coordinates the flow from receiving a message to sending a response.

### 3.2. `src/adapters/` (Implementations)
Adapters implement the interfaces defined in the core or drive the core's use cases.
- **`driving/` (Inbound)**
  - `WhatsAppAdapter`: Listens to `Baileys` events and passes mapped messages to the core.
  - `CLIAdapter`: A terminal interface for local testing without needing a phone.
- **`driven/` (Outbound)**
  - `DeepseekAdapter`: Implements `LLMPort`, handling the API calls to Deepseek.
  - `PostgresChatRepository`: Implements `ChatRepositoryPort` using an ORM (e.g., Prisma or Drizzle) to persist state.

### 3.3. `src/plugins/` (Action Adapters)
Plugins are modular features (e.g., `BookingPlugin`, `MessMenuPlugin`). 
Each plugin must provide:
1. A **JSON Schema** defining its capabilities (so the LLM knows how to call it).
2. An **Execute Method** containing the logic to perform the action.

## 4. Data Flow & Execution

When a message arrives, the following sequence occurs:
1. **Ingestion:** A Driving Adapter (`WhatsAppAdapter` or `CLIAdapter`) receives a message, normalizes it into a core `Message` entity, and passes it to the `ProcessIncomingMessage` Use Case.
2. **Context Retrieval:** The Use Case fetches the user's conversation history via the `ChatRepositoryPort`.
3. **Plugin Discovery:** The Use Case queries the `PluginRegistryPort` for a list of all active plugin schemas.
4. **AI Generation:** The Use Case sends the conversation history, the new message, and the available plugin schemas to the `LLMPort`.
5. **Execution & Routing:**
   - If the LLM returns a standard text response, proceed to Step 6.
   - If the LLM returns a `ToolCall` (Function Call), the Use Case executes the corresponding Plugin. The result is appended to the context, and the `LLMPort` is called again to generate a human-friendly summary of the result.
6. **Delivery:** The final response is saved to the repository and sent back to the user via the `MessageSenderPort`.

## 5. Scope & Next Steps
This design covers the core engine. Once implemented, specific tools (Mess QR, PDFs, Booking) will be built as independent plugins and plugged into this architecture.
