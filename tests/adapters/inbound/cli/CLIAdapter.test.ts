import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CLIAdapter } from '../../../../src/adapters/inbound/cli/CLIAdapter';
import { ProcessIncomingMessage } from '../../../../src/core/use-cases/ProcessIncomingMessage';
import type * as readline from 'readline';
import { LoggerPort } from '../../../../src/core/ports/LoggerPort';

describe('CLIAdapter', () => {
  let mockUseCase: ProcessIncomingMessage;
  let mockRl: {
    question: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
  };
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    mockUseCase = {
      execute: vi.fn().mockResolvedValue(undefined)
    } as unknown as ProcessIncomingMessage;

    mockRl = {
      question: vi.fn(),
      close: vi.fn()
    };
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('should print banner and prompt for input on start', () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    adapter.start();

    expect(consoleSpy).toHaveBeenCalledWith("Iny CLI started. Type your message (or 'exit' to quit):");
    expect(mockRl.question).toHaveBeenCalledWith('> ', expect.any(Function));
  });

  it('should process incoming message and prompt again', async () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('hello world');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();

    expect(mockUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'cli-user',
        content: 'hello world',
        id: expect.any(String),
        timestamp: expect.any(Date)
      })
    );
    expect(mockRl.question).toHaveBeenCalledTimes(2);
    expect(mockRl.close).toHaveBeenCalledTimes(1);
  });

  it('should trim message content before constructing message', async () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('  hello world with spaces  ');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();

    expect(mockUseCase.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        content: 'hello world with spaces',
      })
    );
  });

  it('should close readline and not execute use case when user inputs "exit"', async () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question.mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
      callback('exit');
    });

    adapter.start();
    await Promise.resolve();

    expect(mockRl.close).toHaveBeenCalledTimes(1);
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should handle case-insensitive and trimmed "  EXIT  "', async () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question.mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
      callback('  EXIT  ');
    });

    adapter.start();
    await Promise.resolve();

    expect(mockRl.close).toHaveBeenCalledTimes(1);
    expect(mockUseCase.execute).not.toHaveBeenCalled();
  });

  it('should re-prompt and not execute use case when user inputs empty string or whitespace', async () => {
    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('   ');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();

    expect(mockUseCase.execute).not.toHaveBeenCalled();
    expect(mockRl.question).toHaveBeenCalledTimes(2);
    expect(mockRl.close).toHaveBeenCalledTimes(1);
  });

  it('should handle error during message processing, log error, and prompt again', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const error = new Error('Execution failed');
    mockUseCase.execute = vi.fn().mockRejectedValueOnce(error);

    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('trigger error');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();

    expect(errorSpy).toHaveBeenCalledWith('Error processing message:', error);
    expect(mockRl.question).toHaveBeenCalledTimes(2);
    expect(mockRl.close).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('should initialize default readline interface when none provided', () => {
    const adapter = new CLIAdapter(mockUseCase);
    expect((adapter as any).rl).toBeDefined();
    (adapter as any).rl.close();
  });

  it('should log error to injected logger when message processing fails', async () => {
    const mockLogger: LoggerPort = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
    };
    const error = new Error('Execution failed');
    mockUseCase.execute = vi.fn().mockRejectedValueOnce(error);

    const adapter = new CLIAdapter(mockUseCase, mockRl as unknown as readline.Interface, mockLogger);

    mockRl.question
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('trigger error');
      })
      .mockImplementationOnce((_prompt: string, callback: (answer: string) => void) => {
        callback('exit');
      });

    adapter.start();
    await Promise.resolve();

    expect(mockLogger.error).toHaveBeenCalledWith('Error processing message in CLI', error);
  });
});

