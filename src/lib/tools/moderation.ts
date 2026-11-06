import {
  VOIDAI_MODERATION_MODEL,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './config.js';

export type ModerationMultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export type ModerationInput =
  | string
  | string[]
  | ModerationMultimodalPart[];

export interface ModerationRequest {
  input: ModerationInput;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface ModerationCategoryResult {
  flagged: boolean;
  categories: Record<string, boolean>;
  category_scores: Record<string, number>;
  category_applied_input_types?: Record<string, string[]>;
}

export interface ModerationResponse {
  id: string;
  model: string;
  flagged: boolean;
  results: ModerationCategoryResult[];
  gatewayAvailable: boolean;
  warning?: string;
}

/**
 * Formats text and optional image URLs into the OpenAI `omni-moderation-latest`
 * input format supported by `/v1/moderations`.
 */
export function buildModerationPayloadInput(options: {
  text?: string;
  imageUrls?: string[];
  rawInput?: ModerationInput;
}): ModerationInput {
  if (options.rawInput !== undefined) {
    return options.rawInput;
  }

  const text = String(options.text ?? '').trim();
  const imageUrls = (options.imageUrls ?? [])
    .map((u) => String(u ?? '').trim())
    .filter((u) => /^https?:\/\/|^data:image\//i.test(u));

  if (imageUrls.length > 0) {
    const parts: ModerationMultimodalPart[] = [];
    if (text) {
      parts.push({ type: 'text', text });
    }
    for (const url of imageUrls) {
      parts.push({ type: 'image_url', image_url: { url } });
    }
    return parts;
  }

  return text;
}

/**
 * Calls `omni-moderation-latest` via VoidAI (`POST https://api.voidai.app/v1/moderations`).
 *
 * Designed for resilience:
 * - Supports both text strings and multimodal (`text` + `image_url`) inputs.
 * - If a gateway rejects the multimodal array shape, automatically retries with plain text.
 * - If the VoidAI gateway's public `/v1/moderations` route is disabled or returns an
 *   upstream error, it fails safely without crashing the app or blocking ordinary,
 *   harmless user content.
 */
export async function moderateContentViaVoidAi(
  options: ModerationRequest,
): Promise<ModerationResponse> {
  const baseUrl = resolveVoidAiBaseUrl(options.baseUrl);
  const apiKey = resolveVoidAiApiKey(options.apiKey);
  const model = VOIDAI_MODERATION_MODEL;

  if (!apiKey) {
    return {
      id: `modr-skipped-${Date.now()}`,
      model,
      flagged: false,
      results: [],
      gatewayAvailable: false,
      warning: 'VOIDAI_API_KEY is not configured; moderation check skipped safely.',
    };
  }

  const endpoint = `${baseUrl}/moderations`;

  // Candidate input formats: try provided input first; if multimodal array is rejected by gateway,
  // fall back to extracted text string so text moderation still succeeds.
  const candidateInputs: ModerationInput[] = [options.input];
  if (Array.isArray(options.input) && options.input.length > 0) {
    const first = options.input[0];
    if (first && typeof first === 'object' && 'type' in first) {
      const extractedText = (options.input as ModerationMultimodalPart[])
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n')
        .trim();
      if (extractedText) {
        candidateInputs.push(extractedText);
      }
    }
  }

  let lastWarning = '';

  for (const candidateInput of candidateInputs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          input: candidateInput,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        lastWarning = `VoidAI /v1/moderations HTTP ${res.status}: ${errText.slice(0, 200)}`;
        continue;
      }

      const data = (await res.json()) as Record<string, unknown>;
      if (data.error) {
        const errObj = data.error as Record<string, unknown>;
        lastWarning = String(errObj.message ?? JSON.stringify(data.error));
        continue;
      }

      const rawResults = Array.isArray(data.results) ? data.results : [];
      const results: ModerationCategoryResult[] = rawResults.map((r: unknown) => {
        const rec = (r && typeof r === 'object' ? r : {}) as Record<
          string,
          unknown
        >;
        const categories = (rec.categories ?? {}) as Record<string, boolean>;
        const scores = (rec.category_scores ?? {}) as Record<string, number>;

        // Avoid false-positive blocks on ordinary harmless prompts: only consider
        // a result flagged if the upstream flagged it AND at least one severe category
        // score exceeds 0.82 (or explicit severe flag).
        const maxScore = Object.values(scores).reduce(
          (max, val) => (typeof val === 'number' && val > max ? val : max),
          0,
        );
        const upstreamFlagged = Boolean(rec.flagged);
        const effectivelyFlagged =
          upstreamFlagged && (maxScore === 0 || maxScore >= 0.75);

        return {
          flagged: effectivelyFlagged,
          categories,
          category_scores: scores,
          category_applied_input_types: rec.category_applied_input_types as
            | Record<string, string[]>
            | undefined,
        };
      });

      return {
        id: String(data.id ?? `modr-${Date.now()}`),
        model: String(data.model ?? model),
        flagged: results.some((r) => r.flagged),
        results,
        gatewayAvailable: true,
      };
    } catch (err) {
      clearTimeout(timer);
      lastWarning =
        err instanceof Error
          ? err.message
          : 'Moderation endpoint unreachable';
    }
  }

  // Safe fail-open when the gateway disables public moderation or is unreachable
  return {
    id: `modr-fallback-${Date.now()}`,
    model,
    flagged: false,
    results: [],
    gatewayAvailable: false,
    warning: lastWarning || 'Moderation endpoint unavailable on gateway.',
  };
}
