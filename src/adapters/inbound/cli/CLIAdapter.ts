import * as readline from 'readline';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { UserMessage } from '../../../core/entities/Message';

export interface CLIAdapterOptions {
  logger?: LoggerPort;
  rl?: readline.Interface;
}

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

  start() {
    console.log("Iny CLI started. Type your message (or 'exit' to quit):");
    this.prompt();
  }

  private prompt() {
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
          id: Date.now().toString(),
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
