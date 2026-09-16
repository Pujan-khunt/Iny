import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { PinoLoggerAdapter } from '../../../../src/adapters/driven/logger/PinoLoggerAdapter';

describe('PinoLoggerAdapter', () => {
  let logs: Record<string, unknown>[];
  let adapter: PinoLoggerAdapter;

  const setupLogger = (level: string = 'debug') => {
    logs = [];
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(JSON.parse(chunk.toString()));
        callback();
      },
    });
    const basePino = pino({ level }, stream);
    adapter = new PinoLoggerAdapter(level, basePino);
  };

  beforeEach(() => {
    setupLogger('debug');
  });

  it('should emit info logs with message and context', () => {
    adapter.info('User connected', { userId: 'u123' });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(30); // pino info level
    expect(logs[0].msg).toBe('User connected');
    expect(logs[0].userId).toBe('u123');
  });

  it('should emit debug and warn logs', () => {
    adapter.debug('Debugging detail', { step: 1 });
    adapter.warn('Warning detail', { reason: 'slow' });

    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe(20); // debug
    expect(logs[0].msg).toBe('Debugging detail');
    expect(logs[0].step).toBe(1);
    expect(logs[1].level).toBe(40); // warn
    expect(logs[1].msg).toBe('Warning detail');
    expect(logs[1].reason).toBe('slow');
  });

  it('should filter logs below configured log level', () => {
    setupLogger('info');

    adapter.debug('This should be ignored');
    adapter.info('This should be logged');

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('This should be logged');
  });

  it('should handle error overload with Error object and context', () => {
    const testError = new Error('Database connection failed');

    adapter.error('Operation failed', testError, { attempt: 3 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50); // error
    expect(logs[0].msg).toBe('Operation failed');
    expect(logs[0].attempt).toBe(3);
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Database connection failed');
    expect(err.stack).toBeDefined();
  });

  it('should ensure explicit Error object takes precedence if context contains an err key', () => {
    const testError = new Error('Explicit failure');

    adapter.error('Operation failed', testError, { err: 'shadowed value', attempt: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0].attempt).toBe(1);
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Explicit failure');
  });

  it('should handle error overload with only Error object', () => {
    const testError = new Error('Network timeout');

    adapter.error('Request failed', testError);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Request failed');
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Network timeout');
  });

  it('should handle error overload with plain context object (no Error)', () => {
    adapter.error('Request rejected', { statusCode: 403 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Request rejected');
    expect(logs[0].statusCode).toBe(403);
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle error overload with only message', () => {
    adapter.error('Simple error occurred');

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Simple error occurred');
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle fatal overload with Error object and context', () => {
    const fatalError = new Error('Out of memory');

    adapter.fatal('Process crashing', fatalError, { exitCode: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60); // fatal
    expect(logs[0].msg).toBe('Process crashing');
    expect(logs[0].exitCode).toBe(1);
    expect(logs[0].err).toBeDefined();
  });

  it('should handle fatal overload with only Error object', () => {
    const fatalError = new Error('Out of memory');

    adapter.fatal('Process crashing', fatalError);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60);
    expect(logs[0].msg).toBe('Process crashing');
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Out of memory');
  });

  it('should handle fatal overload with plain context object (no Error)', () => {
    adapter.fatal('Unrecoverable state', { subsystem: 'database' });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60);
    expect(logs[0].msg).toBe('Unrecoverable state');
    expect(logs[0].subsystem).toBe('database');
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle fatal overload with only message', () => {
    adapter.fatal('Unrecoverable failure');

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60);
    expect(logs[0].msg).toBe('Unrecoverable failure');
    expect(logs[0].err).toBeUndefined();
  });

  it('should use default constructor parameters when none are passed', () => {
    const defaultAdapter = new PinoLoggerAdapter();
    expect(defaultAdapter).toBeInstanceOf(PinoLoggerAdapter);
  });

  it('should handle child loggers with propagated bindings', () => {
    const childLogger = adapter.child({ correlationId: 'corr-999' });
    childLogger.info('Child event', { extra: 'data' });

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('Child event');
    expect(logs[0].correlationId).toBe('corr-999');
    expect(logs[0].extra).toBe('data');
  });
});
