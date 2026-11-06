export const DEFAULT_OMNI_BASE_URL =
  'https://omniroute-server-production-eea0.up.railway.app/v1';

export const DEFAULT_COMBO_MODEL = 'void-combo';

/**
 * VoidAI Unified API Gateway Configuration (for Embeddings, TTS, STT, and Moderation).
 * API Key is loaded strictly from `process.env.VOIDAI_API_KEY` on the server and
 * is never hardcoded in source files.
 */
export const DEFAULT_VOIDAI_BASE_URL = 'https://api.voidai.app/v1';

export interface SpecializedModelEntry {
  id: string;
  name: string;
  role: 'Primary' | 'First fallback' | 'Second fallback' | 'Fallback' | 'Best-quality OpenAI';
  description: string;
  dimensions?: number;
}

/** 1. Memory / Embeddings Models (Primary -> Fallback) */
export const VOIDAI_EMBEDDING_MODELS = [
  'text-embedding-3-large',
  'text-embedding-3-small',
] as const;

export type VoidAiEmbeddingModel = (typeof VOIDAI_EMBEDDING_MODELS)[number];

export const EMBEDDING_MODEL_DIMENSIONS: Record<VoidAiEmbeddingModel, number> = {
  'text-embedding-3-large': 3072,
  'text-embedding-3-small': 1536,
};

export const EMBEDDING_MODEL_CATALOG: SpecializedModelEntry[] = [
  {
    id: 'text-embedding-3-large',
    name: 'text-embedding-3-large',
    role: 'Primary',
    description: 'High-precision 3072-dimension semantic memory embeddings (Default)',
    dimensions: 3072,
  },
  {
    id: 'text-embedding-3-small',
    name: 'text-embedding-3-small',
    role: 'Fallback',
    description: 'Fast 1536-dimension semantic memory embeddings (Automatic Fallback)',
    dimensions: 1536,
  },
];

/** 2. Speech / Text-to-Speech Models (Primary -> First fallback -> Second fallback) */
export const VOIDAI_TTS_MODELS = [
  'gpt-4o-mini-tts',
  'tts-1-hd',
  'tts-1',
] as const;

export type VoidAiTtsModel = (typeof VOIDAI_TTS_MODELS)[number];

export const TTS_MODEL_CATALOG: SpecializedModelEntry[] = [
  {
    id: 'gpt-4o-mini-tts',
    name: 'gpt-4o-mini-tts',
    role: 'Primary',
    description: 'Natural expressive GPT-4o Mini speech synthesis (Default)',
  },
  {
    id: 'tts-1-hd',
    name: 'tts-1-hd',
    role: 'First fallback',
    description: 'High-definition OpenAI speech synthesis (First Fallback)',
  },
  {
    id: 'tts-1',
    name: 'tts-1',
    role: 'Second fallback',
    description: 'Low-latency standard OpenAI speech synthesis (Second Fallback)',
  },
];

/** 3. Transcription / Speech-to-Text Models (Gemini Primary + 3 OpenAI VoidAI Models) */
export const VOIDAI_OPENAI_STT_MODELS = [
  'gpt-4o-transcribe',
  'gpt-4o-mini-transcribe',
  'whisper-1',
] as const;

export type VoidAiOpenAiSttModel = (typeof VOIDAI_OPENAI_STT_MODELS)[number];
export type TranscriptionModelId = 'gemini' | VoidAiOpenAiSttModel;

export const STT_MODEL_CATALOG: SpecializedModelEntry[] = [
  {
    id: 'gemini',
    name: 'Gemini Trilingual (Default)',
    role: 'Primary',
    description: 'Primary multilingual speech recognition for English, Malayalam (മലയാളം), and Hindi (हिन्दी)',
  },
  {
    id: 'gpt-4o-transcribe',
    name: 'gpt-4o-transcribe',
    role: 'Best-quality OpenAI',
    description: 'Highest-accuracy OpenAI multimodal speech transcription via VoidAI',
  },
  {
    id: 'gpt-4o-mini-transcribe',
    name: 'gpt-4o-mini-transcribe',
    role: 'First fallback',
    description: 'Fast, accurate OpenAI multilingual transcription (First Fallback)',
  },
  {
    id: 'whisper-1',
    name: 'whisper-1',
    role: 'Second fallback',
    description: 'Universal Whisper V2 multilingual transcription (Second Fallback)',
  },
];

/** 4. Moderation Model */
export const VOIDAI_MODERATION_MODEL = 'omni-moderation-latest' as const;

export const MODERATION_MODEL_CATALOG: SpecializedModelEntry[] = [
  {
    id: 'omni-moderation-latest',
    name: 'omni-moderation-latest',
    role: 'Primary',
    description: 'Multimodal text and image safety moderation via VoidAI',
  },
];

/**
 * Deepgram Flux TTS (batch REST). Models use the `flux-{voice}-{language}` format
 * and only flux-* models are accepted by /v2/speak.
 */
export const DEEPGRAM_SPEAK_ENDPOINT = 'https://api.deepgram.com/v2/speak';

/** Voice ids saved before the catalog used full Flux model strings. */
export const DEEPGRAM_VOICE_ALIASES: Record<string, string> = {
  'deepgram-meena': 'flux-meena-en',
};

export const DEFAULT_OMNI_API_KEYS: string[] = [];

/**
 * MIRASH — OpenRouter Configuration & Ranked Free Model Fallback Array
 */
export const OPENROUTER_ENDPOINT =
  'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_API_KEY = '';

export const AI_MODELS = [
  'nvidia/nemotron-3-ultra:free',
  'nvidia/nemotron-3.5-super-vl:free',
  'google/gemma-4-26b-a4b:free',
  'dots-studio/dots3-note-preview:free',
  'xingchen-agi/xing4.0-29b-a4b:free',
  'stealth/crouton-alpha',
  'nvidia/nemotron-3.5-lightning:free',
  'cohere/north-mini-code:free',
  'recursive/flint:free',
  'nvidia/nemotron-3-nano-omni:free',
  'liquid/lfm2.5-2.6b:free',
];

function cleanEnvValue(val?: string): string {
  if (!val) return '';
  return val
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

export function resolveOmniBaseUrl(customBaseUrl?: string): string {
  const raw =
    cleanEnvValue(customBaseUrl) ||
    cleanEnvValue(
      typeof process !== 'undefined'
        ? (process.env?.OMNI_BASE_URL ?? process.env?.VITE_OMNI_BASE_URL)
        : '',
    ) ||
    DEFAULT_OMNI_BASE_URL;
  const trimmed = raw.replace(/\/+$/, '');
  if (
    trimmed.includes('omniroute-server') &&
    !trimmed.endsWith('/v1')
  ) {
    return `${trimmed}/v1`;
  }
  return trimmed;
}

export function resolveVoidAiBaseUrl(customBaseUrl?: string): string {
  const raw =
    cleanEnvValue(customBaseUrl) ||
    cleanEnvValue(
      typeof process !== 'undefined'
        ? (process.env?.VOIDAI_BASE_URL ??
            process.env?.VITE_VOIDAI_BASE_URL ??
            process.env?.VOID_BASE_URL)
        : '',
    ) ||
    DEFAULT_VOIDAI_BASE_URL;
  const trimmed = raw.replace(/\/+$/, '');
  // If user configured https://api.voidai.app without /v1, normalize to /v1
  if (
    /^https?:\/\/(?:api\.)?voidai\.app$/i.test(trimmed)
  ) {
    return 'https://api.voidai.app/v1';
  }
  return trimmed;
}

/**
 * Loads the VoidAI Unified API key strictly from environment variables (`VOIDAI_API_KEY`).
 * Supports common Vercel env aliases (`VOIDAI_API_KEY`, `VITE_VOIDAI_API_KEY`, `VOID_API_KEY`)
 * and strips accidental quotes or `Bearer ` prefixes. Never hardcoded in source files.
 */
export function resolveVoidAiApiKey(customKey?: string): string {
  return (
    cleanEnvValue(customKey) ||
    cleanEnvValue(
      typeof process !== 'undefined'
        ? (process.env?.VOIDAI_API_KEY ??
            process.env?.VITE_VOIDAI_API_KEY ??
            process.env?.VOID_API_KEY ??
            process.env?.VOIDAI_KEY)
        : '',
    )
  );
}

/**
 * Maps an app voice id to its Deepgram Flux model. Returns null for voices that
 * are served by VoidAI / OpenAI / ElevenLabs / OmniRoute instead.
 */
export function resolveDeepgramVoiceModel(voiceId?: string): string | null {
  if (!voiceId) return null;
  const voice = voiceId.trim().toLowerCase();
  const alias = DEEPGRAM_VOICE_ALIASES[voice];
  if (alias) return alias;
  return /^flux-[a-z]+-[a-z]{2}$/.test(voice) ? voice : null;
}

/**
 * Deepgram keys stay server-side: pass one explicitly, or set
 * DEEPGRAM_API_KEY in .env.local. There is deliberately no hardcoded fallback.
 */
export function resolveDeepgramApiKey(customKey?: string): string {
  return (
    cleanEnvValue(customKey) ||
    cleanEnvValue(
      typeof process !== 'undefined' ? process.env?.DEEPGRAM_API_KEY : '',
    )
  );
}

export function resolveOmniApiKeys(customKeys?: string[]): string[] {
  if (customKeys && customKeys.length > 0) {
    return customKeys
      .map((k) => cleanEnvValue(k))
      .filter((k): k is string => Boolean(k));
  }
  const envKey1 =
    typeof process !== 'undefined'
      ? cleanEnvValue(
          process.env?.OMNI_API_KEY_1 ??
            process.env?.OMNI_API_KEY ??
            process.env?.VITE_OMNI_API_KEY_1,
        )
      : '';
  const envKey2 =
    typeof process !== 'undefined'
      ? cleanEnvValue(
          process.env?.OMNI_API_KEY_2 ?? process.env?.VITE_OMNI_API_KEY_2,
        )
      : '';

  return [envKey1, envKey2].filter((k): k is string => Boolean(k));
}
