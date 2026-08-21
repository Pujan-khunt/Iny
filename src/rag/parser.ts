import { extractText } from "unpdf";

export async function parsePdf(data: Buffer | Uint8Array): Promise<string> {
  const buffer = data instanceof Buffer ? new Uint8Array(data) : data;
  const result = await extractText(buffer, { mergePages: true });
  const raw = typeof result.text === "string" ? result.text : (result.text as string[]).join("\n\n");
  return normalizeText(raw);
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
