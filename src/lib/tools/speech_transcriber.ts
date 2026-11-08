import {
  DEFAULT_COMBO_MODEL,
  VOIDAI_OPENAI_STT_MODELS,
  type VoidAiOpenAiSttModel,
  resolveOmniApiKeys,
  resolveOmniBaseUrl,
  resolveVoidAiApiKey,
  resolveVoidAiBaseUrl,
} from './config.js';

/**
 * Ultra-Fast (<50ms) Trilingual Speech-to-Script Converter
 * + VoidAI & OmniRoute Audio Transcription (`gpt-4o-transcribe` -> `gpt-4o-mini-transcribe` -> `whisper-1` -> Gemini Multimodal)
 * Supports both:
 * 1. `default` mode (explicit EN / ML / HI language selector button in PromptBar)
 * 2. Auto-detect mode (`gemini`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe`, `whisper-1`)
 */

const DISALLOWED_SCRIPT_REGEX =
  // eslint-disable-next-line no-misleading-character-class
  /[^\u0020-\u007E\u00A0-\u00FF\u0900-\u097F\u0D00-\u0D7F\u200C\u200D\u2013-\u2026]+/g;

export function collapseDuplicateSpeech(text: string): string {
  const cleaned = text.replace(/\s{2,}/g, ' ').trim();
  if (!cleaned) return '';

  const words = cleaned.split(' ');
  if (words.length >= 2 && words.length % 2 === 0) {
    const half = words.length / 2;
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half).join(' ');
    if (firstHalf.toLowerCase() === secondHalf.toLowerCase()) {
      return firstHalf;
    }
  }

  const dedupedWords: string[] = [];
  for (const w of words) {
    if (
      dedupedWords.length === 0 ||
      dedupedWords[dedupedWords.length - 1].toLowerCase() !== w.toLowerCase()
    ) {
      dedupedWords.push(w);
    }
  }
  return dedupedWords.join(' ');
}

export function cleanTrilingualText(raw: string): string {
  const stripped = raw
    .replace(DISALLOWED_SCRIPT_REGEX, ' ')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(
      /^(?:transcript|transcription|output|malayalam|hindi|english)\s*:\s*/i,
      '',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  return collapseDuplicateSpeech(stripped);
}

const INSTANT_PHRASE_MAP: Array<[RegExp, string]> = [
  [
    /\b(?:sugar\s*mono|sugamano|sukhamano|sughamano|sukamano|so\s*come\s*on\s*now)\b/gi,
    'സുഖമാണോ',
  ],
  [
    /\b(?:njan\s+ivideyanu|jaan\s+ivideyanu|nyan\s+ivideyanu|nan\s+ivideyanu)\b/gi,
    'ഞാൻ ഇവിടെയാണ്',
  ],
  [
    /\b(?:ningal\s+evideyanu|ningal\s+evideya|ningal\s+evide)\b/gi,
    'നിങ്ങൾ എവിടെയാണ്',
  ],
  [
    /\b(?:entha\s+vishesham|enthokkeyundu\s+vishesham|enthu\s+vishesham)\b/gi,
    'എന്താ വിശേഷം',
  ],
  [/\b(?:entha\s+paripadi|enthu\s+paripadi)\b/gi, 'എന്താ പരിപാടി'],
  [/\b(?:ente\s+peru|ende\s+peru)\b/gi, 'എന്റെ പേര്'],
  [/\b(?:namaskaram|namaskaaram)\b/gi, 'നമസ്കാരം'],
  [/\b(?:aap\s+kaise\s+ho|ap\s+kaise\s+ho)\b/gi, 'आप कैसे हो'],
  [/\b(?:kya\s+haal\s+hai|kya\s+hal\s+hai)\b/gi, 'क्या हाल है'],
];

const COMMON_ENGLISH_WORDS = new Set([
  'a', 'about', 'act', 'add', 'after', 'again', 'all', 'also', 'am', 'an', 'and',
  'any', 'app', 'application', 'are', 'as', 'ask', 'at', 'back', 'be', 'because',
  'been', 'before', 'best', 'better', 'between', 'big', 'both', 'bro', 'brother',
  'build', 'but', 'by', 'call', 'can', 'change', 'chat', 'check', 'clean', 'clear',
  'click', 'code', 'coding', 'color', 'come', 'component', 'connect', 'create',
  'current', 'dark', 'data', 'day', 'debug', 'default', 'delete', 'design',
  'detail', 'details', 'develop', 'developer', 'did', 'do', 'does', 'done', 'down',
  'each', 'edit', 'else', 'email', 'end', 'english', 'error', 'even', 'every',
  'example', 'explain', 'fast', 'feature', 'file', 'files', 'find', 'first', 'fix',
  'folder', 'for', 'form', 'from', 'frontend', 'full', 'function', 'generate',
  'get', 'give', 'go', 'going', 'good', 'got', 'great', 'guys', 'had', 'handle',
  'has', 'have', 'he', 'hello', 'help', 'here', 'hey', 'hi', 'high', 'hindi',
  'his', 'home', 'how', 'html', 'i', 'if', 'image', 'import', 'in', 'index',
  'info', 'information', 'input', 'install', 'into', 'is', 'issue', 'it', 'its',
  'javascript', 'json', 'just', 'keep', 'key', 'know', 'language', 'last',
  'latest', 'layout', 'learn', 'let', 'like', 'line', 'link', 'list', 'live',
  'load', 'loading', 'local', 'look', 'looking', 'make', 'malayalam', 'many',
  'max', 'may', 'me', 'mean', 'message', 'messages', 'mic', 'microphone', 'might',
  'model', 'models', 'modern', 'more', 'most', 'move', 'much', 'must', 'my',
  'name', 'need', 'new', 'next', 'nice', 'no', 'node', 'not', 'now', 'number',
  'of', 'off', 'oil', 'ok', 'okay', 'old', 'on', 'once', 'one', 'only', 'open',
  'option', 'or', 'other', 'our', 'out', 'over', 'page', 'part', 'pass', 'path',
  'people', 'place', 'plan', 'play', 'please', 'plugin', 'plus', 'pnpm', 'point',
  'port', 'post', 'price', 'primary', 'problem', 'project', 'prompt', 'put',
  'python', 'query', 'question', 'quick', 'rate', 'react', 'read', 'ready',
  'real', 'really', 'record', 'remove', 'repeat', 'reply', 'request', 'response',
  'result', 'return', 'right', 'route', 'run', 'running', 'same', 'save', 'say',
  'screen', 'script', 'search', 'second', 'see', 'select', 'send', 'server',
  'set', 'setting', 'settings', 'setup', 'share', 'she', 'should', 'show', 'side',
  'simple', 'since', 'site', 'small', 'so', 'some', 'something', 'sound', 'source',
  'speak', 'speech', 'speed', 'start', 'state', 'status', 'still', 'stop',
  'stream', 'streaming', 'string', 'style', 'such', 'summarize', 'summary',
  'sure', 'switch', 'system', 'table', 'tailwind', 'take', 'talk', 'talking',
  'task', 'tell', 'terminal', 'test', 'text', 'than', 'thank', 'thanks', 'that',
  'the', 'their', 'them', 'then', 'there', 'these', 'they', 'thing', 'things',
  'think', 'this', 'those', 'through', 'time', 'timing', 'to', 'today', 'together',
  'too', 'tool', 'top', 'translate', 'try', 'turn', 'two', 'type', 'typescript',
  'ui', 'under', 'up', 'update', 'upload', 'url', 'us', 'use', 'used', 'user',
  'using', 'value', 'version', 'very', 'video', 'view', 'vite', 'voice', 'void',
  'wait', 'want', 'was', 'way', 'we', 'weather', 'web', 'website', 'well', 'went',
  'were', 'what', 'when', 'where', 'which', 'while', 'who', 'why', 'will', 'with',
  'without', 'word', 'words', 'work', 'working', 'world', 'would', 'write',
  'writing', 'yeah', 'year', 'yes', 'yet', 'you', 'your',
]);

const MALAYALAM_ROMAN_REGEX =
  /\b(?:njan|njaan|nyan|ente|enikku|enikk|ninakku|ninakk|ningal|ningalkku|ningalkk|evide|evideya|evideyanu|ivide|ivideya|ivideyanu|entha|enthu|enthokke|enthokkeyundu|engane|enganeya|enganeyanu|eppo|eppozha|kollam|adipoli|machane|mone|mwone|chetta|chechi|allyo|alle|allaa|aanu|alla|unde|undu|illa|varum|poyi|parayu|parayoo|cheyyu|cheyyoo|venam|venda|ariyamo|ariyilla|manassilayo|manasilayo|sukham|sukhamano|sugamano|sughamano|vishesham|paripadi|sahayam|namaskaram|kazhinju|samsarikkunna|kettille|ketto|shari|shariya|nerakku)\b/i;

const HINDI_ROMAN_REGEX =
  /\b(?:mein|mujhe|mera|meri|mere|tum|tumhara|aap|aapka|kya|kaise|kaisa|kaisi|kahan|kab|kyun|kyon|hai|hain|hoon|tha|thi|nahi|nahin|haan|accha|achha|theek|thik|bhai|yaar|dost|madad|chahiye|karo|karna|karenge|batao|bataiye|dekho|suno|samajh|haal|mausam|kaam|naam|sab|kuch|bahut|abhi|aaj|kal)\b/i;

export function detectSpokenLanguage(
  hint: string,
  preferredLang = 'en',
  autoDetect = true,
): 'en' | 'ml' | 'hi' {
  const cleaned = hint.toLowerCase().trim();
  if (!cleaned) return 'en';

  if (!autoDetect) {
    if (preferredLang === 'ml' || preferredLang === 'ml-in') return 'ml';
    if (preferredLang === 'hi' || preferredLang === 'hi-in') return 'hi';
    return 'en';
  }

  if (MALAYALAM_ROMAN_REGEX.test(cleaned)) return 'ml';
  if (HINDI_ROMAN_REGEX.test(cleaned)) return 'hi';

  const words = cleaned
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'en';

  const englishCount = words.filter((w) => COMMON_ENGLISH_WORDS.has(w)).length;
  if (englishCount / words.length >= 0.6) {
    return 'en';
  }

  if (
    /(?:aanu|anu|unnu|ikko|anam|allo|alle|il|ude|ukal|am|athu|ithu)\b/i.test(
      cleaned,
    )
  ) {
    return 'ml';
  }

  if (preferredLang === 'ml') return 'ml';
  if (preferredLang === 'hi') return 'hi';

  return 'en';
}

async function googleInputToolsTransliterate(
  text: string,
  targetLang: 'ml' | 'hi',
): Promise<string> {
  const itc = targetLang === 'ml' ? 'ml-t-i0-und' : 'hi-t-i0-und';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 900);

  try {
    const url = `https://inputtools.google.com/request?text=${encodeURIComponent(text)}&itc=${itc}&num=1&cp=0&cs=1&ie=utf-8&oe=utf-8&app=demopage`;
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return text;

    const data = (await res.json()) as unknown[];
    if (
      Array.isArray(data) &&
      data[0] === 'SUCCESS' &&
      Array.isArray(data[1]) &&
      Array.isArray(data[1][0]) &&
      Array.isArray(data[1][0][1]) &&
      typeof data[1][0][1][0] === 'string'
    ) {
      return collapseDuplicateSpeech(data[1][0][1][0]);
    }
    return text;
  } catch {
    clearTimeout(timer);
    return text;
  }
}

export async function convertSpokenHintFast(options: {
  hint: string;
  lang?: string;
  autoDetect?: boolean;
}): Promise<string> {
  let text = cleanTrilingualText(options.hint);
  if (!text) return '';

  const isAuto = options.autoDetect !== false && options.lang !== 'en-strict';

  if (isAuto || options.lang === 'ml' || options.lang === 'hi') {
    for (const [pattern, replacement] of INSTANT_PHRASE_MAP) {
      text = text.replace(pattern, replacement);
    }
    text = collapseDuplicateSpeech(text);
  }

  if (!/[a-zA-Z]/.test(text)) {
    return text;
  }

  const targetLang = detectSpokenLanguage(
    text,
    options.lang || 'en',
    isAuto,
  );
  if (targetLang === 'en') {
    return collapseDuplicateSpeech(text);
  }

  const converted = await googleInputToolsTransliterate(text, targetLang);
  return collapseDuplicateSpeech(converted || text);
}

/**
 * Returns the ordered OpenAI transcription model fallback chain:
 * 1. `gpt-4o-transcribe` (Best-quality OpenAI option)
 * 2. `gpt-4o-mini-transcribe` (First fallback)
 * 3. `whisper-1` (Second fallback)
 */
export function getOpenAiTranscriptionFallbackChain(
  preferredModel?: string,
): VoidAiOpenAiSttModel[] {
  const clean = String(preferredModel ?? '').trim() as VoidAiOpenAiSttModel;
  if (VOIDAI_OPENAI_STT_MODELS.includes(clean)) {
    const rest = VOIDAI_OPENAI_STT_MODELS.filter((m) => m !== clean);
    return [clean, ...rest];
  }
  return [...VOIDAI_OPENAI_STT_MODELS];
}

export interface AudioTranscriptionRequest {
  audioBytes: Uint8Array;
  mimeType?: string;
  fileName?: string;
  preferredModel?: string;
  language?: string;
  voidAiBaseUrl?: string;
  voidAiApiKey?: string;
}

export interface AudioTranscriptionResult {
  text: string;
  usedModel: VoidAiOpenAiSttModel;
  fallbackUsed: boolean;
}

async function readSseCompletionText(
  body: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let text = '';

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':')) return;
    const payload = line.startsWith('data:') ? line.slice(5).trim() : line;
    if (payload === '[DONE]') return;
    try {
      const parsed = JSON.parse(payload) as Record<string, unknown>;
      const choices = Array.isArray(parsed.choices) ? parsed.choices : [];
      const first =
        choices.length > 0 && choices[0] && typeof choices[0] === 'object'
          ? (choices[0] as Record<string, unknown>)
          : null;
      const delta =
        first?.delta && typeof first.delta === 'object'
          ? (first.delta as Record<string, unknown>)
          : null;
      const msg =
        first?.message && typeof first.message === 'object'
          ? (first.message as Record<string, unknown>)
          : null;
      const piece =
        typeof delta?.content === 'string'
          ? delta.content
          : typeof msg?.content === 'string'
            ? msg.content
            : '';
      if (piece) text += piece;
    } catch {
      // Ignore partial lines
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const l of lines) processLine(l);
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    for (const l of buffer.split('\n')) processLine(l);
  }
  return text.trim();
}

/**
 * Transcribes spoken audio via VoidAI (`POST https://api.voidai.app/v1/audio/transcriptions`)
 * and OmniRoute (`POST https://omniroute-server-production-eea0.up.railway.app/v1/audio/transcriptions`)
 * with automatic fallback across:
 * 1. `gpt-4o-transcribe`
 * 2. `gpt-4o-mini-transcribe`
 * 3. `whisper-1`
 * 4. Gemini multimodal chat completion fallback (`/v1/chat/completions`)
 */
export async function transcribeAudioViaVoidAi(
  options: AudioTranscriptionRequest,
): Promise<AudioTranscriptionResult> {
  const voidBaseUrl = resolveVoidAiBaseUrl(options.voidAiBaseUrl);
  const voidApiKey = resolveVoidAiApiKey(options.voidAiApiKey);
  const omniBaseUrl = resolveOmniBaseUrl();
  const omniKeys = resolveOmniApiKeys();

  if (!options.audioBytes || options.audioBytes.byteLength === 0) {
    throw new Error('Audio payload is empty.');
  }

  const chain = getOpenAiTranscriptionFallbackChain(options.preferredModel);
  const requestedFirst = chain[0];
  const cleanMimeType =
    (options.mimeType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
  const fileName =
    options.fileName ||
    (cleanMimeType.includes('mp4') || cleanMimeType.includes('m4a')
      ? 'speech.mp4'
      : cleanMimeType.includes('wav')
        ? 'speech.wav'
        : cleanMimeType.includes('mpeg') || cleanMimeType.includes('mp3')
          ? 'speech.mp3'
          : cleanMimeType.includes('ogg')
            ? 'speech.ogg'
            : 'speech.webm');

  const explicitIsoLang =
    options.language === 'ml' || options.language === 'ml-in'
      ? 'ml'
      : options.language === 'hi' || options.language === 'hi-in'
        ? 'hi'
        : options.language === 'en' || options.language === 'en-in'
          ? 'en'
          : undefined;

  const finalizeTranscript = async (rawText: string): Promise<string> => {
    const cleaned = cleanTrilingualText(rawText);
    if (!cleaned) return '';
    if (
      (explicitIsoLang === 'ml' || explicitIsoLang === 'hi') &&
      /[a-zA-Z]/.test(cleaned)
    ) {
      return await googleInputToolsTransliterate(cleaned, explicitIsoLang);
    }
    return cleaned;
  };

  const endpointsToTry: Array<{ endpoint: string; apiKey: string }> = [];
  if (voidApiKey) {
    endpointsToTry.push({
      endpoint: `${voidBaseUrl}/audio/transcriptions`,
      apiKey: voidApiKey,
    });
  }
  for (const omniKey of omniKeys) {
    endpointsToTry.push({
      endpoint: `${omniBaseUrl}/audio/transcriptions`,
      apiKey: omniKey,
    });
  }

  let lastError = 'All transcription models failed.';

  for (const { endpoint, apiKey } of endpointsToTry) {
    for (const candidateModel of chain) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 11000);

      try {
        const formData = new FormData();
        const blob = new Blob([options.audioBytes], { type: cleanMimeType });
        formData.append('file', blob, fileName);
        formData.append('model', candidateModel);
        formData.append('response_format', 'json');
        formData.append(
          'prompt',
          explicitIsoLang === 'ml'
            ? 'Transcribe verbatim in Malayalam script (മലയാളം).'
            : explicitIsoLang === 'hi'
              ? 'Transcribe verbatim in Hindi Devanagari script (हिन्दी).'
              : explicitIsoLang === 'en'
                ? 'Transcribe verbatim in English.'
                : 'Transcribe verbatim in the original spoken language and native script (English, മലയാളം, हिन्दी). Do not translate.',
        );
        if (explicitIsoLang) {
          formData.append('language', explicitIsoLang);
        }

        const res = await fetch(endpoint, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
          body: formData,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!res.ok) {
          const errText = await res.text().catch(() => res.statusText);
          lastError = `STT (${candidateModel}) HTTP ${res.status}: ${errText.slice(0, 180)}`;
          continue;
        }

        const data = (await res.json()) as Record<string, unknown>;
        const rawText = String(data.text ?? '').trim();
        const cleaned = await finalizeTranscript(rawText);
        if (cleaned) {
          return {
            text: cleaned,
            usedModel: candidateModel,
            fallbackUsed: candidateModel !== requestedFirst,
          };
        }
        lastError = `STT (${candidateModel}) returned empty transcript.`;
      } catch (err) {
        clearTimeout(timer);
        lastError =
          err instanceof Error
            ? err.message
            : `STT (${candidateModel}) failed`;
      }
    }
  }

  // Fallback 4: Multimodal Chat Completion on OmniRoute (`void-combo`)
  const audioBase64 = Buffer.from(options.audioBytes).toString('base64');
  const format = cleanMimeType.includes('wav')
    ? 'wav'
    : cleanMimeType.includes('mp4')
      ? 'mp4'
      : cleanMimeType.includes('ogg')
        ? 'ogg'
        : 'webm';

  for (const omniKey of omniKeys) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 9000);
    try {
      const res = await fetch(`${omniBaseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${omniKey}`,
        },
        body: JSON.stringify({
          model: DEFAULT_COMBO_MODEL,
          stream: true,
          messages: [
            {
              role: 'system',
              content:
                'You are a strict Speech-to-Text transcriber. Output ONLY the exact spoken words from the audio in English, Malayalam (മലയാളം), or Hindi (हिन्दी). Never answer questions or add explanations. If silent, output nothing.',
            },
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    explicitIsoLang === 'ml'
                      ? 'Transcribe this audio in Malayalam script (മലയാളം). Output ONLY the spoken words.'
                      : explicitIsoLang === 'hi'
                        ? 'Transcribe this audio in Hindi script (हिन्दी). Output ONLY the spoken words.'
                        : 'Transcribe this audio verbatim in English, മലയാളം, or हिन्दी. Output ONLY the spoken words.',
                },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:${cleanMimeType};base64,${audioBase64}`,
                  },
                },
                {
                  type: 'input_audio',
                  input_audio: {
                    data: audioBase64,
                    format,
                  },
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok && res.body) {
        const rawOut = await readSseCompletionText(res.body);
        if (
          rawOut &&
          !/^(i\s+am|sorry|i\s+cannot|i\s+can't|unable|there\s+is\s+no)/i.test(
            rawOut.trim(),
          )
        ) {
          const cleaned = await finalizeTranscript(rawOut);
          if (cleaned) {
            return {
              text: cleaned,
              usedModel: requestedFirst,
              fallbackUsed: true,
            };
          }
        }
      }
    } catch {
      clearTimeout(timer);
    }
  }

  throw new Error(lastError);
}
