import pino from 'pino';
import { LoggerPort, LogContext } from '../../../core/ports/LoggerPort';

export class PinoLoggerAdapter implements LoggerPort {
  private pino: pino.Logger;

  constructor(level: string = 'info', baseLogger?: pino.Logger) {
    this.pino = baseLogger ?? pino({ level });
  }

  debug(message: string, context?: LogContext): void {
    if (context) {
      this.pino.debug(context, message);
    } else {
      this.pino.debug(message);
    }
  }

  info(message: string, context?: LogContext): void {
    if (context) {
      this.pino.info(context, message);
    } else {
      this.pino.info(message);
    }
  }

  warn(message: string, context?: LogContext): void {
    if (context) {
      this.pino.warn(context, message);
    } else {
      this.pino.warn(message);
    }
  }

  error(message: string, error: unknown, context?: LogContext): void;
  error(message: string, context?: LogContext): void;
  error(message: string, errorOrContext?: unknown, context?: LogContext): void {
    this.logErrorOrFatal('error', message, errorOrContext, context);
  }

  fatal(message: string, error: unknown, context?: LogContext): void;
  fatal(message: string, context?: LogContext): void;
  fatal(message: string, errorOrContext?: unknown, context?: LogContext): void {
    this.logErrorOrFatal('fatal', message, errorOrContext, context);
  }

  private logErrorOrFatal(
    level: 'error' | 'fatal',
    message: string,
    errorOrContext?: unknown,
    context?: LogContext
  ): void {
    if (context !== undefined) {
      this.pino[level]({ err: errorOrContext, ...context }, message);
    } else if (errorOrContext instanceof Error) {
      this.pino[level]({ err: errorOrContext }, message);
    } else if (typeof errorOrContext === 'object' && errorOrContext !== null) {
      this.pino[level](errorOrContext as Record<string, unknown>, message);
    } else if (errorOrContext !== undefined) {
      this.pino[level]({ err: errorOrContext }, message);
    } else {
      this.pino[level](message);
    }
  }

  child(bindings: LogContext): LoggerPort {
    return new PinoLoggerAdapter(this.pino.level, this.pino.child(bindings));
  }
}
