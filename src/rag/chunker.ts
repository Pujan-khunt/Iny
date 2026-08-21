import { getEncoding } from "js-tiktoken";

const enc = getEncoding("cl100k_base");

const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_OVERLAP_TOKENS = 50;

export interface Chunk {
  content: string;
  tokenCount: number;
  chunkIndex: number;
  headings: string[];
}

export interface ChunkOptions {
  maxTokens?: number;
  overlapTokens?: number;
}

function countTokens(text: string): number {
  return enc.encode(text).length;
}

function isHeading(line: string): boolean {
  const t = line.trim();
  if (!t || t.length > 120) return false;
  if (/^#{1,6}\s+/.test(t)) return true;
  if (/^\d+(\.\d+)*[\.\)]\s+\S/.test(t)) return true;
  if (t === t.toUpperCase() && /[A-Z]/.test(t) && t.split(/\s+/).length <= 10 && t.length >= 4) return true;
  if (/^[A-Z][A-Za-z\s]+:$/.test(t) && t.length < 80) return true;
  return false;
}

function extractHeadingText(line: string): string {
  return line
    .replace(/^#{1,6}\s+/, "")
    .replace(/:$/, "")
    .trim();
}

export function chunkText(rawText: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;
  const overlapTokens = opts.overlapTokens ?? DEFAULT_OVERLAP_TOKENS;

  const normalized = rawText.replace(/\r\n/g, "\n").trim();
  if (!normalized) return [];

  const blocks = normalized
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  type Para = { text: string; headings: string[] };
  const paragraphs: Para[] = [];
  let headingStack: string[] = [];

  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const headingLines: string[] = [];
    const contentLines: string[] = [];

    for (const line of lines) {
      if (isHeading(line)) {
        headingLines.push(extractHeadingText(line));
      } else {
        contentLines.push(line);
      }
    }

    if (headingLines.length > 0 && contentLines.length === 0) {
      headingStack = headingLines;
      continue;
    }

    if (headingLines.length > 0) {
      headingStack = headingLines;
    }

    const text = contentLines.join(" ");
    if (text) {
      paragraphs.push({ text, headings: [...headingStack] });
    } else if (headingLines.length === 0) {
      paragraphs.push({ text: block, headings: [...headingStack] });
    }
  }

  if (paragraphs.length === 0 && blocks.length > 0) {
    for (const b of blocks) paragraphs.push({ text: b, headings: [] });
  }

  const chunks: Chunk[] = [];
  let currentParts: string[] = [];
  let currentHeadings: string[] = [];
  let currentTokens = 0;
  let headingsForChunk: string[] = [];

  function breadcrumb(headings: string[]): string {
    return headings.join(" > ");
  }

  function flush(): void {
    if (currentParts.length === 0) return;
    const body = currentParts.join("\n\n");
    const prefix = headingsForChunk.length > 0 ? `${breadcrumb(headingsForChunk)}\n\n` : "";
    const content = prefix ? `${prefix}${body}` : body;
    const tokenCount = countTokens(content);
    chunks.push({
      content,
      tokenCount,
      chunkIndex: chunks.length,
      headings: [...headingsForChunk],
    });
  }

  for (const para of paragraphs) {
    const paraTokens = countTokens(para.text);

    if (paraTokens > maxTokens) {
      flush();
      currentParts = [];
      currentTokens = 0;
      headingsForChunk = [...para.headings];

      const sentences = para.text.split(/(?<=[.!?])\s+/);
      let sentenceBuffer: string[] = [];
      let bufferTokens = 0;

      for (const sentence of sentences) {
        const sTokens = countTokens(sentence);
        if (bufferTokens + sTokens > maxTokens && sentenceBuffer.length > 0) {
          const body = sentenceBuffer.join(" ");
          const prefix = headingsForChunk.length > 0 ? `${breadcrumb(headingsForChunk)}\n\n` : "";
          const content = prefix ? `${prefix}${body}` : body;
          chunks.push({
            content,
            tokenCount: countTokens(content),
            chunkIndex: chunks.length,
            headings: [...headingsForChunk],
          });
          const overlapText = decodeLastTokens(body, overlapTokens);
          sentenceBuffer = overlapText ? [overlapText, sentence] : [sentence];
          bufferTokens = countTokens(sentenceBuffer.join(" "));
        } else {
          sentenceBuffer.push(sentence);
          bufferTokens += sTokens;
        }
      }

      if (sentenceBuffer.length > 0) {
        const body = sentenceBuffer.join(" ");
        const prefix = headingsForChunk.length > 0 ? `${breadcrumb(headingsForChunk)}\n\n` : "";
        const content = prefix ? `${prefix}${body}` : body;
        chunks.push({
          content,
          tokenCount: countTokens(content),
          chunkIndex: chunks.length,
          headings: [...headingsForChunk],
        });
      }

      currentParts = [];
      currentTokens = 0;
      headingsForChunk = [];
      continue;
    }

    const prefixTokens = headingsForChunk.length === 0 && para.headings.length > 0 ? countTokens(`${breadcrumb(para.headings)}\n\n`) : 0;
    const needed = currentTokens === 0 ? paraTokens + prefixTokens : paraTokens + 1;

    if (currentTokens + needed > maxTokens && currentParts.length > 0) {
      flush();
      const prevBody = currentParts.join("\n\n");
      const overlapText = decodeLastTokens(prevBody, overlapTokens);
      currentParts = overlapText ? [overlapText, para.text] : [para.text];
      currentTokens = countTokens(currentParts.join("\n\n"));
      headingsForChunk = [...para.headings];
      currentHeadings = [...para.headings];
    } else {
      if (currentParts.length === 0) {
        headingsForChunk = [...para.headings];
        currentHeadings = [...para.headings];
        currentTokens = prefixTokens;
      } else if (para.headings.join("|") !== currentHeadings.join("|")) {
        currentHeadings = [...para.headings];
      }
      currentParts.push(para.text);
      currentTokens += needed;
    }
  }

  flush();
  return chunks;
}

function decodeLastTokens(text: string, n: number): string {
  if (n <= 0) return "";
  const tokens = enc.encode(text);
  if (tokens.length <= n) return text;
  const slice = tokens.slice(tokens.length - n);
  return enc.decode(slice);
}
