import {
  DEEPGRAM_SPEAK_ENDPOINT,
  resolveDeepgramApiKey,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
} from './config';

export interface TtsSynthesisRequest {
  text: string;
  lang?: string;
  voice?: string;
  model?: string;
  baseUrl?: string;
  apiKeys?: string[];
}

export interface TtsSynthesisResult {
  audioBuffer: ArrayBuffer;
  contentType: string;
  provider: 'elevenlabs-omniroute' | 'deepgram-flux' | 'neural-fallback';
}

export interface DeepgramTtsRequest {
  text: string;
  model: string;
  speed?: number;
  expressivity?: number;
  apiKey?: string;
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
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Candidate ElevenLabs / OmniRoute TTS model & voice configurations.
 * OmniRoute exposes ElevenLabs via the OpenAI-compatible `/v1/audio/speech` endpoint.
 */
const ELEVENLABS_OMNIROUTE_CANDIDATES = [
  { model: 'eleven_multilingual_v2', voice: 'rachel' },
  { model: 'elevenlabs/eleven_multilingual_v2', voice: 'rachel' },
  { model: 'eleven_turbo_v2_5', voice: 'rachel' },
  { model: 'tts-1', voice: 'alloy' },
];

/**
 * Calls the ElevenLabs Text-to-Speech tool via the OmniRoute endpoint
 * (`https://omniroute-server-production-eea0.up.railway.app/v1/audio/speech`)
 * with automatic API key rotation (Key 1 -> Key 2) and graceful fallback to
 * Neural TTS if the upstream ElevenLabs quota/provider is unreachable.
 */
export async function synthesizeSpeechViaOmniRoute(
  options: TtsSynthesisRequest,
): Promise<TtsSynthesisResult> {
  const cleanText = String(options.text ?? '').trim();
  if (!cleanText) {
    throw new Error('Text is required for Text-to-Speech synthesis.');
  }

  const baseUrl = resolveOmniBaseUrl(options.baseUrl);
  const apiKeys = resolveOmniApiKeys(options.apiKeys);
  const speechEndpoint = `${baseUrl}/audio/speech`;
  const lang = String(options.lang ?? 'en-US').trim();

  // 1. Primary: ElevenLabs TTS via OmniRoute (`/v1/audio/speech`)
  for (const apiKey of apiKeys) {
    for (const candidate of ELEVENLABS_OMNIROUTE_CANDIDATES) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);

      try {
        const res = await fetch(speechEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: options.model || candidate.model,
            input: cleanText.slice(0, 1200),
            voice: options.voice || candidate.voice,
            response_format: 'mp3',
          }),
          signal: controller.signal,
        });

        clearTimeout(timer);

        const contentType = res.headers.get('content-type') || '';
        if (
          res.ok &&
          (contentType.includes('audio') ||
            contentType.includes('octet-stream'))
        ) {
          const arrayBuf = await res.arrayBuffer();
          if (arrayBuf.byteLength > 256) {
            return {
              audioBuffer: arrayBuf,
              contentType: contentType.includes('audio')
                ? contentType
                : 'audio/mpeg',
              provider: 'elevenlabs-omniroute',
            };
          }
        }
      } catch {
        clearTimeout(timer);
        // Try next candidate / API key
      }
    }
  }

  // 2. Graceful Fallback: Multilingual Neural TTS stream (supports English, Malayalam, Hindi, etc.)
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
