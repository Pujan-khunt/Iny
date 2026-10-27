import { WAMessage } from "@whiskeysockets/baileys";
import { HandleDialogueTurn } from "../../../core/use-cases/HandleDialogueTurn";
import { BaileysConnectionManager } from "../../outbound/whatsapp/BaileysConnectionManager";
import { AccessControlPort, UserRecord } from "../../../core/ports/AccessControlPort";
import { BaileysMessageFilter, EligibleWebMessageInfo } from "./BaileysMessageFilter";
import { BaileysMessageParser } from "./BaileysMessageParser";
import { LoggerPort } from "../../../core/ports/LoggerPort";
import { UserMessage } from "../../../core/entities/Message";
import { WhatsAppJid } from "../../common/whatsapp/WhatsAppJid";

/**
 * Inbound adapter that listens for incoming WhatsApp messages from Baileys,
 * enforces eligibility policy and access control authorization, parses payloads,
 * and triggers HandleDialogueTurn.
 */
export class WhatsAppInboundAdapter {
	constructor(
		private handleDialogueTurn: HandleDialogueTurn,
		private connectionManager: BaileysConnectionManager,
		private accessControl: AccessControlPort,
		private filter: BaileysMessageFilter,
		private parser: BaileysMessageParser,
		private logger: LoggerPort,
	) {}

	/**
	 * Registers the message upsert listener with the Baileys connection manager.
	 */
	start(): void {
		this.connectionManager.subscribe("messages.upsert", async (upsert) => {
			if (upsert.type === "notify") {
				await this.handleMessages(upsert.messages);
			}
		});
		this.logger.info("WhatsApp inbound adapter listening for incoming messages");
	}

	/**
	 * Handles a batch of incoming raw WAMessage objects from Baileys.
	 *
	 * @param messages The raw messages received from the WhatsApp connection.
	 */
	async handleMessages(messages: WAMessage[]): Promise<void> {
		for (const raw of messages) {
			await this.processSingleMessage(raw);
		}
	}

	private async authenticateSender(eligible: EligibleWebMessageInfo): Promise<UserRecord | null> {
		const { lookupAddress, companionLidJid } = this.resolveSenderRouting(eligible);
		this.logger.debug("Resolved sender routing", {
			remoteJid: eligible.key.remoteJid,
			remoteJidAlt: eligible.key.remoteJidAlt,
			lookupAddress,
			companionLidJid,
		});

		try {
			return await this.accessControl.authenticate(lookupAddress, companionLidJid);
		} catch (authError) {
			this.logger.error("Failed to authenticate sender", authError, {
				lookupAddress,
				remoteJid: eligible.key.remoteJid,
				remoteJidAlt: eligible.key.remoteJidAlt,
			});
			return null;
		}
	}

	private async processSingleMessage(raw: WAMessage): Promise<void> {
		const evaluation = this.filter.evaluate(raw);
		if (!evaluation.eligible) {
			this.logger.debug("Ignored ineligible message", {
				messageId: raw?.key?.id,
				remoteJid: raw?.key?.remoteJid,
				reason: evaluation.reason,
			});
			return;
		}

		const eligible = evaluation.message;
		const user = await this.authenticateSender(eligible);
		if (!user) {
			this.logger.debug("Ignored message from unauthorized sender", {
				remoteJid: eligible.key.remoteJid,
				remoteJidAlt: eligible.key.remoteJidAlt,
			});
			return;
		}

		let userMessage: UserMessage;
		try {
			userMessage = this.parser.parse(eligible, user.pnJid);
		} catch (parseError) {
			this.logger.error("Failed to parse eligible WhatsApp message", parseError);
			return;
		}

		try {
			await this.handleDialogueTurn.execute(userMessage);
		} catch (err) {
			this.logger.error("Unhandled error processing incoming message", err, {
				messageId: userMessage.id,
				userId: userMessage.userId,
			});
		}
	}

	/**
	 * Resolves incoming stanza keys from an eligible message into the database lookup address
	 * (which may be a PNJID or a LIDJID) and an optional companion LIDJID for caching.
	 *
	 * @param message An inbound message that has passed eligibility validation.
	 * @returns An object containing:
	 *   - `lookupAddress`: either a canonical PNJID or LIDJID to query against the `users` table.
	 *   - `companionLidJid`: a companion LIDJID to cache in the database if new, or null.
	 */
	private resolveSenderRouting(message: EligibleWebMessageInfo): {
		lookupAddress: string;
		companionLidJid: string | null;
	} {
		const remoteJid = message.key.remoteJid;
		const remoteJidAlt = message.key.remoteJidAlt;

		if (WhatsAppJid.isLidUser(remoteJid)) {
			if (remoteJidAlt && WhatsAppJid.isPnUser(remoteJidAlt)) {
				return { lookupAddress: remoteJidAlt, companionLidJid: remoteJid };
			}
			return { lookupAddress: remoteJid, companionLidJid: null };
		}

		const companionLidJid =
			remoteJidAlt && WhatsAppJid.isLidUser(remoteJidAlt) ? remoteJidAlt : null;
		return { lookupAddress: remoteJid, companionLidJid };
	}
}
