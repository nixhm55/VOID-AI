import { authenticatedFetch } from './api-fetch';
import { cosineSimilarityStrict } from './tools/embeddings';
import type { VoidAiEmbeddingModel } from './tools/config';

export interface StoredMemoryItem {
  id: string;
  text: string;
  model: VoidAiEmbeddingModel;
  dimensions: number;
  embedding: number[];
  createdAt: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

/**
 * Partitioned vector store that strictly separates embeddings by vector dimension
 * (e.g. 3072 for `text-embedding-3-large` vs 1536 for `text-embedding-3-small`)
 * so vectors with incompatible dimensions are never mixed in the same index.
 */
export interface PartitionedMemoryStore {
  version: number;
  byDimension: Record<string, StoredMemoryItem[]>;
}

const MEMORY_STORAGE_KEY = 'void_ai_semantic_memories_v1';
const LEGACY_MEMORY_STORAGE_KEYS = ['void_ai_memories', 'void_memories_v1'];

function emptyStore(): PartitionedMemoryStore {
  return {
    version: 1,
    byDimension: {
      '3072': [],
      '1536': [],
    },
  };
}

/**
 * Loads stored memories and safely migrates any legacy flat memory arrays
 * into dimension-partitioned indexes without losing existing memory data.
 */
export function loadMemoryStore(): PartitionedMemoryStore {
  if (typeof window === 'undefined') return emptyStore();

  try {
    const raw = window.localStorage.getItem(MEMORY_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PartitionedMemoryStore>;
      if (parsed && typeof parsed === 'object' && parsed.byDimension) {
        const byDimension: Record<string, StoredMemoryItem[]> = {
          '3072': [],
          '1536': [],
        };
        for (const [dimKey, list] of Object.entries(parsed.byDimension)) {
          if (!Array.isArray(list)) continue;
          for (const item of list) {
            if (
              item &&
              typeof item.id === 'string' &&
              typeof item.text === 'string' &&
              Array.isArray(item.embedding)
            ) {
              const actualDim = item.embedding.length || Number(dimKey) || 0;
              const targetKey = String(actualDim);
              if (!byDimension[targetKey]) {
                byDimension[targetKey] = [];
              }
              byDimension[targetKey].push({
                ...item,
                dimensions: actualDim,
              });
            }
          }
        }
        return { version: 1, byDimension };
      }
    }

    // Check legacy keys and preserve any existing stored memories
    const store = emptyStore();
    for (const legacyKey of LEGACY_MEMORY_STORAGE_KEYS) {
      const legacyRaw = window.localStorage.getItem(legacyKey);
      if (!legacyRaw) continue;
      const legacyParsed = JSON.parse(legacyRaw);
      if (Array.isArray(legacyParsed)) {
        for (const entry of legacyParsed) {
          if (!entry || typeof entry.text !== 'string') continue;
          const vec = Array.isArray(entry.embedding) ? entry.embedding : [];
          const dim = vec.length;
          const dimKey = String(dim);
          if (!store.byDimension[dimKey]) {
            store.byDimension[dimKey] = [];
          }
          store.byDimension[dimKey].push({
            id: String(entry.id ?? `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`),
            text: entry.text,
            model:
              dim === 1536
                ? 'text-embedding-3-small'
                : 'text-embedding-3-large',
            dimensions: dim,
            embedding: vec,
            createdAt: Number(entry.createdAt ?? Date.now()),
            updatedAt: Number(entry.updatedAt ?? Date.now()),
          });
        }
      }
    }

    return store;
  } catch {
    return emptyStore();
  }
}

export function saveMemoryStore(store: PartitionedMemoryStore): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(MEMORY_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota errors
  }
}

export function listAllStoredMemories(): StoredMemoryItem[] {
  const store = loadMemoryStore();
  return Object.values(store.byDimension)
    .flat()
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Embeds a memory text via `/api/embeddings` (Primary: `text-embedding-3-large` ->
 * Fallback: `text-embedding-3-small`) and stores it in the matching dimension partition.
 */
export async function addSemanticMemory(options: {
  text: string;
  preferredModel?: VoidAiEmbeddingModel;
}): Promise<StoredMemoryItem> {
  const cleanText = options.text.trim();
  if (!cleanText) {
    throw new Error('Memory text cannot be empty.');
  }

  const res = await authenticatedFetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: cleanText,
      model: options.preferredModel ?? 'text-embedding-3-large',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      typeof err?.error === 'string'
        ? err.error
        : `Embedding request failed (${res.status})`,
    );
  }

  const payload = (await res.json()) as {
    model: VoidAiEmbeddingModel;
    dimensions: number;
    data: Array<{ embedding: number[]; dimensions: number }>;
  };

  const first = payload.data?.[0];
  if (!first || !Array.isArray(first.embedding) || first.embedding.length === 0) {
    throw new Error('No embedding vector returned.');
  }

  const dimensions = first.embedding.length;
  const item: StoredMemoryItem = {
    id:
      globalThis.crypto?.randomUUID?.() ??
      `mem-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    text: cleanText,
    model: payload.model,
    dimensions,
    embedding: first.embedding,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const store = loadMemoryStore();
  const dimKey = String(dimensions);
  if (!store.byDimension[dimKey]) {
    store.byDimension[dimKey] = [];
  }
  store.byDimension[dimKey] = [
    item,
    ...store.byDimension[dimKey].filter((m) => m.text !== cleanText),
  ];
  saveMemoryStore(store);

  return item;
}

/**
 * Searches stored memories strictly within the matching vector dimension partition.
 * If stored memories exist in another dimension partition and `safeMigrateIfNeeded` is true,
 * safely re-embeds and migrates them into the active dimension partition without losing data.
 */
export async function searchSemanticMemories(options: {
  query: string;
  preferredModel?: VoidAiEmbeddingModel;
  topK?: number;
  safeMigrateIfNeeded?: boolean;
}): Promise<Array<{ item: StoredMemoryItem; score: number }>> {
  const cleanQuery = options.query.trim();
  if (!cleanQuery) return [];

  const res = await authenticatedFetch('/api/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: cleanQuery,
      model: options.preferredModel ?? 'text-embedding-3-large',
    }),
  });

  if (!res.ok) return [];

  const payload = (await res.json()) as {
    model: VoidAiEmbeddingModel;
    dimensions: number;
    data: Array<{ embedding: number[]; dimensions: number }>;
  };

  const queryVec = payload.data?.[0]?.embedding;
  if (!Array.isArray(queryVec) || queryVec.length === 0) return [];

  const targetDim = queryVec.length;
  const dimKey = String(targetDim);
  const store = loadMemoryStore();

  // Safe migration: if memories exist in other dimension partitions that haven't been
  // indexed at targetDim yet, re-embed their text into targetDim while preserving originals.
  if (options.safeMigrateIfNeeded !== false) {
    const existingTextsInTarget = new Set(
      (store.byDimension[dimKey] ?? []).map((m) => m.text),
    );
    const otherMemories = Object.entries(store.byDimension)
      .filter(([k]) => k !== dimKey)
      .flatMap(([, list]) => list)
      .filter((m) => !existingTextsInTarget.has(m.text));

    if (otherMemories.length > 0) {
      try {
        const batchRes = await authenticatedFetch('/api/embeddings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: otherMemories.map((m) => m.text),
            model: payload.model,
          }),
        });
        if (batchRes.ok) {
          const batchData = (await batchRes.json()) as {
            model: VoidAiEmbeddingModel;
            data: Array<{ index: number; embedding: number[] }>;
          };
          if (Array.isArray(batchData.data)) {
            if (!store.byDimension[dimKey]) {
              store.byDimension[dimKey] = [];
            }
            for (const vecEntry of batchData.data) {
              const sourceMem = otherMemories[vecEntry.index];
              if (
                sourceMem &&
                Array.isArray(vecEntry.embedding) &&
                vecEntry.embedding.length === targetDim
              ) {
                store.byDimension[dimKey].push({
                  ...sourceMem,
                  id: `${sourceMem.id}-${targetDim}`,
                  model: batchData.model,
                  dimensions: targetDim,
                  embedding: vecEntry.embedding,
                  updatedAt: Date.now(),
                });
              }
            }
            saveMemoryStore(store);
          }
        }
      } catch {
        // Keep existing memories untouched on migration error
      }
    }
  }

  const partition = store.byDimension[dimKey] ?? [];
  const scored = partition
    .filter((item) => item.embedding.length === targetDim)
    .map((item) => ({
      item,
      score: cosineSimilarityStrict(queryVec, item.embedding),
    }))
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, options.topK ?? 5);
}
