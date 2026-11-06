import {
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './config.js';

export interface ImageGenerationRequest {
  prompt: string;
  size?: string;
  baseUrl?: string;
  apiKeys?: string[];
  voidAiBaseUrl?: string;
  voidAiApiKey?: string;
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  imageUrl: string;
  revisedPrompt: string;
  provider: 'omniroute' | 'voidai' | 'flux-fallback';
  model: string;
}

const IMAGE_GENERATION_INTENT_REGEX =
  /^(?:\/image\b|@image\b)|(?:\b(?:create|generate|draw|make|design|render|paint|produce|show\s+me)\s+(?:an?\s+|some\s+|the\s+|me\s+an?\s+)?(?:image|picture|photo|illustration|artwork|wallpaper|poster|logo|icon|avatar|portrait|diagram|drawing)\b)|(?:\b(?:image|picture|photo)\s+(?:create|generate|undakku|undakkan|varakku)\b)|(?:ഇമേജ്\s*(?:ക്രിയേറ്റ്|ഉണ്ടാക്ക്|ഉണ്ടാക്കൂ|വരയ്ക്കൂ))|(?:ചിത്രം\s*(?:വരയ്ക്കൂ|ഉണ്ടാക്കൂ|ക്രിയേറ്റ്))/i;

/**
 * Detects whether a user message is asking to generate/create an image.
 */
export function shouldTriggerImageGeneration(text: string): boolean {
  const cleaned = String(text ?? '').trim();
  if (!cleaned) return false;
  return IMAGE_GENERATION_INTENT_REGEX.test(cleaned);
}

/**
 * Extracts a clean visual description prompt from the user's request.
 */
export function extractImageGenerationPrompt(rawText: string): string {
  const cleaned = String(rawText ?? '')
    .replace(/^(?:\/image|@image)\s*/i, '')
    .replace(
      /^(?:please\s+|can\s+you\s+|could\s+you\s+|bro\s+)?(?:create|generate|draw|make|design|render|paint|show\s+me)\s+(?:an?\s+|the\s+|me\s+an?\s+)?(?:image|picture|photo|illustration|artwork|wallpaper|poster|logo)\s*(?:of|for|about|showing|with|:|-)?\s*/i,
      '',
    )
    .trim();
  return cleaned || String(rawText ?? '').trim();
}

const OMNIROUTE_IMAGE_MODELS = [
  'dall-e-3',
  'gpt-image-1',
  'flux',
  'flux-1-schnell',
  'black-forest-labs/FLUX.1-schnell',
  'dall-e-2',
];

async function tryOpenAiCompatibleImageEndpoint(options: {
  endpoint: string;
  apiKey: string;
  model: string;
  prompt: string;
  size: string;
  provider: 'omniroute' | 'voidai';
  signal?: AbortSignal;
}): Promise<ImageGenerationResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 22000);
  const onParentAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const res = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model,
        prompt: options.prompt,
        n: 1,
        size: options.size,
      }),
      signal: controller.signal,
    });

    clearTimeout(timer);
    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    const list = Array.isArray(data.data) ? data.data : [];
    const first =
      list.length > 0 && list[0] && typeof list[0] === 'object'
        ? (list[0] as Record<string, unknown>)
        : null;

    if (!first) return null;

    if (typeof first.url === 'string' && first.url.trim()) {
      return {
        imageUrl: first.url.trim(),
        revisedPrompt: String(first.revised_prompt ?? options.prompt),
        provider: options.provider,
        model: options.model,
      };
    }

    if (typeof first.b64_json === 'string' && first.b64_json.trim()) {
      return {
        imageUrl: `data:image/png;base64,${first.b64_json.trim()}`,
        revisedPrompt: String(first.revised_prompt ?? options.prompt),
        provider: options.provider,
        model: options.model,
      };
    }

    return null;
  } catch {
    clearTimeout(timer);
    return null;
  } finally {
    options.signal?.removeEventListener('abort', onParentAbort);
  }
}

/**
 * Generates an image using the OmniRoute API (`/v1/images/generations`),
 * with automatic fallback to VoidAI (`/v1/images/generations`) and Flux synthesis
 * so image creation always succeeds.
 */
export async function generateImageViaOmniRoute(
  options: ImageGenerationRequest,
): Promise<ImageGenerationResult> {
  const prompt = extractImageGenerationPrompt(options.prompt);
  const size = options.size || '1024x1024';

  const omniBase = resolveOmniBaseUrl(options.baseUrl);
  const omniKeys = resolveOmniApiKeys(options.apiKeys);
  const omniEndpoint = `${omniBase}/images/generations`;

  // 1. Primary: OmniRoute API (/v1/images/generations)
  for (const apiKey of omniKeys) {
    for (const model of OMNIROUTE_IMAGE_MODELS.slice(0, 3)) {
      if (options.signal?.aborted) {
        throw new Error('Request aborted');
      }
      const res = await tryOpenAiCompatibleImageEndpoint({
        endpoint: omniEndpoint,
        apiKey,
        model,
        prompt,
        size,
        provider: 'omniroute',
        signal: options.signal,
      });
      if (res) return res;
    }
  }

  // 2. Secondary: VoidAI Unified API (/v1/images/generations)
  const voidBase = resolveVoidAiBaseUrl(options.voidAiBaseUrl);
  const voidKey = resolveVoidAiApiKey(options.voidAiApiKey);
  if (voidKey) {
    const voidEndpoint = `${voidBase}/images/generations`;
    for (const model of ['dall-e-3', 'gpt-image-1', 'flux']) {
      if (options.signal?.aborted) {
        throw new Error('Request aborted');
      }
      const res = await tryOpenAiCompatibleImageEndpoint({
        endpoint: voidEndpoint,
        apiKey: voidKey,
        model,
        prompt,
        size,
        provider: 'voidai',
        signal: options.signal,
      });
      if (res) return res;
    }
  }

  // 3. Guaranteed Flux image synthesis fallback so the user always gets a rendered image
  const seed = Math.floor(Math.random() * 900000) + 100000;
  const encodedPrompt = encodeURIComponent(prompt);
  const fluxUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&seed=${seed}&nologo=true&model=flux`;

  return {
    imageUrl: fluxUrl,
    revisedPrompt: prompt,
    provider: 'flux-fallback',
    model: 'flux-pro',
  };
}
