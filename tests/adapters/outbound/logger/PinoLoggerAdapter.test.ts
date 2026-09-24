import { describe, it, expect, beforeEach } from 'vitest';
import pino from 'pino';
import { Writable } from 'node:stream';
import { PinoLoggerAdapter } from '../../../../src/adapters/outbound/logger/PinoLoggerAdapter';

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

  it('should emit debug logs with message and context', () => {
    adapter.debug('Debugging detail', { step: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(20); // debug
    expect(logs[0].msg).toBe('Debugging detail');
    expect(logs[0].step).toBe(1);
  });

  it('should emit debug and info logs with only message', () => {
    adapter.debug('Simple debug message');
    adapter.info('Simple info message');

    expect(logs).toHaveLength(2);
    expect(logs[0].level).toBe(20);
    expect(logs[0].msg).toBe('Simple debug message');
    expect(logs[1].level).toBe(30);
    expect(logs[1].msg).toBe('Simple info message');
  });

  it('should emit warn logs with optional error and context', () => {
    adapter.warn('Simple warning');
    adapter.warn('Warning with context', undefined, { reason: 'slow' });

    const warnErr = new Error('Disk getting full');
    adapter.warn('Storage warning', warnErr, { disk: '/dev/sda1' });

    expect(logs).toHaveLength(3);
    expect(logs[0].level).toBe(40);
    expect(logs[0].msg).toBe('Simple warning');
    expect(logs[0].err).toBeUndefined();

    expect(logs[1].level).toBe(40);
    expect(logs[1].msg).toBe('Warning with context');
    expect(logs[1].reason).toBe('slow');
    expect(logs[1].err).toBeUndefined();

    expect(logs[2].level).toBe(40);
    expect(logs[2].msg).toBe('Storage warning');
    expect(logs[2].disk).toBe('/dev/sda1');
    const err = logs[2].err as Record<string, unknown>;
    expect(err.message).toBe('Disk getting full');
  });

  it('should filter logs below configured log level', () => {
    setupLogger('info');

    adapter.debug('This should be ignored');
    adapter.info('This should be logged');

    expect(logs).toHaveLength(1);
    expect(logs[0].msg).toBe('This should be logged');
  });

  it('should handle error with Error object and context', () => {
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

  it('should handle error with only Error object', () => {
    const testError = new Error('Network timeout');

    adapter.error('Request failed', testError);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Request failed');
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Network timeout');
  });

  it('should handle error with only message', () => {
    adapter.error('Simple error occurred');

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(50);
    expect(logs[0].msg).toBe('Simple error occurred');
    expect(logs[0].err).toBeUndefined();
  });

  it('should handle fatal with Error object and context', () => {
    const fatalError = new Error('Out of memory');

    adapter.fatal('Process crashing', fatalError, { exitCode: 1 });

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60); // fatal
    expect(logs[0].msg).toBe('Process crashing');
    expect(logs[0].exitCode).toBe(1);
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Out of memory');
  });

  it('should handle fatal with only Error object', () => {
    const fatalError = new Error('Out of memory');

    adapter.fatal('Process crashing', fatalError);

    expect(logs).toHaveLength(1);
    expect(logs[0].level).toBe(60);
    expect(logs[0].msg).toBe('Process crashing');
    expect(logs[0].err).toBeDefined();
    const err = logs[0].err as Record<string, unknown>;
    expect(err.message).toBe('Out of memory');
  });

  it('should handle fatal with only message', () => {
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
