import {
  DEEPGRAM_SPEAK_ENDPOINT,
  VOIDAI_TTS_MODELS,
  type VoidAiTtsModel,
  resolveDeepgramApiKey,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './config.js';

export interface TtsSynthesisRequest {
  text: string;
  lang?: string;
  voice?: string;
  model?: string;
  speed?: number;
  baseUrl?: string;
  apiKeys?: string[];
  voidAiBaseUrl?: string;
  voidAiApiKey?: string;
}

export interface TtsSynthesisResult {
  audioBuffer: ArrayBuffer;
  contentType: string;
  provider:
    | 'voidai-tts'
    | 'elevenlabs-omniroute'
    | 'deepgram-flux'
    | 'neural-fallback';
  usedModel?: string;
  usedVoice?: string;
}

export interface DeepgramTtsRequest {
  text: string;
  model: string;
  speed?: number;
  expressivity?: number;
  apiKey?: string;
}

/**
 * Valid OpenAI / VoidAI TTS voice metadata with exact Male / Female gender labels
 * and model compatibility flags.
 * - `tts-1` and `tts-1-hd` support: alloy, ash, coral, echo, fable, onyx, nova, sage, shimmer
 * - `gpt-4o-mini-tts` supports all 9 above PLUS ballad and verse
 */
export interface OpenAiVoiceSpec {
  id: string;
  name: string;
  gender: 'Male' | 'Female';
  description: string;
  supportedModels: VoidAiTtsModel[];
  fallbackVoiceForTts1: string;
}

export const OPENAI_TTS_VOICE_SPECS: OpenAiVoiceSpec[] = [
  {
    id: 'alloy',
    name: 'Alloy',
    gender: 'Female',
    description: 'Neutral, balanced, and versatile GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'alloy',
  },
  {
    id: 'ash',
    name: 'Ash',
    gender: 'Male',
    description: 'Clear, articulate, conversational GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'ash',
  },
  {
    id: 'ballad',
    name: 'Ballad',
    gender: 'Male',
    description: 'Warm, melodic, expressive GPT-4o Mini voice',
    supportedModels: ['gpt-4o-mini-tts'],
    fallbackVoiceForTts1: 'echo',
  },
  {
    id: 'coral',
    name: 'Coral',
    gender: 'Female',
    description: 'Warm, friendly, natural GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'coral',
  },
  {
    id: 'echo',
    name: 'Echo',
    gender: 'Male',
    description: 'Resonant, steady, well-paced GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'echo',
  },
  {
    id: 'fable',
    name: 'Fable',
    gender: 'Male',
    description: 'Expressive, British-inflected storytelling GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'fable',
  },
  {
    id: 'nova',
    name: 'Nova',
    gender: 'Female',
    description: 'Bright, energetic, natural GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'nova',
  },
  {
    id: 'onyx',
    name: 'Onyx',
    gender: 'Male',
    description: 'Deep, authoritative, confident GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'onyx',
  },
  {
    id: 'sage',
    name: 'Sage',
    gender: 'Female',
    description: 'Calm, measured, thoughtful GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'sage',
  },
  {
    id: 'shimmer',
    name: 'Shimmer',
    gender: 'Female',
    description: 'Soft, clear, reassuring GPT voice',
    supportedModels: ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1'],
    fallbackVoiceForTts1: 'shimmer',
  },
  {
    id: 'verse',
    name: 'Verse',
    gender: 'Male',
    description: 'Dynamic, natural conversational GPT-4o Mini voice',
    supportedModels: ['gpt-4o-mini-tts'],
    fallbackVoiceForTts1: 'onyx',
  },
];

export function isOpenAiTtsVoice(voiceId?: string): boolean {
  if (!voiceId) return false;
  const normalized = voiceId.trim().toLowerCase().replace(/^openai-/, '');
  return OPENAI_TTS_VOICE_SPECS.some((v) => v.id === normalized);
}

/**
 * Resolves a compatible OpenAI voice ID for the target speech model.
 * If a voice (such as `ballad` or `verse`) is unsupported by a fallback model
 * (`tts-1-hd` or `tts-1`), automatically selects a compatible voice of the same gender.
 */
export function resolveCompatibleOpenAiTtsVoice(
  voiceId: string | undefined,
  targetModel: VoidAiTtsModel,
  preferredGender?: 'Male' | 'Female',
): string {
  const normalized = String(voiceId ?? '')
    .trim()
    .toLowerCase()
    .replace(/^openai-/, '');

  const spec = OPENAI_TTS_VOICE_SPECS.find((v) => v.id === normalized);
  if (spec) {
    if (spec.supportedModels.includes(targetModel)) {
      return spec.id;
    }
    return spec.fallbackVoiceForTts1;
  }

  // Known non-OpenAI male voices map to onyx; female voices map to nova
  if (
    preferredGender === 'Male' ||
    /^(antoni|bruce|cliff|cole|colin|conor|donovan|drew|jack|kai|kit|marcelo|marcus|miles|naveen|rufus|sean|tanner|wade|wes|manjunath)/i.test(
      normalized,
    )
  ) {
    return 'onyx';
  }
  return 'nova';
}

/**
 * Returns the ordered speech model fallback chain:
 * Primary: `gpt-4o-mini-tts` -> First fallback: `tts-1-hd` -> Second fallback: `tts-1`.
 */
export function getTtsModelFallbackChain(
  preferredModel?: string,
): VoidAiTtsModel[] {
  const clean = String(preferredModel ?? '').trim() as VoidAiTtsModel;
  if (VOIDAI_TTS_MODELS.includes(clean)) {
    const rest = VOIDAI_TTS_MODELS.filter((m) => m !== clean);
    return [clean, ...rest];
  }
  return [...VOIDAI_TTS_MODELS];
}

/**
 * Synthesizes speech via VoidAI Unified API (`POST https://api.voidai.app/v1/audio/speech`)
 * using the 3 speech models in priority order:
 * 1. `gpt-4o-mini-tts` (Primary)
 * 2. `tts-1-hd` (First fallback)
 * 3. `tts-1` (Second fallback)
 */
export async function synthesizeSpeechViaVoidAi(options: {
  text: string;
  voice?: string;
  model?: string;
  speed?: number;
  voidAiBaseUrl?: string;
  voidAiApiKey?: string;
}): Promise<TtsSynthesisResult> {
  const cleanText = String(options.text ?? '').trim();
  if (!cleanText) {
    throw new Error('Text is required for Text-to-Speech synthesis.');
  }

  const baseUrl = resolveVoidAiBaseUrl(options.voidAiBaseUrl);
  const apiKey = resolveVoidAiApiKey(options.voidAiApiKey);
  if (!apiKey) {
    throw new Error('VOIDAI_API_KEY is not configured in the server environment.');
  }

  const endpoint = `${baseUrl}/audio/speech`;
  const modelChain = getTtsModelFallbackChain(options.model);
  let lastError = 'All VoidAI speech models failed.';

  for (const candidateModel of modelChain) {
    const compatibleVoice = resolveCompatibleOpenAiTtsVoice(
      options.voice,
      candidateModel,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2400);

    try {
      const payload: Record<string, unknown> = {
        model: candidateModel,
        input: cleanText.slice(0, 4096),
        voice: compatibleVoice,
        response_format: 'mp3',
      };

      if (
        typeof options.speed === 'number' &&
        Number.isFinite(options.speed) &&
        options.speed >= 0.25 &&
        options.speed <= 4.0
      ) {
        payload.speed = options.speed;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timer);

      const contentType = res.headers.get('content-type') || '';
      if (
        res.ok &&
        (contentType.includes('audio') ||
          contentType.includes('octet-stream'))
      ) {
        const audioBuffer = await res.arrayBuffer();
        if (audioBuffer.byteLength > 256) {
          return {
            audioBuffer,
            contentType: contentType.includes('audio')
              ? contentType
              : 'audio/mpeg',
            provider: 'voidai-tts',
            usedModel: candidateModel,
            usedVoice: compatibleVoice,
          };
        }
      }

      const errText = await res.text().catch(() => res.statusText);
      lastError = `VoidAI TTS (${candidateModel}) HTTP ${res.status}: ${errText.slice(0, 200)}`;
    } catch (err) {
      clearTimeout(timer);
      lastError =
        err instanceof Error
          ? err.message
          : `VoidAI TTS (${candidateModel}) failed`;
    }
  }

  throw new Error(lastError);
}

/**
 * Synthesizes speech with Deepgram Flux TTS (`POST /v2/speak`), the same batch
 * REST call the official SDK makes from `speak.v2.audio.generate`. Returns the
 * MP3 bytes directly, so no temp files or SDK dependency are needed.
 */
export async function synthesizeSpeechViaDeepgram(
  options: DeepgramTtsRequest,
): Promise<TtsSynthesisResult> {
  const cleanText = String(options.text ?? '').trim();
  if (!cleanText) {
    throw new Error('Text is required for Text-to-Speech synthesis.');
  }

  const model = String(options.model ?? '').trim();
  if (!model) {
    throw new Error('A Deepgram Flux model is required (e.g. flux-meena-en).');
  }

  const apiKey = resolveDeepgramApiKey(options.apiKey);
  if (!apiKey) {
    throw new Error(
      'DEEPGRAM_API_KEY is not configured. Add it to .env.local to use Deepgram voices.',
    );
  }

  const params = new URLSearchParams({ model, encoding: 'mp3' });
  if (typeof options.speed === 'number' && Number.isFinite(options.speed)) {
    params.set('speed', String(options.speed));
  }
  if (
    typeof options.expressivity === 'number' &&
    Number.isFinite(options.expressivity)
  ) {
    params.set('expressivity', String(options.expressivity));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const res = await fetch(`${DEEPGRAM_SPEAK_ENDPOINT}?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: cleanText.slice(0, 2000) }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Deepgram TTS failed with status ${res.status}${
          detail ? `: ${detail.slice(0, 240)}` : ''
        }`,
      );
    }

    const audioBuffer = await res.arrayBuffer();
    if (audioBuffer.byteLength <= 256) {
      throw new Error('Deepgram TTS returned an empty audio response.');
    }

    const contentType = res.headers.get('content-type') || 'audio/mpeg';
    return {
      audioBuffer,
      contentType: contentType.includes('audio') ? contentType : 'audio/mpeg',
      provider: 'deepgram-flux',
      usedModel: model,
      usedVoice: model,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Candidate ElevenLabs / OmniRoute TTS model & voice configurations.
 */
const ELEVENLABS_OMNIROUTE_CANDIDATES = [
  { model: 'eleven_multilingual_v2', voice: 'rachel' },
  { model: 'elevenlabs/eleven_multilingual_v2', voice: 'rachel' },
  { model: 'eleven_turbo_v2_5', voice: 'rachel' },
  { model: 'tts-1', voice: 'alloy' },
];

/**
 * Synthesizes speech using VoidAI TTS (`gpt-4o-mini-tts` -> `tts-1-hd` -> `tts-1`)
 * first when configured or requested, with automatic fallback to OmniRoute ElevenLabs
 * and Multilingual Neural TTS.
 */
export async function synthesizeSpeechViaOmniRoute(
  options: TtsSynthesisRequest,
): Promise<TtsSynthesisResult> {
  const cleanText = String(options.text ?? '').trim();
  if (!cleanText) {
    throw new Error('Text is required for Text-to-Speech synthesis.');
  }

  // 1. Primary Speech Pipeline: VoidAI Unified API (`gpt-4o-mini-tts` -> `tts-1-hd` -> `tts-1`)
  const voidAiKey = resolveVoidAiApiKey(options.voidAiApiKey);
  if (voidAiKey) {
    try {
      return await synthesizeSpeechViaVoidAi({
        text: cleanText,
        voice: options.voice,
        model: options.model,
        speed: options.speed,
        voidAiBaseUrl: options.voidAiBaseUrl,
        voidAiApiKey: voidAiKey,
      });
    } catch {
      // Fall through to OmniRoute / Neural fallback if VoidAI TTS fails
    }
  }

  const baseUrl = resolveOmniBaseUrl(options.baseUrl);
  const apiKeys = resolveOmniApiKeys(options.apiKeys);
  const speechEndpoint = `${baseUrl}/audio/speech`;
  const lang = String(options.lang ?? 'en-US').trim();

  // 2. Secondary: OmniRoute (`/v1/audio/speech`) — fast 1.8s check on primary key
  const primaryKey = apiKeys[0];
  if (primaryKey) {
    const candidate = ELEVENLABS_OMNIROUTE_CANDIDATES[0];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1800);
    try {
      const res = await fetch(speechEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${primaryKey}`,
        },
        body: JSON.stringify({
          model: options.model || candidate.model,
          input: cleanText.slice(0, 1200),
          voice: options.voice?.replace(/^openai-/, '') || candidate.voice,
          response_format: 'mp3',
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const contentType = res.headers.get('content-type') || '';
      if (
        res.ok &&
        (contentType.includes('audio') || contentType.includes('octet-stream'))
      ) {
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > 256) {
          return {
            audioBuffer: arrayBuf,
            contentType: contentType.includes('audio')
              ? contentType
              : 'audio/mpeg',
            provider: 'elevenlabs-omniroute',
            usedModel: options.model || candidate.model,
            usedVoice: options.voice || candidate.voice,
          };
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  // 3. Graceful Fallback: Multilingual Neural TTS stream (supports English, Malayalam, Hindi, etc.)
  const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&ttsspeed=1&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(cleanText.slice(0, 200))}`;
  const fallbackRes = await fetch(ttsUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      Referer: 'https://translate.google.com/',
    },
  });

  if (!fallbackRes.ok) {
    throw new Error(`TTS synthesis failed with status ${fallbackRes.status}`);
  }

  const fallbackBuf = await fallbackRes.arrayBuffer();
  return {
    audioBuffer: fallbackBuf,
    contentType: 'audio/mpeg',
    provider: 'neural-fallback',
  };
}

/**
 * Client-side helper utilities for preparing Markdown text and language segments for TTS playback.
 */
export function detectSpeechSegmentLanguage(segment: string): {
  tl: string;
  bcp47: string;
} {
  if (/[\u0D00-\u0D7F]/.test(segment)) {
    return { tl: 'ml', bcp47: 'ml-IN' };
  }
  if (/[\u0900-\u097F]/.test(segment)) {
    return { tl: 'hi', bcp47: 'hi-IN' };
  }
  if (/[\u0B80-\u0BFF]/.test(segment)) {
    return { tl: 'ta', bcp47: 'ta-IN' };
  }
  if (/[\u0600-\u06FF]/.test(segment)) {
    return { tl: 'ar', bcp47: 'ar-SA' };
  }
  if (/[\u0C80-\u0CFF]/.test(segment)) {
    return { tl: 'kn', bcp47: 'kn-IN' };
  }
  if (/[\u0C00-\u0C7F]/.test(segment)) {
    return { tl: 'te', bcp47: 'te-IN' };
  }
  if (/[\u0980-\u09FF]/.test(segment)) {
    return { tl: 'bn', bcp47: 'bn-IN' };
  }
  return { tl: 'en-US', bcp47: 'en-US' };
}

export function stripMarkdownForSpeech(markdown: string): string {
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, ' ');
  const baseText = withoutCodeBlocks.trim() ? withoutCodeBlocks : markdown;

  return baseText
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^[-*•]\s+/gm, '')
    .replace(/^\d+\.\s+/gm, '')
    .replace(/https?:\/\/[^\s)]+/g, '')
    .replace(/[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitTextIntoSpeechChunks(
  rawText: string,
): Array<{ text: string; tl: string; bcp47: string }> {
  const cleaned = stripMarkdownForSpeech(rawText);
  if (!cleaned) return [];

  const rawSentences = cleaned
    .split(/(?<=[.!?।\n])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const atomicChunks: Array<{ text: string; tl: string; bcp47: string }> = [];
  const MAX_LEN = 185;

  for (const sentence of rawSentences) {
    if (sentence.length <= MAX_LEN) {
      const lang = detectSpeechSegmentLanguage(sentence);
      atomicChunks.push({ text: sentence, ...lang });
      continue;
    }

    const words = sentence.split(/\s+/);
    let current = '';
    for (const word of words) {
      if (!current) {
        current = word;
      } else if (current.length + 1 + word.length <= MAX_LEN) {
        current += ` ${word}`;
      } else {
        const lang = detectSpeechSegmentLanguage(current);
        atomicChunks.push({ text: current, ...lang });
        current = word;
      }
    }
    if (current) {
      const lang = detectSpeechSegmentLanguage(current);
      atomicChunks.push({ text: current, ...lang });
    }
  }

  const mergedChunks: Array<{ text: string; tl: string; bcp47: string }> = [];
  for (const item of atomicChunks) {
    const prev = mergedChunks[mergedChunks.length - 1];
    if (
      prev &&
      prev.tl === item.tl &&
      prev.text.length + 1 + item.text.length <= MAX_LEN
    ) {
      prev.text = `${prev.text} ${item.text}`;
    } else {
      mergedChunks.push({ ...item });
    }
  }

  return mergedChunks;
}
