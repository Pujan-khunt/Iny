export type LogContext = Record<string, unknown>;

export interface LoggerPort {
  debug(message: string, context?: LogContext): void;
  info(message: string, context?: LogContext): void;
  warn(message: string, context?: LogContext): void;

  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, context?: LogContext): void;

  fatal(message: string, error: unknown, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;

  child(bindings: LogContext): LoggerPort;
}
