import { db } from "../db/index.js";
import { sql } from "drizzle-orm";
import { OpenAIEmbeddingClient } from "../embeddings/client.js";
import { SIMILARITY_THRESHOLD, TOP_K } from "../config.js";

export interface RetrievedChunk {
  content: string;
  title: string;
  pageStart: number;
  pageEnd: number;
  score: number;
  simScore?: number | undefined;
  textScore?: number | undefined;
  matchType?: "hybrid" | "semantic" | "keyword" | undefined;
}

interface HybridRow extends Record<string, unknown> {
  id: string;
  content: string;
  title: string;
  page_start: number;
  page_end: number;
  sim_score: number;
  text_score: number;
  rrf_score: number;
}

/**
 * Performs hybrid retrieval combining dense vector similarity (pgvector)
 * and sparse full-text search (PostgreSQL tsvector) fused via Reciprocal Rank Fusion (RRF).
 */
export async function retrieveTopK(
  query: string,
  opts: { topK?: number; threshold?: number } = {},
): Promise<RetrievedChunk[]> {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) {
    return [];
  }

  const topK = opts.topK ?? TOP_K;
  const threshold = opts.threshold ?? SIMILARITY_THRESHOLD;
  const candidateLimit = Math.max(topK * 4, 20);

  // Generate dense query embedding
  const client = new OpenAIEmbeddingClient();
  const vectors = await client.embedBatch([trimmedQuery]);
  const queryVector = vectors[0]!;
  const vectorString = `[${queryVector.join(",")}]`;

  // Hybrid SQL Query with Reciprocal Rank Fusion (RRF k=60)
  const querySql = sql`
    WITH vector_search AS (
      SELECT
        c.id,
        c.content,
        c.page_start,
        c.page_end,
        d.title,
        (1 - (c.embedding <=> ${vectorString}::vector)) AS sim_score,
        ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${vectorString}::vector) AS rank_vec
      FROM chunks c
      INNER JOIN documents d ON c.document_id = d.id
      WHERE c.source_type = 'document'
      ORDER BY c.embedding <=> ${vectorString}::vector
      LIMIT ${candidateLimit}
    ),
    text_search AS (
      SELECT
        c.id,
        c.content,
        c.page_start,
        c.page_end,
        d.title,
        ts_rank_cd(
          to_tsvector('english', c.content),
          COALESCE(
            NULLIF(websearch_to_tsquery('english', ${trimmedQuery}), ''::tsquery),
            plainto_tsquery('english', ${trimmedQuery})
          )
        ) AS text_score,
        ROW_NUMBER() OVER (
          ORDER BY ts_rank_cd(
            to_tsvector('english', c.content),
            COALESCE(
              NULLIF(websearch_to_tsquery('english', ${trimmedQuery}), ''::tsquery),
              plainto_tsquery('english', ${trimmedQuery})
            )
          ) DESC
        ) AS rank_text
      FROM chunks c
      INNER JOIN documents d ON c.document_id = d.id
      WHERE c.source_type = 'document'
        AND (
          to_tsvector('english', c.content) @@
          COALESCE(
            NULLIF(websearch_to_tsquery('english', ${trimmedQuery}), ''::tsquery),
            plainto_tsquery('english', ${trimmedQuery})
          )
        )
      ORDER BY text_score DESC
      LIMIT ${candidateLimit}
    )
    SELECT
      COALESCE(v.id, t.id) AS id,
      COALESCE(v.content, t.content) AS content,
      COALESCE(v.title, t.title) AS title,
      COALESCE(v.page_start, t.page_start) AS page_start,
      COALESCE(v.page_end, t.page_end) AS page_end,
      COALESCE(v.sim_score, 0)::float AS sim_score,
      COALESCE(t.text_score, 0)::float AS text_score,
      (
        COALESCE(1.0 / (60.0 + v.rank_vec), 0.0) +
        COALESCE(1.0 / (60.0 + t.rank_text), 0.0)
      )::float AS rrf_score
    FROM vector_search v
    FULL OUTER JOIN text_search t ON v.id = t.id
    ORDER BY rrf_score DESC
    LIMIT ${topK};
  `;

  const result = await db.execute<HybridRow>(querySql);
  const rows = result.rows || [];

  return rows
    .filter((r) => {
      const hasKeywordMatch = (r.text_score ?? 0) > 0;
      const hasSufficientSimilarity = (r.sim_score ?? 0) >= threshold;
      // Retain if it matched exact keywords, or passed the semantic similarity threshold
      return hasKeywordMatch || hasSufficientSimilarity;
    })
    .map((r) => {
      const hasKeywordMatch = (r.text_score ?? 0) > 0;
      const hasSemanticMatch = (r.sim_score ?? 0) >= threshold;

      let matchType: "hybrid" | "semantic" | "keyword" = "semantic";
      if (hasKeywordMatch && hasSemanticMatch) {
        matchType = "hybrid";
      } else if (hasKeywordMatch) {
        matchType = "keyword";
      }

      return {
        content: r.content,
        title: r.title,
        pageStart: r.page_start,
        pageEnd: r.page_end,
        score: Number(r.rrf_score.toFixed(4)),
        simScore: Number((r.sim_score ?? 0).toFixed(4)),
        textScore: Number((r.text_score ?? 0).toFixed(4)),
        matchType,
      };
    });
}
