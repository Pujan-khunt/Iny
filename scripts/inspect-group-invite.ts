import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { loadConfig } from "../src/config";
import { PinoLoggerAdapter } from "../src/adapters/outbound/logger/PinoLoggerAdapter";
import { PostgresBaileysSessionManager } from "../src/adapters/outbound/whatsapp/PostgresBaileysSessionManager";
import { BaileysPairingManager } from "../src/adapters/outbound/whatsapp/BaileysPairingManager";
import { BaileysConnectionManager } from "../src/adapters/outbound/whatsapp/BaileysConnectionManager";
import * as whatsappSchema from "../src/adapters/outbound/whatsapp/postgres/schema";
import { LoggerPort } from "../src/core/ports/LoggerPort";

// ============================================================================
// 1. CONFIGURATION: You can either hardcode the invite link/code here or
// pass it as an argument: npx tsx --env-file=.env scripts/inspect-group-invite.ts <INVITE_LINK_OR_CODE>
// Example: 'https://chat.whatsapp.com/AbCdEf12345' OR 'AbCdEf12345'
// ============================================================================
const HARDCODED_INVITE_CODE_OR_URL = "FdiFgux6RXaAAiT27KziX0";

async function main(): Promise<void> {
	// Allow running even if FOOD_ANNOUNCEMENTS_GROUP_JID is not yet configured
	const config = loadConfig({
		FOOD_ANNOUNCEMENTS_GROUP_JID: "placeholder@g.us",
		...process.env,
	});

	const baseLogger = new PinoLoggerAdapter(config.LOG_LEVEL);

	// Custom logger to format the pairing code clearly in ANSI color if needed
	const pairingLogger: LoggerPort = {
		debug: (msg, ctx) => baseLogger.debug(msg, ctx),
		info: (msg, context) => {
			baseLogger.info(msg, context);
			if (context && typeof context === "object" && "pairingCode" in context) {
				const code = (context as { pairingCode: string }).pairingCode;
				console.log("\n" + "=".repeat(60));
				console.log("\x1b[1;32m👉 WHATSAPP PAIRING CODE:\x1b[0m \x1b[1;33m" + code + "\x1b[0m");
				console.log("=".repeat(60));
				console.log("1. Open WhatsApp on your phone (" + config.BOT_PHONE_NUMBER + ")");
				console.log("2. Go to Settings > Linked Devices > Link a Device");
				console.log('3. Tap "Link with phone number instead"');
				console.log("4. Enter the 8-character code shown above");
				console.log("=".repeat(60) + "\n");
			}
		},
		warn: (msg, ctx) => baseLogger.warn(msg, ctx),
		error: (msg, err, ctx) => baseLogger.error(msg, err, ctx),
		fatal: (msg, err, ctx) => baseLogger.fatal(msg, err, ctx),
		child: () => pairingLogger,
	};

	const sqlClient = postgres(config.DATABASE_URL, {
		max: 2,
		idle_timeout: 10,
		connect_timeout: 10,
	});

	const db = drizzle(sqlClient, { schema: whatsappSchema });

	const sessionManager = new PostgresBaileysSessionManager(db, baseLogger, "default");
	const pairingManager = new BaileysPairingManager(pairingLogger);
	const connectionManager = new BaileysConnectionManager(
		baseLogger,
		pairingManager,
		sessionManager,
	);

	console.log("\n🚀 Initializing WhatsApp session...");
	const session = await sessionManager.initSession();

	let resolved = false;

	async function cleanup(): Promise<void> {
		try {
			connectionManager.disconnect();
		} catch {
			// ignore
		}
		try {
			await sqlClient.end({ timeout: 2 });
		} catch {
			// ignore
		}
	}

	connectionManager.subscribe("connection.update", async (update) => {
		if (update.connection === "open" && !resolved) {
			resolved = true;
			console.log("\n✅ WhatsApp connection established!");

			const sock = connectionManager.getSocket();
			if (!sock) {
				console.error("❌ Active socket not found.");
				await cleanup();
				process.exit(1);
			}

			// Resolve the invite code from CLI argument or hardcoded constant
			const rawInput = (process.argv[2] || HARDCODED_INVITE_CODE_OR_URL).trim();
			const inviteCode = rawInput.replace(/^https?:\/\/chat\.whatsapp\.com\//i, "").trim();

			if (!inviteCode || inviteCode === "PASTE_YOUR_INVITE_CODE_OR_URL_HERE") {
				console.log(
					"\n⚠️ No invite code provided. Fetching all participating groups for this account...\n",
				);

				try {
					const groups = await sock.groupFetchAllParticipating();
					const entries = Object.entries(groups);
					if (entries.length === 0) {
						console.log("No groups found for this WhatsApp account.");
					} else {
						console.log("=".repeat(60));
						console.log("📋 PARTICIPATING GROUPS FOUND:");
						console.log("=".repeat(60));
						for (const [jid, group] of entries) {
							console.log(`Title: ${group.subject}`);
							console.log(`JID:   ${jid}`);
							console.log("-".repeat(60));
						}
					}
				} catch (fetchErr) {
					console.error("Failed to query participating groups:", fetchErr);
				}

				console.log("\n👉 To query a specific group by invite link, run:");
				console.log(
					'npx tsx --env-file=.env scripts/inspect-group-invite.ts "<INVITE_LINK_OR_CODE>"\n',
				);
				await cleanup();
				process.exit(0);
			}

			console.log(`\n🔍 Fetching group metadata for invite code: "${inviteCode}"...`);
			try {
				const info = await sock.groupGetInviteInfo(inviteCode);
				const groupJid = info.id.endsWith("@g.us") ? info.id : `${info.id}@g.us`;

				console.log("\n" + "=".repeat(60));
				console.log("🎯 GROUP DETAILS RETRIEVED SUCCESSFULLY");
				console.log("=".repeat(60));
				console.log(`Group Name:   ${info.subject}`);
				console.log(`Group JID:    ${groupJid}`);
				if (info.size) console.log(`Members:      ${info.size}`);
				if (info.owner) console.log(`Owner:        ${info.owner}`);
				if (info.desc) console.log(`Description:  ${info.desc}`);
				console.log("=".repeat(60));
				console.log("\n👉 Update your .env file with this JID:");
				console.log(`\x1b[1;32mFOOD_ANNOUNCEMENTS_GROUP_JID=${groupJid}\x1b[0m\n`);
			} catch (err: any) {
				console.error("\n❌ Failed to query invite code. Error details:", err?.message ?? err);
				console.log("Tip: Check if the invite code/link is valid, active, and not revoked.");
			} finally {
				await cleanup();
				process.exit(0);
			}
		}
	});

	await connectionManager.start({
		session,
		botPhoneNumber: config.BOT_PHONE_NUMBER,
	});
}

main().catch((err) => {
	console.error("Fatal script error:", err);
	process.exit(1);
});
