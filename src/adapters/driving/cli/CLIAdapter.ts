import * as readline from 'readline';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';
import { LoggerPort } from '../../../core/ports/LoggerPort';
import { Message } from '../../../core/entities/Message';

export class CLIAdapter {
  private rl: readline.Interface;

  constructor(
    private processMessageUseCase: ProcessIncomingMessage,
    rl?: readline.Interface,
    private logger?: LoggerPort
  ) {
    this.rl =
      rl ??
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
      if (input.trim().toLowerCase() === 'exit') {
        this.rl.close();
        return;
      }

      try {
        const message: Message = {
          id: Date.now().toString(),
          userId: 'cli-user',
          content: input,
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
