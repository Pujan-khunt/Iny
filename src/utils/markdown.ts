/**
 * Convert Markdown formatting to WhatsApp-compatible formatting
 * Handles cases where LLM outputs Markdown despite prompt instructions
 */
export function convertMarkdownToWhatsApp(text: string): string {
  // Convert **text** (bold) to *text*
  text = text.replace(/\*\*(.+?)\*\*/g, "*$1*");

  // Convert __text__ (bold) to *text*
  text = text.replace(/__(.+?)__/g, "*$1*");

  // Convert ~~text~~ (strikethrough) to ~text~
  text = text.replace(/~~(.+?)~~/g, "~$1~");

  return text;
}