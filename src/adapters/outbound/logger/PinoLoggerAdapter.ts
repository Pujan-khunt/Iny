import pino from 'pino';
import { LoggerPort, LogContext } from '../../../core/ports/LoggerPort';

export class PinoLoggerAdapter implements LoggerPort {
  private pino: pino.Logger;

  constructor(level: string = 'info', baseLogger?: pino.Logger) {
    this.pino = baseLogger ?? pino({ level });
  }

  debug(message: string, context?: LogContext): void {
    this.emit('debug', message, undefined, context);
  }

  info(message: string, context?: LogContext): void {
    this.emit('info', message, undefined, context);
  }

  warn(message: string, error?: unknown, context?: LogContext): void {
    this.emit('warn', message, error, context);
  }

  error(message: string, error?: unknown, context?: LogContext): void {
    this.emit('error', message, error, context);
  }

  fatal(message: string, error?: unknown, context?: LogContext): void {
    this.emit('fatal', message, error, context);
  }

  private emit(
    level: 'debug' | 'info' | 'warn' | 'error' | 'fatal',
    message: string,
    error?: unknown,
    context?: LogContext
  ): void {
    if (error !== undefined) {
      this.pino[level]({ ...context, err: error }, message);
    } else if (context !== undefined) {
      this.pino[level](context, message);
    } else {
      this.pino[level](message);
    }
  }

  child(bindings: LogContext): LoggerPort {
    return new PinoLoggerAdapter(this.pino.level, this.pino.child(bindings));
  }
}
