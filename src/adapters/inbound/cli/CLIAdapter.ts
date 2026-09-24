import * as readline from 'readline';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { UserMessage } from '../../../core/entities/Message';

/**
 * Configuration options for CLIAdapter.
 */
export interface CLIAdapterOptions {
  /** Optional logger port for recording adapter events and errors. */
  logger?: LoggerPort;
  /** Optional readline interface: useful for injecting test doubles. */
  rl?: readline.Interface;
}

/**
 * Inbound CLI driving adapter that reads user input from stdin,
 * dispatches messages to the ProcessIncomingMessage use case, and prompts iteratively.
 */
export class CLIAdapter {
  private rl: readline.Interface;
  private logger?: LoggerPort;

  constructor(
    private processMessageUseCase: ProcessIncomingMessage,
    options?: CLIAdapterOptions
  ) {
    this.logger = options?.logger;
    this.rl =
      options?.rl ??
      readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
  }

  /**
   * Starts the interactive command-line prompt loop.
   */
  start(): void {
    console.log("Iny CLI started. Type your message (or 'exit' to quit):");
    this.prompt();
  }

  /**
   * Prompts the user for input and dispatches messages to the use case.
   */
  private prompt(): void {
    this.rl.question('> ', async (input) => {
      switch (input.trim().toLowerCase()) {
        case 'exit':
          this.rl.close();
          return;
        case '':
          this.prompt();
          return;
      }

      try {
        const message: UserMessage = {
          id: crypto.randomUUID(),
          userId: 'cli-user',
          role: 'user',
          content: input.trim(),
          timestamp: new Date()
        };
        await this.processMessageUseCase.execute(message);
      } catch (error) {
        if (this.logger) {
          this.logger.error('Error processing message in CLI', error);
        } else {
          console.error('Error processing message:', error);
        }
      } finally {
        this.prompt();
      }
    });
  }
}

