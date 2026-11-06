import {
  EMBEDDING_MODEL_DIMENSIONS,
  VOIDAI_EMBEDDING_MODELS,
  type VoidAiEmbeddingModel,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './config.js';

export interface EmbeddingRequest {
  input: string | string[];
  model?: VoidAiEmbeddingModel;
  baseUrl?: string;
  apiKey?: string;
}

export interface EmbeddingVectorItem {
  index: number;
  embedding: number[];
  dimensions: number;
}

export interface EmbeddingResponse {
  model: VoidAiEmbeddingModel;
  requestedModel: VoidAiEmbeddingModel;
  fallbackUsed: boolean;
  dimensions: number;
  data: EmbeddingVectorItem[];
  usage?: {
    prompt_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * Builds the ordered fallback chain for Memory / Embeddings.
 * Primary: `text-embedding-3-large` (3072 dims) -> Fallback: `text-embedding-3-small` (1536 dims).
 */
export function getEmbeddingFallbackChain(
  preferredModel?: string,
): VoidAiEmbeddingModel[] {
  const normalized = String(preferredModel ?? '').trim() as VoidAiEmbeddingModel;
  if (normalized === 'text-embedding-3-small') {
    return ['text-embedding-3-small', 'text-embedding-3-large'];
  }
  // Default Primary -> Fallback order
  return [...VOIDAI_EMBEDDING_MODELS];
}

/**
 * Generates embeddings via VoidAI Unified API (`POST https://api.voidai.app/v1/embeddings`)
 * with automatic fallback from `text-embedding-3-large` (Primary) to `text-embedding-3-small` (Fallback).
 * Keeps vector dimensions strictly validated and separated so 3072-dim and 1536-dim vectors
 * are never mixed in the same index.
 */
export async function createEmbeddingsViaVoidAi(
  options: EmbeddingRequest,
): Promise<EmbeddingResponse> {
  const rawInput = options.input;
  const inputs = (Array.isArray(rawInput) ? rawInput : [rawInput])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);

  if (inputs.length === 0) {
    throw new Error('Input text is required to generate embeddings.');
  }

  const baseUrl = resolveVoidAiBaseUrl(options.baseUrl);
  const apiKey = resolveVoidAiApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error(
      'VOIDAI_API_KEY is not configured in the server environment (.env).',
    );
  }

  const chain = getEmbeddingFallbackChain(options.model);
  const requestedModel = chain[0];
  const endpoint = `${baseUrl}/embeddings`;
  let lastError = 'All embedding models failed.';

  for (let i = 0; i < chain.length; i += 1) {
    const candidateModel = chain[i];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: candidateModel,
          input: inputs.length === 1 ? inputs[0] : inputs,
          encoding_format: 'float',
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        lastError = `Model ${candidateModel} failed with HTTP ${res.status}: ${errText.slice(0, 240)}`;
        continue;
      }

      const json = (await res.json()) as Record<string, unknown>;
      if (json.error) {
        const errObj = json.error as Record<string, unknown>;
        lastError = String(errObj.message ?? JSON.stringify(json.error));
        continue;
      }

      const rawData = Array.isArray(json.data) ? json.data : [];
      if (rawData.length === 0) {
        lastError = `Model ${candidateModel} returned empty embedding data.`;
        continue;
      }

      const expectedDims = EMBEDDING_MODEL_DIMENSIONS[candidateModel];
      const vectors: EmbeddingVectorItem[] = [];

      for (let idx = 0; idx < rawData.length; idx += 1) {
        const item = rawData[idx] as Record<string, unknown>;
        const rawVec = Array.isArray(item?.embedding) ? item.embedding : [];
        const floatVec = rawVec
          .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0));

        if (floatVec.length === 0) {
          throw new Error(
            `Invalid empty vector returned by ${candidateModel}.`,
          );
        }

        vectors.push({
          index: typeof item.index === 'number' ? item.index : idx,
          embedding: floatVec,
          dimensions: floatVec.length,
        });
      }

      const actualDimensions = vectors[0].dimensions;
      // Verify all returned vectors in this batch share the exact same dimension
      if (vectors.some((v) => v.dimensions !== actualDimensions)) {
        throw new Error(
          `Inconsistent vector dimensions returned by ${candidateModel}.`,
        );
      }

      return {
        model: candidateModel,
        requestedModel,
        fallbackUsed: candidateModel !== requestedModel,
        dimensions: actualDimensions || expectedDims,
        data: vectors,
        usage: json.usage as EmbeddingResponse['usage'],
      };
    } catch (err) {
      clearTimeout(timer);
      lastError =
        err instanceof Error ? err.message : `Embedding request failed on ${candidateModel}`;
    }
  }

  throw new Error(lastError);
}

/**
 * Computes cosine similarity strictly between two vectors of identical dimensions.
 * Throws if dimensions do not match so incompatible embeddings (e.g. 3072 vs 1536)
 * are never mixed in the same index comparison.
 */
export function cosineSimilarityStrict(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) {
    throw new Error('Cannot compare empty embedding vectors.');
  }
  if (a.length !== b.length) {
    throw new Error(
      `Dimension mismatch: cannot mix ${a.length}-dim and ${b.length}-dim embeddings in the same index.`,
    );
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}
