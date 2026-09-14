import * as readline from 'readline';
import { ProcessIncomingMessage } from '../../../core/use-cases/ProcessIncomingMessage';

export class CLIAdapter {
  private rl: readline.Interface;

  constructor(
    private processMessageUseCase: ProcessIncomingMessage,
    rl?: readline.Interface
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

      await this.processMessageUseCase.execute({
        id: Date.now().toString(),
        userId: 'cli-user',
        content: input,
        timestamp: new Date()
      });

      this.prompt();
    });
  }
}
