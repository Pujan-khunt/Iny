/**
 * Suppresses verbose internal libsignal session ratchet dumps to console.
 *
 * libsignal hardcodes calls to console.info/console.warn for session lifecycle
 * events rather than routing through Baileys' injected logger.
 */

let originalConsoleInfo: typeof console.info | null = null;
let originalConsoleWarn: typeof console.warn | null = null;

const SILENCED_INFO_PREFIXES = [
	"Closing session:",
	"Opening session:",
	"Removing old closed session:",
];

const SILENCED_WARN_PREFIXES = [
	"Session already closed",
	"Session already open",
	"Closing open session in favor of incoming prekey bundle",
	"Decrypted message with closed session.",
];

function shouldSuppress(message: unknown, prefixes: string[]): boolean {
	if (typeof message !== "string") {
		return false;
	}
	return prefixes.some((prefix) => message.startsWith(prefix));
}

/**
 * Intercepts console.info and console.warn to suppress internal libsignal session logs.
 * Idempotent: safe to invoke multiple times without stacking wrappers.
 */
export function suppressLibsignalLogs(): void {
	if (originalConsoleInfo !== null) {
		return;
	}

	originalConsoleInfo = console.info;
	originalConsoleWarn = console.warn;

	console.info = (...args: unknown[]) => {
		if (shouldSuppress(args[0], SILENCED_INFO_PREFIXES)) {
			return;
		}
		originalConsoleInfo!(...args);
	};

	console.warn = (...args: unknown[]) => {
		if (shouldSuppress(args[0], SILENCED_WARN_PREFIXES)) {
			return;
		}
		originalConsoleWarn!(...args);
	};
}

/**
 * Restores original console methods. Intended primarily for testing environments.
 */
export function restoreLibsignalLogs(): void {
	if (originalConsoleInfo !== null) {
		console.info = originalConsoleInfo;
		originalConsoleInfo = null;
	}
	if (originalConsoleWarn !== null) {
		console.warn = originalConsoleWarn;
		originalConsoleWarn = null;
	}
}
