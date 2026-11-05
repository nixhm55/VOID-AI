/**
 * Ultra-Fast (<50ms) Trilingual Speech-to-Script Converter
 * Primary: English (en) | Direct Native Scripts: Malayalam (മലയാളം) & Hindi (हिन्दी)
 */

const DISALLOWED_SCRIPT_REGEX =
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
  /\b(?:main|mein|mujhe|mera|meri|mere|tum|tumhara|aap|aapka|kya|kaise|kaisa|kaisi|kahan|kab|kyun|kyon|hai|hain|ho|hoon|tha|thi|the|nahi|nahin|haan|accha|achha|theek|thik|bhai|yaar|dost|madad|chahiye|karo|karna|karenge|batao|bataiye|dekho|suno|samajh|haal|mausam|kaam|naam|sab|kuch|bahut|abhi|aaj|kal)\b/i;

export function detectSpokenLanguage(
  hint: string,
  preferredLang = 'en',
): 'en' | 'ml' | 'hi' {
  if (preferredLang === 'ml') return 'ml';
  if (preferredLang === 'hi') return 'hi';

  const cleaned = hint.toLowerCase().trim();
  if (!cleaned) return 'en';

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

  return 'en';
}

async function googleInputToolsTransliterate(
  text: string,
  targetLang: 'ml' | 'hi',
): Promise<string> {
  const itc = targetLang === 'ml' ? 'ml-t-i0-und' : 'hi-t-i0-und';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 800);

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
}): Promise<string> {
  let text = cleanTrilingualText(options.hint);
  if (!text) return '';

  for (const [pattern, replacement] of INSTANT_PHRASE_MAP) {
    text = text.replace(pattern, replacement);
  }
  text = collapseDuplicateSpeech(text);

  if (!/[a-zA-Z]/.test(text)) {
    return text;
  }

  const targetLang = detectSpokenLanguage(text, options.lang || 'en');
  if (targetLang === 'en') {
    return collapseDuplicateSpeech(text);
  }

  const converted = await googleInputToolsTransliterate(text, targetLang);
  return collapseDuplicateSpeech(converted || text);
}
