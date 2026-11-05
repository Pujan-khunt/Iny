import pino from "pino";
import fs from "fs";
import path from "path";
import { LoggerPort, LogContext } from "../../../core/ports/LoggerPort";
import { LogFileManager } from "./LogFileManager";

export interface PinoLoggerAdapterOptions {
	level: string;
	toFile?: boolean;
	logFilePath?: string;
	prettyConsole?: boolean;
}

export interface LoggerRuntimeConfig {
	LOG_LEVEL: string;
	LOG_TO_FILE: boolean;
	LOG_DIR: string;
	LOG_RETENTION_DAYS: number;
	LOG_PRETTY_CONSOLE: boolean;
}

export class PinoLoggerAdapter implements LoggerPort {
	private pino: pino.Logger;
	private fileStream?: fs.WriteStream;

	constructor(level: string = "info", baseLogger?: pino.Logger, fileStream?: fs.WriteStream) {
		this.pino = baseLogger ?? pino({ level });
		this.fileStream = fileStream;
	}

	async flush(): Promise<void> {
		if (!this.fileStream) return;
		await new Promise<void>((resolve) => {
			this.fileStream?.end(() => resolve());
		});
	}

	static createFromConfig(config: LoggerRuntimeConfig): PinoLoggerAdapter {
		let logFilePath: string | undefined;
		if (config.LOG_TO_FILE) {
			const manager = new LogFileManager(config.LOG_DIR, config.LOG_RETENTION_DAYS);
			manager.pruneOldLogs();
			const session = manager.initializeSession();
			logFilePath = session.logFilePath;
		}

		return PinoLoggerAdapter.createWithMultistream({
			level: config.LOG_LEVEL,
			toFile: config.LOG_TO_FILE,
			logFilePath,
			prettyConsole: config.LOG_PRETTY_CONSOLE,
		});
	}

	static createWithMultistream(options: PinoLoggerAdapterOptions): PinoLoggerAdapter {
		const streams: pino.StreamEntry[] = [];
		const consoleStream = PinoLoggerAdapter.resolveConsoleStream(options.prettyConsole);
		streams.push({ stream: consoleStream, level: options.level as pino.Level });

		let fileStream: fs.WriteStream | undefined;
		if (options.toFile && options.logFilePath) {
			const dir = path.dirname(options.logFilePath);
			fs.mkdirSync(dir, { recursive: true });
			fileStream = fs.createWriteStream(options.logFilePath, { flags: "a" });
			streams.push({ stream: fileStream, level: options.level as pino.Level });
		}

		const multi = pino.multistream(streams);
		const baseLogger = pino({ level: options.level }, multi);
		return new PinoLoggerAdapter(options.level, baseLogger, fileStream);
	}

	private static resolveConsoleStream(prettyConsole?: boolean): NodeJS.WritableStream {
		if (!prettyConsole) return process.stdout;
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const buildPretty = require("pino-pretty");
			return buildPretty({ colorize: true });
		} catch {
			return process.stdout;
		}
	}

	debug(message: string, context?: LogContext): void {
		this.emit("debug", message, undefined, context);
	}

	info(message: string, context?: LogContext): void {
		this.emit("info", message, undefined, context);
	}

	warn(message: string, error?: unknown, context?: LogContext): void {
		this.emit("warn", message, error, context);
	}

	error(message: string, error?: unknown, context?: LogContext): void {
		this.emit("error", message, error, context);
	}

	fatal(message: string, error?: unknown, context?: LogContext): void {
		this.emit("fatal", message, error, context);
	}

	private emit(
		level: "debug" | "info" | "warn" | "error" | "fatal",
		message: string,
		error?: unknown,
		context?: LogContext,
	): void {
		if (error !== undefined) {
			this.pino[level]({ ...context, err: error }, message);
			return;
		}
		if (context !== undefined) {
			this.pino[level](context, message);
			return;
		}
		this.pino[level](message);
	}

	child(bindings: LogContext): LoggerPort {
		return new PinoLoggerAdapter(this.pino.level, this.pino.child(bindings), this.fileStream);
	}
}
