import fs from "fs";
import path from "path";

export interface LogFileSession {
	logFilePath: string;
	latestSymlinkPath: string;
}

export class LogFileManager {
	constructor(
		private readonly logDir: string = "logs",
		private readonly retentionDays: number = 7,
	) {}

	initializeSession(now: Date = new Date()): LogFileSession {
		fs.mkdirSync(this.logDir, { recursive: true });
		const timestamp = now.toISOString().replace(/:/g, "-").split(".")[0];
		const logFilePath = this.generateUniqueSessionPath(timestamp);

		fs.closeSync(fs.openSync(logFilePath, "w"));

		const latestSymlinkPath = path.join(this.logDir, "latest.log");
		this.updateLatestPointer(logFilePath, latestSymlinkPath);

		return { logFilePath, latestSymlinkPath };
	}

	private generateUniqueSessionPath(timestamp: string): string {
		const base = path.join(this.logDir, `app-${timestamp}.log`);
		if (!fs.existsSync(base)) return base;
		let counter = 1;
		while (fs.existsSync(path.join(this.logDir, `app-${timestamp}-${counter}.log`))) {
			counter++;
		}
		return path.join(this.logDir, `app-${timestamp}-${counter}.log`);
	}

	pruneOldLogs(now: Date = new Date()): string[] {
		if (!fs.existsSync(this.logDir)) return [];
		const maxAgeMs = this.retentionDays * 86_400_000;
		const pruned: string[] = [];
		const entries = fs.readdirSync(this.logDir, { withFileTypes: true });

		for (const entry of entries) {
			if (!this.isSessionLogFile(entry)) continue;
			const fullPath = path.join(this.logDir, entry.name);
			if (this.tryPruneFile(fullPath, now, maxAgeMs)) {
				pruned.push(fullPath);
			}
		}
		return pruned;
	}

	resolveLatestLogFile(): string | null {
		if (!fs.existsSync(this.logDir)) return null;
		const latestPath = path.join(this.logDir, "latest.log");
		const resolvedLatest = this.resolveSymlinkOrPointer(latestPath);
		if (resolvedLatest !== null) return resolvedLatest;

		return this.discoverNewestLogFile();
	}

	private isSessionLogFile(entry: fs.Dirent): boolean {
		return entry.isFile() && entry.name.startsWith("app-") && entry.name.endsWith(".log");
	}

	private tryPruneFile(filePath: string, now: Date, maxAgeMs: number): boolean {
		try {
			const stats = fs.statSync(filePath);
			if (now.getTime() - stats.mtimeMs > maxAgeMs) {
				fs.unlinkSync(filePath);
				return true;
			}
		} catch {
			// Gracefully ignore filesystem deletion errors
		}
		return false;
	}

	private resolveSymlinkOrPointer(latestPath: string): string | null {
		if (!fs.existsSync(latestPath)) return null;
		try {
			if (fs.lstatSync(latestPath).isSymbolicLink()) {
				const real = fs.realpathSync(latestPath);
				return fs.existsSync(real) ? real : null;
			}
			const content = fs.readFileSync(latestPath, "utf-8").trim();
			return content && fs.existsSync(content) ? content : null;
		} catch {
			// Ignore pointer resolution errors
			return null;
		}
	}

	private discoverNewestLogFile(): string | null {
		const files = fs
			.readdirSync(this.logDir)
			.filter((name) => name.startsWith("app-") && name.endsWith(".log"))
			.map((name) => path.join(this.logDir, name));

		if (files.length === 0) return null;
		files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
		return files[0];
	}

	private updateLatestPointer(target: string, link: string): void {
		try {
			if (fs.existsSync(link) || fs.lstatSync(link).isSymbolicLink()) {
				fs.unlinkSync(link);
			}
		} catch {
			// Ignore existing link removal failure
		}

		try {
			fs.symlinkSync(path.resolve(target), link);
		} catch {
			try {
				fs.writeFileSync(link, target, "utf-8");
			} catch {
				// Ignore fallback file write failure
			}
		}
	}
}
