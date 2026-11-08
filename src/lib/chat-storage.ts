import {
  type AgentPlanStep,
  OPENAI_TTS_VOICE_SPECS,
  type PendingTerminalCommand,
  type TranscriptionModelId,
  type VoidAiEmbeddingModel,
  type VoidAiTtsModel,
} from './tools/index';

export type { AgentPlanStep, PendingTerminalCommand };

export interface ChatAttachment {
  name: string;
  type: string;
  dataUrl?: string;
}

export type ChatAttachmentItem = string | ChatAttachment;

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  attachments?: ChatAttachmentItem[];
  agentMode?: boolean;
  agentSteps?: AgentPlanStep[];
  agentTaskTitle?: string;
  pendingCommand?: PendingTerminalCommand;
  createdAt?: number;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: ChatMessage[];
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
  modelKey?: string;
  agentMode?: boolean;
}

export interface UserSettings {
  ttsVoice: string;
  ttsModel: VoidAiTtsModel;
  ttsSpeed: number;
  sttModel: TranscriptionModelId;
  embeddingModel: VoidAiEmbeddingModel;
  moderationModel: 'omni-moderation-latest';
  moderationEnabled: boolean;
  autoReadResponses: boolean;
  compactMode: boolean;
}

export interface VoiceOption {
  id: string;
  name: string;
  description: string;
  provider: 'openai' | 'deepgram' | 'elevenlabs';
  language: string;
  accent?: string;
  gender: 'Female' | 'Male';
  supportedModels?: VoidAiTtsModel[];
  previewText?: string;
  previewLang?: string;
}

const ENGLISH_PREVIEW_TEXT =
  'Hello! I am VOID, developed by MN. Ready to help with your project.';

const KANNADA_PREVIEW_TEXT =
  'ನಮಸ್ಕಾರ! ನಾನು ಮಂಜುನಾಥ್. ನಿಮ್ಮ package delivered ಆಗಿದೆ ಅಂತ mark ಆಗಿದೆ, ಆದರೆ ಅದು ತಲುಪಿಲ್ಲ ಅಂತ ನೀವು ಹೇಳುತ್ತಿದ್ದೀರಿ — ನಾನು lost package investigation open ಮಾಡುತ್ತೇನೆ.';

interface DeepgramVoiceSeed {
  name: string;
  model: string;
  language: string;
  accent?: string;
  gender: 'Female' | 'Male';
  description: string;
}

/** Every Deepgram Flux TTS voice (36 English + Kannada), straight from the
 *  Deepgram voice catalog. */
const DEEPGRAM_FLUX_VOICES: DeepgramVoiceSeed[] = [
  { name: 'Alexis', model: 'flux-alexis-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, calm, caring' },
  { name: 'Bree', model: 'flux-bree-en', language: 'English', accent: 'American', gender: 'Female', description: 'Friendly, sweet, kind' },
  { name: 'Brittany', model: 'flux-brittany-en', language: 'English', accent: 'American', gender: 'Female', description: 'Confident, kind, soft' },
  { name: 'Brooke', model: 'flux-brooke-en', language: 'English', accent: 'American', gender: 'Female', description: 'Friendly, intelligent, fast, confident' },
  { name: 'Bruce', model: 'flux-bruce-en', language: 'English', accent: 'American', gender: 'Male', description: 'Friendly, kind, natural, believable' },
  { name: 'Cliff', model: 'flux-cliff-en', language: 'English', accent: 'American', gender: 'Male', description: 'Deep, confident, calm, raspy' },
  { name: 'Cole', model: 'flux-cole-en', language: 'English', accent: 'American', gender: 'Male', description: 'Friendly, clear, energetic, engaging' },
  { name: 'Colin', model: 'flux-colin-en', language: 'English', accent: 'British', gender: 'Male', description: 'Warm, friendly, trustworthy, authoritative' },
  { name: 'Conor', model: 'flux-conor-en', language: 'English', accent: 'British', gender: 'Male', description: 'Confident, deep, friendly, relaxed' },
  { name: 'Donovan', model: 'flux-donovan-en', language: 'English', accent: 'American', gender: 'Male', description: 'Professional, calm, thoughtful' },
  { name: 'Drew', model: 'flux-drew-en', language: 'English', accent: 'American', gender: 'Male', description: 'Confident, relaxed, soft, calm' },
  { name: 'Elise', model: 'flux-elise-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, calm, caring' },
  { name: 'Gemma', model: 'flux-gemma-en', language: 'English', accent: 'British', gender: 'Female', description: 'Friendly, kind, approachable, caring' },
  { name: 'Haley', model: 'flux-haley-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, caring, empathetic' },
  { name: 'Hannah', model: 'flux-hannah-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, confident, thoughtful, pleasant' },
  { name: 'Heather', model: 'flux-heather-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, engaging, energetic, friendly' },
  { name: 'Jack', model: 'flux-jack-en', language: 'English', accent: 'British', gender: 'Male', description: 'Confident, thoughtful, friendly, clear' },
  { name: 'Kai', model: 'flux-kai-en', language: 'English', accent: 'Singaporean', gender: 'Male', description: 'Clear, calm, professional, knowledgeable' },
  { name: 'Kelsey', model: 'flux-kelsey-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, caring, calm' },
  { name: 'Kit', model: 'flux-kit-en', language: 'English', accent: 'British', gender: 'Male', description: 'Friendly, energetic, thoughtful, calm' },
  { name: 'Maeve', model: 'flux-maeve-en', language: 'English', accent: 'Irish', gender: 'Female', description: 'Friendly, energetic, confident, gentle' },
  { name: 'Marcelo', model: 'flux-marcelo-en', language: 'English', accent: 'Filipino', gender: 'Male', description: 'Clear, calm, professional, caring' },
  { name: 'Marcus', model: 'flux-marcus-en', language: 'English', accent: 'American', gender: 'Male', description: 'Friendly, helpful, smooth, professional' },
  { name: 'Meena', model: 'flux-meena-en', language: 'English', accent: 'Indian', gender: 'Female', description: 'Empathetic, professional, calm, reassuring' },
  { name: 'Meghan', model: 'flux-meghan-en', language: 'English', accent: 'American', gender: 'Female', description: 'Friendly, energetic, kind, confident' },
  { name: 'Miles', model: 'flux-miles-en', language: 'English', accent: 'American', gender: 'Male', description: 'Clear, calm, professional, sincere' },
  { name: 'Naveen', model: 'flux-naveen-en', language: 'English', accent: 'Indian', gender: 'Male', description: 'Clear, professional, knowledgeable, calm' },
  { name: 'Paige', model: 'flux-paige-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, calm, caring' },
  { name: 'Priya', model: 'flux-priya-en', language: 'English', accent: 'Indian', gender: 'Female', description: 'Confident, empathetic, professional, reassuring' },
  { name: 'Rufus', model: 'flux-rufus-en', language: 'English', accent: 'British', gender: 'Male', description: 'Friendly, confident, intelligent, gentle' },
  { name: 'Sean', model: 'flux-sean-en', language: 'English', accent: 'British', gender: 'Male', description: 'Friendly, kind, caring, calming' },
  { name: 'Sharon', model: 'flux-sharon-en', language: 'English', accent: 'Australian', gender: 'Female', description: 'Formal, calm, relaxed, confident' },
  { name: 'Sienna', model: 'flux-sienna-en', language: 'English', accent: 'American', gender: 'Female', description: 'Clear, professional, calm, warm' },
  { name: 'Tanner', model: 'flux-tanner-en', language: 'English', accent: 'British', gender: 'Male', description: 'Professional, calm, confident' },
  { name: 'Wade', model: 'flux-wade-en', language: 'English', accent: 'American', gender: 'Male', description: 'Warm, confident, clear, friendly' },
  { name: 'Wes', model: 'flux-wes-en', language: 'English', accent: 'American', gender: 'Male', description: 'Thoughtful, friendly, warm' },
  { name: 'Manjunath', model: 'flux-manjunath-kn', language: 'Kannada', gender: 'Male', description: 'Clear, professional Kannada delivery' },
];

export const AVAILABLE_TTS_VOICES: VoiceOption[] = [
  ...OPENAI_TTS_VOICE_SPECS.map((spec) => ({
    id: spec.id,
    name: spec.name,
    description: spec.description,
    provider: 'openai' as const,
    language: 'Multilingual',
    accent: 'Natural GPT',
    gender: spec.gender,
    supportedModels: spec.supportedModels,
    previewText: ENGLISH_PREVIEW_TEXT,
    previewLang: 'en-US',
  })),
  ...DEEPGRAM_FLUX_VOICES.map((voice) => ({
    id: voice.model,
    name: voice.name,
    description: voice.description,
    provider: 'deepgram' as const,
    language: voice.language,
    accent: voice.accent,
    gender: voice.gender,
    previewText:
      voice.language === 'Kannada'
        ? KANNADA_PREVIEW_TEXT
        : ENGLISH_PREVIEW_TEXT,
    previewLang: voice.language === 'Kannada' ? 'kn-IN' : 'en-US',
  })),
  {
    id: 'bella',
    name: 'Bella',
    description: 'Warm, expressive ElevenLabs voice',
    provider: 'elevenlabs',
    language: 'English',
    gender: 'Female',
    previewText: ENGLISH_PREVIEW_TEXT,
    previewLang: 'en-US',
  },
  {
    id: 'antoni',
    name: 'Antoni',
    description: 'Crisp, well-paced ElevenLabs voice',
    provider: 'elevenlabs',
    language: 'English',
    gender: 'Male',
    previewText: ENGLISH_PREVIEW_TEXT,
    previewLang: 'en-US',
  },
];

const CHATS_STORAGE_KEY = 'void_ai_chat_sessions_v1';
const userChatsStorageKey = (userId: string) =>
  `${CHATS_STORAGE_KEY}:user:${userId}`;
const SETTINGS_STORAGE_KEY = 'void_ai_user_settings_v2';

export const DEFAULT_USER_SETTINGS: UserSettings = {
  ttsVoice: 'coral',
  ttsModel: 'gpt-4o-mini-tts',
  ttsSpeed: 1.0,
  sttModel: 'default',
  embeddingModel: 'text-embedding-3-large',
  moderationModel: 'omni-moderation-latest',
  moderationEnabled: true,
  autoReadResponses: false,
  compactMode: false,
};

export function loadChatSessions(userId?: string): ChatSession[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(
      userId ? userChatsStorageKey(userId) : CHATS_STORAGE_KEY,
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ChatSession =>
        Boolean(item && typeof item.id === 'string' && Array.isArray(item.messages)),
    );
  } catch {
    return [];
  }
}

export function loadLegacyChatSessions(): ChatSession[] {
  return loadChatSessions();
}

export function removeLegacyChatSessions(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CHATS_STORAGE_KEY);
  } catch {
    // Ignore storage errors.
  }
}

export function saveChatSessions(sessions: ChatSession[], userId?: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      userId ? userChatsStorageKey(userId) : CHATS_STORAGE_KEY,
      JSON.stringify(sessions),
    );
  } catch {
    // Ignore storage quota errors
  }
}

export function loadUserSettings(): UserSettings {
  if (typeof window === 'undefined') return DEFAULT_USER_SETTINGS;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<UserSettings>;
    const validTtsModels: VoidAiTtsModel[] = [
      'gpt-4o-mini-tts',
      'tts-1-hd',
      'tts-1',
    ];
    const validSttModels: TranscriptionModelId[] = [
      'default',
      'gemini',
      'gpt-4o-transcribe',
      'gpt-4o-mini-transcribe',
      'whisper-1',
    ];
    const validEmbeddingModels: VoidAiEmbeddingModel[] = [
      'text-embedding-3-large',
      'text-embedding-3-small',
    ];

    const resolvedVoice =
      typeof parsed.ttsVoice === 'string' &&
      parsed.ttsVoice !== 'flux-meena-en' &&
      AVAILABLE_TTS_VOICES.some((voice) => voice.id === parsed.ttsVoice)
        ? parsed.ttsVoice
        : DEFAULT_USER_SETTINGS.ttsVoice;

    return {
      ttsVoice: resolvedVoice,
      ttsModel:
        typeof parsed.ttsModel === 'string' &&
        validTtsModels.includes(parsed.ttsModel as VoidAiTtsModel)
          ? (parsed.ttsModel as VoidAiTtsModel)
          : DEFAULT_USER_SETTINGS.ttsModel,
      ttsSpeed:
        typeof parsed.ttsSpeed === 'number' &&
        parsed.ttsSpeed >= 0.7 &&
        parsed.ttsSpeed <= 1.5
          ? parsed.ttsSpeed
          : DEFAULT_USER_SETTINGS.ttsSpeed,
      sttModel:
        typeof parsed.sttModel === 'string' &&
        validSttModels.includes(parsed.sttModel as TranscriptionModelId)
          ? (parsed.sttModel as TranscriptionModelId)
          : DEFAULT_USER_SETTINGS.sttModel,
      embeddingModel:
        typeof parsed.embeddingModel === 'string' &&
        validEmbeddingModels.includes(
          parsed.embeddingModel as VoidAiEmbeddingModel,
        )
          ? (parsed.embeddingModel as VoidAiEmbeddingModel)
          : DEFAULT_USER_SETTINGS.embeddingModel,
      moderationModel: 'omni-moderation-latest',
      moderationEnabled:
        typeof parsed.moderationEnabled === 'boolean'
          ? parsed.moderationEnabled
          : DEFAULT_USER_SETTINGS.moderationEnabled,
      autoReadResponses: Boolean(parsed.autoReadResponses),
      compactMode: Boolean(parsed.compactMode),
    };
  } catch {
    return DEFAULT_USER_SETTINGS;
  }
}

export function saveUserSettings(settings: UserSettings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage errors
  }
}

export function deriveChatTitle(firstMessageText: string): string {
  const cleaned = firstMessageText
    .replace(/\s+/g, ' ')
    .replace(/^[@/]\S+\s*/, '')
    .trim();
  if (!cleaned) return 'New Chat';
  if (cleaned.length <= 38) return cleaned;
  return `${cleaned.slice(0, 36).trim()}…`;
}
