import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import { ingestFile } from "../src/rag/ingest.js";
import {
  R2_ENDPOINT,
  R2_ACCESS_KEY_ID,
  R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME,
} from "../src/config.js";

/**
 * R2 ingestion script.
 * Pulls .md files from a Cloudflare R2 bucket (via S3-compatible API)
 * and ingests them using the same ingestFile() pipeline as local ingestion.
 *
 * Usage:
 *   npm run ingest:r2                          # ingest all .md files
 *   npm run ingest:r2 -- --prefix docs/        # ingest files under a prefix
 */

function parseArgs(args: string[]): { prefix: string; maxTokens: number } {
  let prefix = "";
  let maxTokens = 500;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prefix" && args[i + 1]) {
      prefix = args[i + 1]!;
      i++;
    } else if (args[i] === "--max-tokens" && args[i + 1]) {
      maxTokens = parseInt(args[i + 1]!, 10);
      i++;
    }
  }

  return { prefix, maxTokens };
}

function createR2Client(): S3Client {
  if (!R2_ENDPOINT) {
    throw new Error("R2_ENDPOINT is not set. Set it in your .env file.");
  }
  if (!R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      "R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required. " +
        "Generate an API token at https://dash.cloudflare.com → R2 → Manage R2 API Tokens.",
    );
  }
  if (!R2_BUCKET_NAME) {
    throw new Error("R2_BUCKET_NAME is not set. Set it in your .env file.");
  }

  return new S3Client({
    region: "auto",
    endpoint: R2_ENDPOINT,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

async function listMarkdownFiles(client: S3Client, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: R2_BUCKET_NAME!,
      Prefix: prefix || undefined,
      ContinuationToken: continuationToken,
    });

    const response = await client.send(command);

    for (const object of response.Contents ?? []) {
      if (object.Key && object.Key.endsWith(".md")) {
        keys.push(object.Key);
      }
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return keys;
}

async function downloadFile(client: S3Client, key: string): Promise<Buffer> {
  const command = new GetObjectCommand({
    Bucket: R2_BUCKET_NAME!,
    Key: key,
  });

  const response = await client.send(command);
  const stream = response.Body;

  if (!stream) {
    throw new Error(`Empty response body for key: ${key}`);
  }

  // @aws-sdk/client-s3 returns a ReadableStream in Node; convert to Buffer
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function main(): Promise<void> {
  const { prefix, maxTokens } = parseArgs(process.argv.slice(2));

  console.log("🪣 Iny R2 Ingestion");
  console.log(`   Bucket:     ${R2_BUCKET_NAME}`);
  console.log(`   Prefix:     ${prefix || "(root)"}`);
  console.log(`   Max tokens: ${maxTokens}`);
  console.log();

  const client = createR2Client();

  // 1. List all .md files in the bucket
  console.log("Listing .md files in R2...");
  const keys = await listMarkdownFiles(client, prefix);

  if (keys.length === 0) {
    console.log("No .md files found in R2 bucket. Nothing to ingest.");
    return;
  }

  console.log(`Found ${keys.length} markdown file(s)\n`);

  // 2. Download and ingest each file
  let totalChunks = 0;
  let totalTokens = 0;
  let totalCost = 0;
  let skipped = 0;

  for (const key of keys) {
    process.stdout.write(`  ${key} ... `);

    try {
      const buffer = await downloadFile(client, key);
      const result = await ingestFile(key, buffer, {
        maxTokens,
        overlapTokens: 50,
        sourceType: "document",
      });

      if (result.chunksCreated === 0) {
        console.log("⏭  unchanged");
        skipped++;
      } else {
        console.log(
          `✅  ${result.chunksCreated} chunks, ${result.tokens} tokens, $${result.costUsd.toFixed(6)}`,
        );
        totalChunks += result.chunksCreated;
        totalTokens += result.tokens;
        totalCost += result.costUsd;
      }
    } catch (err) {
      console.log(`❌  ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Summary
  console.log("\n=== Ingest Complete ===");
  console.log(`Files processed: ${keys.length}`);
  console.log(`Files skipped:   ${skipped} (content unchanged)`);
  console.log(`Chunks created:  ${totalChunks}`);
  console.log(`Total tokens:    ${totalTokens}`);
  console.log(`Estimated cost:  $${totalCost.toFixed(6)}`);
}

main().catch((err) => {
  console.error("Ingest failed:", err);
  process.exit(1);
});
