export const DEFAULT_OMNI_BASE_URL =
  'https://omniroute-server-production-eea0.up.railway.app/v1';

export const DEFAULT_COMBO_MODEL = 'void-combo';

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

export function resolveOmniBaseUrl(customBaseUrl?: string): string {
  const raw =
    customBaseUrl ||
    (typeof process !== 'undefined' ? process.env?.OMNI_BASE_URL : '') ||
    DEFAULT_OMNI_BASE_URL;
  return raw.replace(/\/+$/, '');
}

/**
 * Maps an app voice id to its Deepgram Flux model. Returns null for voices that
 * are served by ElevenLabs / OmniRoute instead.
 */
export function resolveDeepgramVoiceModel(voiceId?: string): string | null {
  if (!voiceId) return null;
  const voice = voiceId.trim().toLowerCase();
  const alias = DEEPGRAM_VOICE_ALIASES[voice];
  if (alias) return alias;
  // Any valid Flux model string (flux-{voice}-{language}) is routed to /v2/speak.
  return /^flux-[a-z]+-[a-z]{2}$/.test(voice) ? voice : null;
}

/**
 * Deepgram keys stay server-side: pass one explicitly, or set
 * DEEPGRAM_API_KEY in .env.local. There is deliberately no hardcoded fallback.
 */
export function resolveDeepgramApiKey(customKey?: string): string {
  const raw =
    customKey ||
    (typeof process !== 'undefined' ? process.env?.DEEPGRAM_API_KEY : '') ||
    '';
  return raw.trim();
}

export function resolveOmniApiKeys(customKeys?: string[]): string[] {
  if (customKeys && customKeys.length > 0) {
    return customKeys.filter((k): k is string => Boolean(k && k.trim()));
  }
  const envKey1 =
    typeof process !== 'undefined' ? process.env?.OMNI_API_KEY_1 : undefined;
  const envKey2 =
    typeof process !== 'undefined' ? process.env?.OMNI_API_KEY_2 : undefined;

  return [envKey1, envKey2].filter(
    (k): k is string => Boolean(k && k.trim()),
  );
}
