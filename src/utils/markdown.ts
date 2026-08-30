/**
 * WhatsApp Markdown Converter
 *
 * Converts standard universal Markdown into WhatsApp-flavored Markdown.
 * Uses a 3-stage tokenization pipeline with Private Use Area (PUA) Unicode
 * placeholders to ensure code blocks, inline code, and URLs are never corrupted.
 */

interface PlaceholderStore {
  codeBlocks: string[];
  inlineCodes: string[];
  urls: string[];
}

const PUA_START = "\uE000";
const PUA_END = "\uE001";

/**
 * Stage 1: Protect code blocks, inline code, and URLs with Unicode PUA tokens.
 */
function maskProtectedElements(input: string): { maskedText: string; store: PlaceholderStore } {
  const store: PlaceholderStore = {
    codeBlocks: [],
    inlineCodes: [],
    urls: [],
  };

  // 1. Mask fenced code blocks (```lang\ncode\n```)
  let maskedText = input.replace(/```[a-zA-Z0-9_-]*\n?([\s\S]*?)```/g, (_match, codeContent) => {
    const placeholder = `${PUA_START}CODE_BLOCK_${store.codeBlocks.length}${PUA_END}`;
    store.codeBlocks.push(codeContent.trim());
    return placeholder;
  });

  // 2. Mask inline code (`code`)
  maskedText = maskedText.replace(/`([^`\n]+)`/g, (_match, codeContent) => {
    const placeholder = `${PUA_START}INLINE_CODE_${store.inlineCodes.length}${PUA_END}`;
    store.inlineCodes.push(codeContent);
    return placeholder;
  });

  // 3. Mask URLs (http:// or https://)
  maskedText = maskedText.replace(/(https?:\/\/[^\s<>()]+)/g, (_match, url) => {
    const placeholder = `${PUA_START}URL_${store.urls.length}${PUA_END}`;
    store.urls.push(url);
    return placeholder;
  });

  return { maskedText, store };
}

/**
 * Stage 2: Transform Markdown structures to WhatsApp markup.
 */
function transformMarkdown(text: string): string {
  let result = text;

  // 1. Convert Markdown Tables to clean mobile-friendly bulleted rows
  result = convertMarkdownTables(result);

  // 2. Convert Headers (# Header, ## Subheader, etc.) to Bold lines
  result = result.replace(/^#{1,6}\s+(.+)$/gm, (_match, heading) => {
    const cleanHeading = heading.trim().replace(/^[*_~]+|[*_~]+$/g, "");
    return `*${cleanHeading}*`;
  });

  // 3. Convert Markdown Links: [Text](URL) -> *Text* (URL)
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_match, linkText, url) => {
    return `*${linkText.trim()}* (${url.trim()})`;
  });

  // 4. Convert Horizontal Rules (---, ***, ___) to clean divider
  result = result.replace(/^[\t ]*([*\-_]){3,}[\t ]*$/gm, "────────────────");

  // 5. Convert Unordered Lists (* item, - item, + item) to bullet points (•)
  result = result.replace(/^([\t ]*)[*\-+]\s+(.+)$/gm, (_match, indent, itemText) => {
    const bulletIndent = indent ? "   " : "";
    return `${bulletIndent}• ${itemText.trim()}`;
  });

  // 6. Convert Bold + Italic (***text*** or **_text_** or _**text**_) -> *_text_*
  result = result.replace(/\*\*\*(.+?)\*\*\*/g, "*_$1_*");
  result = result.replace(/\*\*_(.+?)_\*\*/g, "*_$1_*");
  result = result.replace(/_\*\*(.+?)\*\*_/g, "*_$1_*");

  // 7. Convert Bold (**text** or __text__) -> *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // 8. Convert Strikethrough (~~text~~) -> ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // 9. Normalize excessive blank lines (max 2 consecutive newlines)
  result = result.replace(/\n{3,}/g, "\n\n");

  return result;
}

/**
 * Converts Markdown table blocks into readable mobile-friendly rows.
 */
function convertMarkdownTables(text: string): string {
  const lines = text.split("\n");
  const output: string[] = [];
  let inTable = false;
  let headers: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();

    // Check if line is a table row (starts and ends with '|')
    if (line.startsWith("|") && line.endsWith("|")) {
      const cells = line
        .split("|")
        .slice(1, -1)
        .map((c) => c.trim());

      // Skip separator rows (e.g. |---|---|)
      if (cells.every((c) => /^:?-+:?$/.test(c))) {
        continue;
      }

      if (!inTable) {
        // First row is the header
        inTable = true;
        headers = cells;
        output.push("");
        continue;
      }

      // Format data row as key-value pairs using headers
      if (headers.length > 0) {
        const rowPairs = cells
          .map((val, idx) => {
            const header = headers[idx] || `Col ${idx + 1}`;
            return `*${header}:* ${val}`;
          })
          .filter(Boolean);

        output.push(`• ${rowPairs.join("  |  ")}`);
      } else {
        output.push(`• ${cells.join(" | ")}`);
      }
    } else {
      if (inTable) {
        inTable = false;
        headers = [];
        output.push("");
      }
      output.push(lines[i]!);
    }
  }

  return output.join("\n");
}

/**
 * Stage 3: Restore protected elements into the transformed text.
 */
function unmaskProtectedElements(text: string, store: PlaceholderStore): string {
  let result = text;

  // 1. Restore fenced code blocks with WhatsApp triple backticks
  store.codeBlocks.forEach((code, index) => {
    const placeholder = `${PUA_START}CODE_BLOCK_${index}${PUA_END}`;
    result = result.replace(placeholder, () => `\`\`\`\n${code}\n\`\`\``);
  });

  // 2. Restore inline code
  store.inlineCodes.forEach((code, index) => {
    const placeholder = `${PUA_START}INLINE_CODE_${index}${PUA_END}`;
    result = result.replace(placeholder, () => `\`${code}\``);
  });

  // 3. Restore URLs
  store.urls.forEach((url, index) => {
    const placeholder = `${PUA_START}URL_${index}${PUA_END}`;
    result = result.replace(placeholder, () => url);
  });

  return result;
}

/**
 * Main export: Converts standard Markdown to WhatsApp formatting.
 */
export function convertMarkdownToWhatsApp(markdownText: string): string {
  if (!markdownText) return "";

  // 1. Mask code blocks, inline code, and URLs
  const { maskedText, store } = maskProtectedElements(markdownText);

  // 2. Apply typography & structure transformations
  const transformedText = transformMarkdown(maskedText);

  // 3. Restore protected elements
  return unmaskProtectedElements(transformedText, store).trim();
}