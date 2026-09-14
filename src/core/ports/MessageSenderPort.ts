export interface MessageSenderPort {
  sendMessage(userId: string, content: string): Promise<void>;
}
