/**
 * Core Engine Type Definitions
 *
 * Defines channel-agnostic data models for requests, responses,
 * conversational memory, and retrieved source citations.
 */

import type { RetrievedChunk } from "../rag/retrieve.js";
import type { ResponseStyle } from "../rag/systemPrompt.js";

export type { RetrievedChunk, ResponseStyle };

export interface ChatMetadata {
  channel: "whatsapp" | "web" | "cli" | "api" | "test";
  userId?: string;
  userName?: string;
  [key: string]: unknown;
}

export interface ChatRequest {
  /** Unique session identifier (e.g. WhatsApp JID, Web Session ID, or User ID) */
  sessionId: string;
  /** Natural language message from the user */
  message: string;
  /** Response style: "concise" / "to-the-point" (default) or "detailed" */
  style?: ResponseStyle;
  /** Optional custom style instructions string to append to base prompt */
  customStylePrompt?: string;
  /** Optional metadata about channel / sender */
  metadata?: ChatMetadata;
}

export interface SourceCitation {
  index: number;
  title: string;
  pageStart: number;
  pageEnd: number;
  pageString: string;
  preview: string;
  fullContent: string;
}

export interface ChatResponse {
  /** The final generated answer in standard universal Markdown */
  message: string;
  /** Source chunks retrieved and referenced during generation */
  sources: RetrievedChunk[];
  /** Structured, formatted citation objects */
  citations: SourceCitation[];
  /** Total tool-calling iterations performed by the agent */
  iterations: number;
  /** Session identifier for continuation */
  sessionId: string;
  /** The response style used for this generation */
  style: string;
}

export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}
