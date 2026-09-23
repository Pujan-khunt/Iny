export type LogContext = Record<string, unknown>;

/**
 * Outbound port for structured application logging.
 * Provides unambiguous signatures for error tracking and context propagation.
 */
export interface LoggerPort {
  /**
   * Logs a message at debug level with optional contextual metadata.
   *
   * @param message Informational debug message.
   * @param context Key-value metadata providing additional execution context.
   */
  debug(message: string, context?: LogContext): void;

  /**
   * Logs a message at info level with optional contextual metadata.
   *
   * @param message Informational message.
   * @param context Key-value metadata providing additional execution context.
   */
  info(message: string, context?: LogContext): void;

  /**
   * Logs a message at warn level with optional error cause and contextual metadata.
   *
   * @param message Warning message describing the condition.
   * @param error Optional error or exception associated with the warning.
   * @param context Key-value metadata providing additional execution context.
   */
  warn(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Logs an error message with optional error cause and contextual metadata.
   *
   * @param message Error message describing the failure.
   * @param error Optional error or exception that occurred.
   * @param context Key-value metadata providing additional execution context.
   */
  error(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Logs a fatal error indicating unrecoverable application state.
   *
   * @param message Fatal error message describing the critical failure.
   * @param error Optional error or exception that triggered the fatal state.
   * @param context Key-value metadata providing additional execution context.
   */
  fatal(message: string, error?: unknown, context?: LogContext): void;

  /**
   * Creates a child logger with bound contextual metadata.
   *
   * @param bindings Key-value metadata attached to all subsequent logs from the child.
   * @returns New LoggerPort instance inheriting parent settings with bound context.
   */
  child(bindings: LogContext): LoggerPort;
}
