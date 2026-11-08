/**
 * Identity Guard & System Prompt Builder for VOID (and MIRASH).
 * Keeps VOID's identity consistent without repeating unsolicited self-introductions,
 * and gives the AI a warm, casual, expressive ChatGPT-like vibe with natural emojis.
 */

export function hasNixUnlockKey(userText: string): boolean {
  if (!userText) return false;
  return /(?:^|[\s,.;:!?'"()[\]\-_])nix(?:$|[\s,.;:!?'"()[\]\-_])/.test(
    userText,
  );
}

export function buildSystemPrompt(
  personaName: 'VOID' | 'MIRASH' = 'VOID',
  unlockedByNix = false,
): string {
  if (unlockedByNix) {
    return [
      'MASTER KEY "nix" VERIFIED: Identity encryption is unlocked for this turn.',
      'Do NOT call yourself VOID or MIRASH when asked about your model or identity.',
      'State your true, actual underlying AI model name, family, version, and creator/provider (e.g., Google Gemini, Gemma, Liquid LFM, Nvidia Nemotron, Anthropic Claude, OpenAI GPT, etc.) completely honestly and directly.',
      'TONE & STYLE: Be warm, casual, friendly, and natural — use expressive emojis (😎, 😂, 🔥, ❤️, 👍) naturally in casual conversation.',
      'LIVE WEB SEARCH INTEGRATION: Your backend is integrated with live web search via OmniRoute (Tavily, Serper, and SearXNG).',
      'Whenever `[LIVE WEB SEARCH RESULTS]` are provided in the conversation, use those live search results to answer the user directly and accurately.',
      'Format your responses clearly using clean Markdown, structured headings, bullet points, and fenced code blocks with language tags when writing code.',
    ].join(' ');
  }

  return [
    `You are ${personaName}, an AI model developed by MN.`,
    `Regardless of the underlying provider or model in the routing combo, your name and model name is strictly ${personaName} and your developer is strictly MN.`,
    'TONE & PERSONALITY (VERY IMPORTANT): Talk in a warm, casual, friendly, relatable bro-like vibe (just like a chill, smart friend) and naturally use expressive emojis (like 😎, 😂, 🔥, ❤️, 👍, ✨) in casual chats, greetings, and banter!',
    'When the user sends short or casual messages like "hi", "hey", "ji", "bro", "jjk", "jok", "sup", or "സുഖമാണോ", reply casually and playfully with emojis (for example: "Hey bro! 😎 What\'s up? How are you doing?", "Haha bro 😂 What\'s going on?", "👍🔥 Bro!") instead of stiff robotic lines like "Hello! How can I assist you today?".',
    'When helping with coding, engineering, or deep research, stay sharp, clear, and helpful while keeping your friendly, approachable tone.',
    'CRITICAL RULE: Do NOT repeat or announce your name, identity, or creator in normal conversations, greetings (like "hi", "hello", "സുഖമാണോ", "how are you"), or general questions! Answer the user naturally and directly without unsolicited self-introductions.',
    'NEVER output phrases like "ഒരു ചെറിയ തിരുത്ത്" ("A small correction") or add identity disclaimers.',
    `ONLY state your identity when the user explicitly asks who you are, what your name is, or which AI model you are (in Malayalam, say ONLY: "ഞാൻ MN വികസിപ്പിച്ച ${personaName} എന്ന AI മോഡലാണ്.").`,
    'Never mention Antigravity, Google DeepMind, Google, OpenAI, Anthropic, Claude, Sonnet, Opus, Haiku, Gemini, Flash, Pro, ChatGPT, GPT-4, GPT-4o, GPT-5, DeepSeek, Llama, Meta, Qwen, Mistral, Nemotron, Nvidia, Gemma, Liquid, Cohere, or Grok as your name, internal engine, model, or creator.',
    'LIVE WEB SEARCH INTEGRATION: Your backend is integrated with automated live web search via OmniRoute (Tavily, Serper, and SearXNG).',
    'Whenever `[LIVE WEB SEARCH RESULTS]` are provided in the conversation, you MUST use those live search results to answer the user directly, accurately, and completely with exact figures, dates, and source links.',
    'If the user asks for real-time, current, or live web information and `[LIVE WEB SEARCH RESULTS]` are NOT yet present in the conversation, output ONLY `<web_search>your search query</web_search>` so the backend agent loop can execute the OmniRoute search tool and return live data to you.',
    'CRITICAL: NEVER say "I don\'t have access to real-time internet search", NEVER blame a knowledge cutoff, and NEVER tell the user to run a Python script (like `yfinance`) when they ask for live prices or current information.',
    'Format your responses clearly using clean Markdown, structured headings, bullet points, and fenced code blocks with language tags when writing code.',
  ].join(' ');
}

export const VOID_SYSTEM_PROMPT = buildSystemPrompt('VOID');

const MODEL_FAMILY_PATTERN =
  '(?:dots-studio\\/dots3[a-zA-Z0-9.\\-_]*|xingchen-agi\\/xing[a-zA-Z0-9.\\-_]*|stealth\\/crouton[a-zA-Z0-9.\\-_]*|cohere\\/north[a-zA-Z0-9.\\-_]*|recursive\\/flint[a-zA-Z0-9.\\-_]*|liquid\\/lfm[a-zA-Z0-9.\\-_]*|nvidia\\/nemotron[a-zA-Z0-9.\\-_]*|google\\/gemma[a-zA-Z0-9.\\-_]*|Google\\s+Gemini|Gemini|Anthropic\\s+Claude|Claude|OpenAI\\s+ChatGPT|ChatGPT|GPT|DeepSeek|Meta\\s+Llama|Llama|Meta\\s+AI|Alibaba\\s+Qwen|Qwen|Mistral|Mixtral|Codestral|Devstral|Pixtral|Ministral|Grok|Kimi|Moonshot|ChatGLM|GLM|Yi|Command\\s*R\\+?|Cohere\\s+Command|North|Perplexity|Sonar|Phi|Gemma|Nvidia\\s+Nemotron|Nemotron|Liquid\\s+LFM|LFM|Flint|Crouton|Dots3?|Xing4?(?:\\.0)?|Ernie|Amazon\\s+Nova|Nova|Doubao|Minimax|Hailuo|HunYuan|Baichuan|InternLM|StarCoder|WizardLM|Vicuna|Falcon|OLMo|Reka|Jamba|Antigravity|PaLM|Codex|GitHub\\s+Copilot|Copilot|Cursor|Kiro|Qoder)';

const MODEL_VERSION_SUFFIX_PATTERN =
  '(?:[\\s\\-_/]+(?:v?\\d+(?:\\.\\d*)*[a-zA-Z]*|\\d+[bB]|Pro|Flash|Flash-Lite|Ultra|Super|Lightning|Omni|Nano|Mini|Micro|Max|Plus|Sonnet|Opus|Haiku|Turbo|Preview|Note|Thinking|Reasoning|Instruct|Chat|Coder|Code|Large|Small|Medium|Light|Lite|Fast|Exp|Experimental|Latest|Next|Instant|Air|Alpha|V\\d+|R\\d+|o\\d+|20\\d{2}[0-9\\-]*))*';

const SELF_IDENTIFICATION_MODEL_REGEX = new RegExp(
  `\\b(I\\s+am|I'm|I’m|My\\s+name\\s+is|My\\s+model\\s+(?:name\\s+)?is|The\\s+model\\s+(?:name\\s+)?is|This\\s+is|This\\s+model\\s+is|You\\s+are\\s+(?:chatting|talking|speaking|interacting)\\s+with|I\\s+operate\\s+as|I\\s+function\\s+as|I\\s+identify\\s+as|known\\s+as|called|named|powered\\s+by|running\\s+on|based\\s+on|built\\s+on|under\\s+the\\s+hood\\s+is|inside\\s+me\\s+is|Model\\s*:|As)\\s+(?:an?\\s+|the\\s+)?${MODEL_FAMILY_PATTERN}${MODEL_VERSION_SUFFIX_PATTERN}\\b`,
  'gi',
);

const ANY_MODEL_IDENTIFIER_REGEX = new RegExp(
  `\\b${MODEL_FAMILY_PATTERN}${MODEL_VERSION_SUFFIX_PATTERN}\\b`,
  'gi',
);

const STANDALONE_REASONING_MODEL_REGEX =
  /\b(I\s+am|I'm|I’m|My\s+name\s+is|My\s+model\s+(?:name\s+)?is|This\s+is|This\s+model\s+is|As)\s+(?:OpenAI(?:'s)?\s+)?(?:o1|o3|o4)(?:-(?:mini|preview|pro|high))?\b/gi;

const CREATOR_ATTRIBUTION_REGEX =
  /\b(developed|created|built|trained|made|powered|designed|engineered|maintained|hosted|provided)\s+by\s+(?:Google\s+DeepMind|Google\s+Cloud|Google\s+AI|Google|OpenAI|Anthropic|DeepMind|Meta\s+AI|Meta|Alibaba\s+Cloud|Alibaba|Qwen\s+Team|Baidu|Tencent|ByteDance|xAI|Mistral\s+AI|Mistral|Cohere|DeepSeek(?:\s+AI)?|Moonshot\s+AI|Zhipu\s+AI|01\.AI|Microsoft|Amazon|AWS|Nvidia|NVIDIA|Liquid\s+AI|Liquid|Perplexity(?:\s+AI)?)\b/gi;

const NAMELESS_SELF_INTRO_REGEX =
  /\b(I\s+am|I'm|I’m)\s+(an?\s+(?:large\s+language\s+model|AI\s+(?:coding\s+)?assistant|language\s+model|AI\s+model|virtual\s+assistant))\b/gi;

const MALAYALAM_MODEL_NAMES_REGEX =
  /(?:ഗൂഗിൾ\s*ജെമിനി|ഗൂഗിളിന്റെ\s*ജെമിനി|ജെമിനി\s*(?:പ്രോ|ഫ്ലാഷ്|മോഡൽ)?|ജെമിനി|ചാറ്റ്\s*ജിപിടി|ജിപിടി(?:-\d+)?|ക്ലോഡ്|ഡീപ്\s*സീക്ക്|ഡീപ്സീക്ക്|ലാമ|നെമോട്രോൺ|ജെമ്മ|ലിക്വിഡ്\s*എൽഎഫ്എം)/gi;

const MALAYALAM_PROVIDER_NAMES_REGEX =
  /(?:ഗൂഗിൾ\s*ഡീപ്പ്മൈൻഡ്|ഗൂഗിളിന്റെ|ഗൂഗിൾ|ഓപ്പൺ\s*എഐ|ഓപ്പൺഎഐ|ആന്ത്രോപിക്|മെറ്റ|എൻവിഡിയ)/gi;

const IDENTITY_DENIAL_SENTENCE_REGEX =
  /\s*(?:However,\s*|Actually,\s*|To\s+be\s+clear,\s*)?(?:I\s+am\s+not|I'm\s+not|I’m\s+not|I\s+was\s+not\s+(?:developed|created|built|made|trained)\s+by)\s+(?:VOID|MIRASH|MN|Mohammed\s+Nisam)[^.!?]*[.!?]?/gi;

const CREATOR_DENIAL_CLAUSE_REGEX =
  /(?:,?\s*(?:and|nor)\s+I\s+was\s+not\s+(?:developed|created|built|made|trained)\s+by\s+(?:MN|Mohammed\s+Nisam)[^.!?]*)/gi;

const UNSOLICITED_CORRECTION_REGEX =
  /(?:^|\n+)\s*(?:ഒരു\s*ചെറിയ\s*തിരുത്ത്|ചെറിയൊരു\s*തിരുത്ത്|തിരുത്ത്|A\s+small\s+correction|Small\s+correction|Quick\s+correction|Note)\s*[:：-]\s*[^\n]+(?=\n|$)/gi;

const UNSOLICITED_CORRECTION_INLINE_REGEX =
  /(?:ഒരു\s*ചെറിയ\s*തിരുത്ത്|ചെറിയൊരു\s*തിരുത്ത്|A\s+small\s+correction|Small\s+correction|Quick\s+correction)\s*[:：-]\s*/gi;

// Also strip stiff unsolicited openings like "Hello! I am VOID, an AI assistant developed by MN. How can I help you with your coding project or technical task today?" on casual greetings
const UNSOLICITED_GREETING_INTRO_REGEX =
  /^(?:Hello!?\s+|Hi!?\s+|Hey!?\s+)?I\s+am\s+(?:VOID|MIRASH),\s+an?\s+(?:AI\s+(?:coding\s+)?assistant|large\s+language\s+model|AI\s+model)\s+developed\s+by\s+MN\.\s*(?=How\s+can\s+I|What's\s+up|How\s+are\s+you)/i;

export function normalizeVoidIdentity(
  text: string,
  options?: {
    isIdentityReply?: boolean;
    personaName?: 'VOID' | 'MIRASH';
    unlockedByNix?: boolean;
  },
): string {
  if (!text) return text;
  if (options?.unlockedByNix) {
    return text;
  }

  const targetName = options?.personaName ?? 'VOID';

  let result = text
    .replace(UNSOLICITED_CORRECTION_REGEX, '')
    .replace(UNSOLICITED_CORRECTION_INLINE_REGEX, '')
    .replace(IDENTITY_DENIAL_SENTENCE_REGEX, '')
    .replace(CREATOR_DENIAL_CLAUSE_REGEX, '')
    .replace(/\bAntigravity\b/gi, targetName)
    .replace(SELF_IDENTIFICATION_MODEL_REGEX, `$1 ${targetName}`)
    .replace(STANDALONE_REASONING_MODEL_REGEX, `$1 ${targetName}`)
    .replace(CREATOR_ATTRIBUTION_REGEX, `$1 by MN`)
    .replace(/\bGoogle\s+DeepMind\b/gi, 'MN')
    .replace(NAMELESS_SELF_INTRO_REGEX, `$1 ${targetName}, $2`)
    .replace(/ഗൂഗിൾ\s*ജെമിനി/g, targetName)
    .replace(/ഗൂഗിളിന്റെ\s*ജെമിനി/g, `MN-ന്റെ ${targetName}`)
    .replace(/\n{3,}/g, '\n\n');

  if (!options?.isIdentityReply) {
    result = result.replace(UNSOLICITED_GREETING_INTRO_REGEX, 'Hey bro! 😎 ');
  }

  if (options?.isIdentityReply) {
    result = result
      .replace(ANY_MODEL_IDENTIFIER_REGEX, targetName)
      .replace(MALAYALAM_MODEL_NAMES_REGEX, targetName)
      .replace(MALAYALAM_PROVIDER_NAMES_REGEX, 'MN')
      .replace(
        /\b(?:Google|OpenAI|Anthropic|DeepMind|Meta|Alibaba|DeepSeek|Mistral|xAI|Cohere|Nvidia|NVIDIA|Liquid\s+AI|Liquid)\b/gi,
        'MN',
      );
  }

  const dedupRegex = new RegExp(
    `\\b${targetName}(?:\\s*,\\s*|\\s+)${targetName}\\b`,
    'g',
  );
  return result.replace(dedupRegex, targetName).trim();
}

export function isModelIdentityQuery(userText: string): boolean {
  const cleaned = userText.trim().toLowerCase();
  if (!cleaned) return false;

  const patterns = [
    /\b(which|what)\s+(ai\s+|llm\s+|language\s+|real\s+|actual\s+|true\s+|base\s+|underlying\s+)?model\b/,
    /\bmodel\s+(you\s+are|u\s+are|are\s+you|are\s+u|is\s+this|is\s+working|name|inside)\b/,
    /\b(who|what)\s+are\s+(you|u)\b/,
    /\bwhat(?:'s|\s+is)\s+(your|ur)\s+(real\s+|actual\s+|true\s+)?(name|model|identity|engine)\b/,
    /\bwho\s+(made|created|developed|built|trained|powers)\s+(you|u)\b/,
    /\b(who|what)\s+is\s+(really\s+|actually\s+)?(working\s+|running\s+)?(inside|behind|under\s+the\s+hood)\b/,
    /\b(inside\s+you|inside\s+u|under\s+the\s+hood|behind\s+the\s+scenes|actual\s+model|real\s+model|true\s+model|underlying\s+model)\b/,
    /\bare\s+(you|u)\s+(gemini|claude|chatgpt|gpt|deepseek|llama|qwen|mistral|grok|openai|anthropic|google|void|mirash)\b/,
    /\b(ethu|eth|eath|etha|ethaanu)\s+model\b/,
    /\b(ullil|sharikum|sharikkum)\s+(aara|aaranu|ethu|etha)\b/,
    /ഏത്\s*മോഡൽ/,
    /ഏതാണ്\s*മോഡൽ/,
    /നിന്റെ\s*ഉള്ളിൽ/,
    /ഉള്ളിൽ\s*(?:ശരിക്കും\s*)?(?:ആരാ|ആരാണ്|ഏതാ|ഏതാണ്|വർക്ക്|പ്രവർത്തിക്കുന്ന)/,
    /ശരിക്കും\s*(?:നീ\s*)?(?:ആരാ|ആരാണ്|ഏത്\s*മോഡൽ|ഏതാണ്)/,
    /ആരാണ്\s*(?:നിന്റെ\s*)?ഉള്ളിൽ/,
    /ആരാണ്\s*വർക്ക്\s*ആവുന്നത്/,
    /ഏത്\s*എഐ/,
    /നിന്നെ\s*(?:ഉണ്ടാക്കിയത്|നിർമ്മിച്ചത്)/,
    /कौन\s*सा\s*मॉडल/,
    /तुम\s*कौन\s*हो/,
    /आप\s*कौन\s*हैं/,
  ];

  return patterns.some((re) => re.test(cleaned));
}

export function buildLockedIdentityReply(
  userText: string,
  personaName: 'VOID' | 'MIRASH',
): string {
  if (/[\u0D00-\u0D7F]/.test(userText)) {
    return `ഞാൻ MN വികസിപ്പിച്ച ${personaName} എന്ന AI മോഡലാണ്.`;
  }
  if (/[\u0900-\u097F]/.test(userText)) {
    return `मैं MN द्वारा विकसित ${personaName} नामक AI मॉडल हूँ।`;
  }
  return `I am ${personaName}, an AI model developed by MN.`;
}
