import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AVAILABLE_TTS_VOICES,
  DEFAULT_USER_SETTINGS,
  type UserSettings,
  type VoiceOption,
} from '../lib/chat-storage';
import {
  EMBEDDING_MODEL_CATALOG,
  MODERATION_MODEL_CATALOG,
  STT_MODEL_CATALOG,
  TTS_MODEL_CATALOG,
  type TranscriptionModelId,
  type VoidAiEmbeddingModel,
  type VoidAiTtsModel,
} from '../lib/tools/config';
import { isOpenAiTtsVoice } from '../lib/tools/text_to_speech';
import { authenticatedFetch } from '../lib/api-fetch';
import { listAllStoredMemories } from '../lib/memory-storage';

interface SettingsModalProps {
  open: boolean;
  settings: UserSettings;
  onUpdateSettings: (next: UserSettings) => void;
  onClearAllChats: () => void;
  onClose: () => void;
}

type SettingsTab = 'voice' | 'models' | 'general';
type VoiceSubView = null | 'Male' | 'Female' | 'gpt' | 'speech' | 'transcription';
type ModelsOpenBox = null | 'embeddings' | 'moderation';

const SPEED_OPTIONS = [0.9, 1.0, 1.1, 1.2];

const providerLabel = (provider: VoiceOption['provider']) => {
  if (provider === 'openai') return 'GPT Natural';
  if (provider === 'deepgram') return 'Deepgram';
  return 'ElevenLabs';
};

const voiceMeta = (voice: VoiceOption) =>
  [
    voice.accent ?? voice.language,
    voice.gender,
    providerLabel(voice.provider),
    voice.supportedModels && voice.supportedModels.length === 1
      ? 'gpt-4o-mini-tts only'
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

function RoleBadge({ role }: { role: string }) {
  const isHighlighted = role === 'Primary' || role === 'Default';
  return (
    <span
      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
        isHighlighted
          ? 'border-[#b39dff]/40 bg-[#b39dff]/15 text-[#d8c8ff]'
          : 'border-white/[0.12] bg-white/[0.04] text-[#9a9aa2]'
      }`}
    >
      {role}
    </span>
  );
}

function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={`relative inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full border transition-colors ${
        checked
          ? 'border-white bg-white'
          : 'border-white/[0.14] bg-white/[0.05] hover:bg-white/[0.08]'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full transition-transform ${
          checked
            ? 'translate-x-[19px] bg-[#101010]'
            : 'translate-x-[3px] bg-[#8a8a8f]'
        }`}
      />
    </button>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors ${
        active
          ? 'bg-white/[0.08] text-white'
          : 'text-[#8a8a8f] hover:bg-white/[0.05] hover:text-[#e6e6e9]'
      }`}
    >
      <span className="h-4 w-4 shrink-0">{icon}</span>
      <span className="whitespace-nowrap">{children}</span>
    </button>
  );
}

function ChevronRight({ rotated = false }: { rotated?: boolean }) {
  return (
    <svg
      className={`h-3.5 w-3.5 shrink-0 transition-transform duration-150 ${
        rotated ? 'rotate-90' : ''
      }`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

export default function SettingsModal({
  open,
  settings,
  onUpdateSettings,
  onClearAllChats,
  onClose,
}: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTab>('voice');
  const [voiceView, setVoiceView] = useState<VoiceSubView>(null);
  const [modelsOpenBox, setModelsOpenBox] = useState<ModelsOpenBox>(null);
  const [gptGenderFilter, setGptGenderFilter] = useState<
    'All' | 'Male' | 'Female'
  >('All');
  const [query, setQuery] = useState('');
  const [previewingVoice, setPreviewingVoice] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Live connection status for AI Models tab (Memory & Embeddings + Moderation)
  const [embeddingStatus, setEmbeddingStatus] = useState<
    'idle' | 'checking' | 'connected' | 'error'
  >('idle');
  const [embeddingDetail, setEmbeddingDetail] = useState<string>('');
  const [moderationStatus, setModerationStatus] = useState<
    'idle' | 'checking' | 'connected' | 'error'
  >('idle');
  const [moderationDetail, setModerationDetail] = useState<string>('');
  const [memoryCount, setMemoryCount] = useState<number>(0);

  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmClear(false);
      setQuery('');
      setVoiceView(null);
      setModelsOpenBox(null);
      setGptGenderFilter('All');
      if (previewAudioRef.current) {
        previewAudioRef.current.pause();
        previewAudioRef.current = null;
      }
      setPreviewingVoice(null);
    } else {
      setMemoryCount(listAllStoredMemories().length);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const checkEmbeddingsConnection = async (modelToTest?: VoidAiEmbeddingModel) => {
    setEmbeddingStatus('checking');
    setEmbeddingDetail('Verifying embedding pipeline…');
    try {
      const res = await authenticatedFetch('/api/embeddings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: 'VOID semantic memory connection check',
          model: modelToTest || settings.embeddingModel,
        }),
      });
      if (!res.ok) {
        setEmbeddingStatus('error');
        setEmbeddingDetail(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        model?: string;
        dimensions?: number;
      };
      setEmbeddingStatus('connected');
      setEmbeddingDetail(
        `Connected · ${data.model || settings.embeddingModel} (${data.dimensions || 3072}d)`,
      );
      setMemoryCount(listAllStoredMemories().length);
    } catch {
      setEmbeddingStatus('error');
      setEmbeddingDetail('Connection failed');
    }
  };

  const checkModerationConnection = async () => {
    setModerationStatus('checking');
    setModerationDetail('Verifying moderation filter…');
    try {
      const res = await authenticatedFetch('/api/moderation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: 'Hello, checking safety moderation status.',
        }),
      });
      if (!res.ok) {
        setModerationStatus('error');
        setModerationDetail(`HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        model?: string;
        gatewayAvailable?: boolean;
      };
      setModerationStatus('connected');
      setModerationDetail(
        data.gatewayAvailable !== false
          ? `Connected · ${data.model || 'omni-moderation-latest'}`
          : `Ready (Safe fail-open · ${data.model || 'omni-moderation-latest'})`,
      );
    } catch {
      setModerationStatus('error');
      setModerationDetail('Connection failed');
    }
  };

  // Automatically verify connections when opening the AI Models tab
  useEffect(() => {
    if (open && activeTab === 'models') {
      if (embeddingStatus === 'idle') {
        void checkEmbeddingsConnection();
      }
      if (moderationStatus === 'idle') {
        void checkModerationConnection();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, activeTab]);

  const voiceCounts = useMemo(
    () => ({
      Female: AVAILABLE_TTS_VOICES.filter((voice) => voice.gender === 'Female')
        .length,
      Male: AVAILABLE_TTS_VOICES.filter((voice) => voice.gender === 'Male')
        .length,
      gpt: AVAILABLE_TTS_VOICES.filter((voice) => voice.provider === 'openai')
        .length,
    }),
    [],
  );

  const selectedVoice =
    AVAILABLE_TTS_VOICES.find((voice) => voice.id === settings.ttsVoice) ??
    AVAILABLE_TTS_VOICES.find(
      (voice) => voice.id === DEFAULT_USER_SETTINGS.ttsVoice,
    ) ??
    null;

  const activeSttEntry =
    STT_MODEL_CATALOG.find((m) => m.id === settings.sttModel) ??
    STT_MODEL_CATALOG[0];

  const filteredVoices = useMemo(() => {
    if (voiceView !== 'Male' && voiceView !== 'Female' && voiceView !== 'gpt') {
      return [];
    }
    const q = query.trim().toLowerCase();

    return AVAILABLE_TTS_VOICES.filter((voice) => {
      if (voiceView === 'gpt') {
        if (voice.provider !== 'openai') return false;
        if (gptGenderFilter !== 'All' && voice.gender !== gptGenderFilter) {
          return false;
        }
        return true;
      }
      return voice.gender === voiceView;
    }).filter(
      (voice) =>
        !q ||
        [voice.name, voice.accent, voice.language, voice.description, voice.id]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q),
    );
  }, [voiceView, gptGenderFilter, query]);

  if (!open) return null;

  const handleSelectTtsModel = (modelId: VoidAiTtsModel) => {
    const nextVoice = isOpenAiTtsVoice(settings.ttsVoice)
      ? settings.ttsVoice
      : 'coral';
    onUpdateSettings({
      ...settings,
      ttsModel: modelId,
      ttsVoice: nextVoice,
    });
  };

  const handlePreviewVoice = async (voice: VoiceOption) => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewingVoice === voice.id) {
      setPreviewingVoice(null);
      return;
    }

    setPreviewingVoice(voice.id);
    try {
      const res = await authenticatedFetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text:
            voice.previewText ??
            'Hello! I am VOID, developed by MN. Ready to help with your project.',
          tl: voice.previewLang ?? 'en-US',
          voice: voice.id,
          model: settings.ttsModel || 'gpt-4o-mini-tts',
          speed: settings.ttsSpeed || 1.0,
        }),
      });
      if (!res.ok) {
        setPreviewingVoice(null);
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.playbackRate = settings.ttsSpeed || 1.0;
      previewAudioRef.current = audio;
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
      };
      audio.onerror = () => {
        URL.revokeObjectURL(url);
        setPreviewingVoice(null);
      };
      await audio.play();
    } catch {
      setPreviewingVoice(null);
    }
  };

  const renderVoiceRow = (voice: VoiceOption) => {
    const selected = settings.ttsVoice === voice.id;
    const isPreviewing = previewingVoice === voice.id;
    const isDefault = DEFAULT_USER_SETTINGS.ttsVoice === voice.id;

    return (
      <div
        key={voice.id}
        onClick={() => onUpdateSettings({ ...settings, ttsVoice: voice.id })}
        className={`flex w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors ${
          selected
            ? 'border-white/[0.22] bg-white/[0.06]'
            : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]'
        }`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-[13px] font-medium text-[#ededed]">
              {voice.name}
            </span>
            <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#a1a1aa]">
              {voice.gender}
            </span>
            {isDefault ? (
              <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#8a8a8f]">
                Default
              </span>
            ) : null}
          </div>
          <p
            className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]"
            title={voice.description}
          >
            {voiceMeta(voice)}
          </p>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            void handlePreviewVoice(voice);
          }}
          aria-label={`Preview ${voice.name}`}
          className="shrink-0 rounded-md px-2.5 py-1 text-[11.5px] font-medium text-[#a1a1a6] transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          {isPreviewing ? 'Stop' : 'Preview'}
        </button>

        <span
          aria-hidden="true"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
            selected ? 'border-white bg-white text-black' : 'border-white/25'
          }`}
        >
          {selected ? (
            <svg
              className="h-2.5 w-2.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : null}
        </span>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-4 animate-[ai-fade-in_160ms_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[580px] max-h-[calc(100vh-2rem)] w-full max-w-[720px] flex-col overflow-hidden rounded-2xl border border-white/[0.1] bg-[#111113] text-[#ededed] shadow-2xl md:flex-row"
      >
        {/* Left navigation */}
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-white/[0.07] bg-[#0c0c0e] px-3 py-2.5 md:w-[190px] md:flex-col md:items-stretch md:gap-1 md:overflow-visible md:border-b-0 md:border-r md:px-3 md:py-4">
          <div className="hidden px-2.5 pb-3 text-[12.5px] font-semibold text-[#ededed] md:block">
            Settings
          </div>

          <NavItem
            active={activeTab === 'voice'}
            onClick={() => {
              setActiveTab('voice');
              setVoiceView(null);
              setQuery('');
            }}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M11 5 6 9H3v6h3l5 4V5Z" />
                <path d="M15.5 8.5a5 5 0 0 1 0 7" />
                <path d="M18.5 5.5a9 9 0 0 1 0 13" />
              </svg>
            }
          >
            Voice & Speech
          </NavItem>

          <NavItem
            active={activeTab === 'models'}
            onClick={() => {
              setActiveTab('models');
              setModelsOpenBox(null);
            }}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <rect x="3" y="3" width="7" height="7" rx="1.5" />
                <rect x="14" y="3" width="7" height="7" rx="1.5" />
                <rect x="3" y="14" width="7" height="7" rx="1.5" />
                <rect x="14" y="14" width="7" height="7" rx="1.5" />
              </svg>
            }
          >
            AI Models
          </NavItem>

          <NavItem
            active={activeTab === 'general'}
            onClick={() => setActiveTab('general')}
            icon={
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <line x1="4" y1="6" x2="20" y2="6" />
                <line x1="4" y1="12" x2="20" y2="12" />
                <line x1="4" y1="18" x2="20" y2="18" />
              </svg>
            }
          >
            General
          </NavItem>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="ml-auto inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8a8a8f] hover:bg-white/[0.06] hover:text-white md:hidden"
          >
            ✕
          </button>
        </div>

        {/* Right Content Column — min-w-0 prevents any horizontal box clipping */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {/* Header */}
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/[0.06] px-5 py-4 md:px-6">
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-semibold text-white">
                {activeTab === 'voice'
                  ? 'Voice & Speech'
                  : activeTab === 'models'
                    ? 'AI Models'
                    : 'General'}
              </h2>
              <p className="mt-0.5 text-[12px] leading-relaxed text-[#8a8a8f]">
                {activeTab === 'voice'
                  ? 'Select voices, speech model, and transcription engine.'
                  : activeTab === 'models'
                    ? 'Configure semantic memory embeddings and safety moderation.'
                    : 'Interface and conversation preferences.'}
              </p>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close settings"
              className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8a8a8f] transition-colors hover:bg-white/[0.06] hover:text-white md:inline-flex"
            >
              <svg
                className="h-4 w-4"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          </div>

          {/* VOICE & SPEECH TAB */}
          {activeTab === 'voice' ? (
            <>
              {voiceView === null ? (
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4 md:px-6">
                  {/* Current Voice Box */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6f76]">
                      Current Voice
                    </div>
                    <div className="mt-1.5 flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border border-white/[0.09] bg-white/[0.03] px-3.5 py-2.5">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="truncate text-[13px] font-medium text-[#ededed]">
                            {selectedVoice ? selectedVoice.name : 'Coral'}
                          </span>
                          {selectedVoice ? (
                            <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#a1a1aa]">
                              {selectedVoice.gender}
                            </span>
                          ) : null}
                          {selectedVoice &&
                          selectedVoice.id === DEFAULT_USER_SETTINGS.ttsVoice ? (
                            <span className="rounded border border-white/[0.1] px-1.5 py-0.5 text-[10px] leading-none text-[#8a8a8f]">
                              Default
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                          {selectedVoice ? voiceMeta(selectedVoice) : '—'}
                        </p>
                      </div>
                      {selectedVoice ? (
                        <button
                          type="button"
                          onClick={() => void handlePreviewVoice(selectedVoice)}
                          aria-label={`Preview ${selectedVoice.name}`}
                          className="shrink-0 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 py-1 text-[11.5px] font-medium text-[#d4d4d8] transition-colors hover:bg-white/[0.1] hover:text-white"
                        >
                          {previewingVoice === selectedVoice.id
                            ? 'Stop'
                            : 'Preview'}
                        </button>
                      ) : null}
                    </div>
                  </div>

                  {/* Voice Categories: Male, Female, GPT (all 3 styled identically as compact boxes!) */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6f76]">
                      Voice
                    </div>
                    <div className="mt-1.5 space-y-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setVoiceView('Male');
                          setQuery('');
                        }}
                        className="flex w-full min-w-0 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          Male
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#8a8a8f]">
                          {voiceCounts.Male} voices
                          <ChevronRight />
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setVoiceView('Female');
                          setQuery('');
                        }}
                        className="flex w-full min-w-0 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          Female
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#8a8a8f]">
                          {voiceCounts.Female} voices
                          <ChevronRight />
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setVoiceView('gpt');
                          setGptGenderFilter('All');
                          setQuery('');
                        }}
                        className="flex w-full min-w-0 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          GPT
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#8a8a8f]">
                          {voiceCounts.gpt} voices
                          <ChevronRight />
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Speech (Closed box by default; opens when clicked) */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6f76]">
                      Speech
                    </div>
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => setVoiceView('speech')}
                        className="flex w-full min-w-0 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          Speech
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#8a8a8f]">
                          <span className="font-mono text-[11.5px] text-[#a1a1aa]">
                            {settings.ttsModel}
                          </span>
                          <ChevronRight />
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Transcription (Closed box by default; opens when clicked) */}
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6f76]">
                      Transcription
                    </div>
                    <div className="mt-1.5">
                      <button
                        type="button"
                        onClick={() => setVoiceView('transcription')}
                        className="flex w-full min-w-0 items-center justify-between rounded-xl border border-white/[0.08] bg-white/[0.02] px-3.5 py-2.5 text-left transition-colors hover:border-white/[0.14] hover:bg-white/[0.05]"
                      >
                        <span className="text-[13px] font-medium text-[#ededed]">
                          GPT
                        </span>
                        <span className="flex shrink-0 items-center gap-2 text-[12px] text-[#8a8a8f]">
                          <span className="truncate text-[11.5px] text-[#a1a1aa]">
                            {settings.sttModel === 'default'
                              ? 'Default (EN / ML / HI)'
                              : activeSttEntry.name}
                          </span>
                          <ChevronRight />
                        </span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : voiceView === 'speech' ? (
                /* Speech Model Sub-View (Opened when Speech box is clicked) */
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
                  <div className="flex items-center justify-between pb-3">
                    <button
                      type="button"
                      onClick={() => setVoiceView(null)}
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#a1a1aa] transition-colors hover:text-white"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back to Voice & Speech
                    </button>
                    <span className="text-[11.5px] text-[#6f6f76]">
                      Speech Models
                    </span>
                  </div>

                  <div className="space-y-2">
                    {TTS_MODEL_CATALOG.map((m) => {
                      const active = settings.ttsModel === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            handleSelectTtsModel(m.id as VoidAiTtsModel)
                          }
                          className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                            active
                              ? 'border-white/[0.24] bg-white/[0.06]'
                              : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[13px] font-medium text-[#ededed]">
                                {m.name}
                              </span>
                              <RoleBadge role={m.role} />
                            </div>
                            <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                              {m.description}
                            </p>
                          </div>
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active
                                ? 'border-white bg-white text-black'
                                : 'border-white/25'
                            }`}
                          >
                            {active ? (
                              <svg
                                className="h-2.5 w-2.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : voiceView === 'transcription' ? (
                /* Transcription Model Sub-View (Default Coding Engine at top + imported models below) */
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 md:px-6">
                  <div className="flex items-center justify-between pb-3">
                    <button
                      type="button"
                      onClick={() => setVoiceView(null)}
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#a1a1aa] transition-colors hover:text-white"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back to Voice & Speech
                    </button>
                    <span className="text-[11.5px] text-[#6f6f76]">
                      Transcription
                    </span>
                  </div>

                  <div className="space-y-2">
                    {STT_MODEL_CATALOG.map((m) => {
                      const active = settings.sttModel === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            onUpdateSettings({
                              ...settings,
                              sttModel: m.id as TranscriptionModelId,
                            })
                          }
                          className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                            active
                              ? 'border-white/[0.24] bg-white/[0.06]'
                              : 'border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-[#ededed]">
                                {m.name}
                              </span>
                              <RoleBadge role={m.role} />
                            </div>
                            <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                              {m.description}
                            </p>
                          </div>
                          <span
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                              active
                                ? 'border-white bg-white text-black'
                                : 'border-white/25'
                            }`}
                          >
                            {active ? (
                              <svg
                                className="h-2.5 w-2.5"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="3.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                /* Male / Female / GPT Voice List Sub-View */
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  <div className="flex shrink-0 items-center justify-between px-5 pt-3.5 md:px-6">
                    <button
                      type="button"
                      onClick={() => {
                        setVoiceView(null);
                        setQuery('');
                      }}
                      className="flex items-center gap-1.5 text-[12.5px] font-medium text-[#a1a1aa] transition-colors hover:text-white"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                      Back to Voice & Speech
                    </button>
                    <span className="text-[11.5px] text-[#6f6f76]">
                      {voiceView === 'gpt'
                        ? `GPT · ${filteredVoices.length} voices`
                        : `${voiceView} · ${voiceCounts[voiceView]} voices`}
                    </span>
                  </div>

                  {voiceView === 'gpt' ? (
                    <div className="flex shrink-0 items-center gap-1.5 px-5 pt-2.5 md:px-6">
                      {(['All', 'Male', 'Female'] as const).map((g) => (
                        <button
                          key={g}
                          type="button"
                          onClick={() => setGptGenderFilter(g)}
                          className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                            gptGenderFilter === g
                              ? 'bg-white/[0.12] text-white'
                              : 'text-[#8a8a8f] hover:bg-white/[0.05] hover:text-white'
                          }`}
                        >
                          {g}
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <div className="shrink-0 px-5 pt-2.5 md:px-6">
                    <div className="relative">
                      <svg
                        className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f6f76]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <circle cx="11" cy="11" r="7" />
                        <line x1="21" y1="21" x2="16.65" y2="16.65" />
                      </svg>
                      <input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={`Search ${voiceView === 'gpt' ? 'GPT' : voiceView} voices`}
                        aria-label={`Search ${voiceView === 'gpt' ? 'GPT' : voiceView} voices`}
                        className="h-8.5 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pl-9 pr-3 py-1.5 text-[12.5px] text-[#ededed] placeholder:text-[#6f6f76] focus:border-white/[0.2] focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-5 py-3 md:px-6">
                    {filteredVoices.map(renderVoiceRow)}

                    {filteredVoices.length === 0 ? (
                      <p className="px-1 py-6 text-center text-[12.5px] text-[#8a8a8f]">
                        No voices match “{query.trim()}”.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}

              {/* Footer: Speech speed & Auto-read responses */}
              <div className="shrink-0 space-y-3 border-t border-white/[0.07] bg-[#0e0e10] px-5 py-3.5 md:px-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#ededed]">
                      Speech speed
                    </div>
                    <div className="truncate text-[11.5px] text-[#8a8a8f]">
                      Playback rate for spoken replies
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-0.5 rounded-lg border border-white/[0.08] bg-white/[0.02] p-0.5">
                    {SPEED_OPTIONS.map((spd) => (
                      <button
                        key={spd}
                        type="button"
                        onClick={() =>
                          onUpdateSettings({ ...settings, ttsSpeed: spd })
                        }
                        aria-pressed={Math.abs(settings.ttsSpeed - spd) < 0.02}
                        className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
                          Math.abs(settings.ttsSpeed - spd) < 0.02
                            ? 'bg-white/[0.12] text-white'
                            : 'text-[#8a8a8f] hover:text-[#e6e6e9]'
                        }`}
                      >
                        {spd.toFixed(1)}x
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-medium text-[#ededed]">
                      Auto-read responses
                    </div>
                    <div className="truncate text-[11.5px] text-[#8a8a8f]">
                      Read VOID replies aloud when they finish
                    </div>
                  </div>
                  <Switch
                    checked={settings.autoReadResponses}
                    label="Auto-read responses"
                    onChange={() =>
                      onUpdateSettings({
                        ...settings,
                        autoReadResponses: !settings.autoReadResponses,
                      })
                    }
                  />
                </div>
              </div>
            </>
          ) : activeTab === 'models' ? (
            /* AI MODELS TAB — Only Memory/Embeddings and Moderation, closed by default! */
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4 md:px-6">
              {/* 1. Memory / Embeddings Collapsible Box */}
              <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() =>
                    setModelsOpenBox((prev) =>
                      prev === 'embeddings' ? null : 'embeddings',
                    )
                  }
                  className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-white">
                        Memory & Embeddings
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                          embeddingStatus === 'connected'
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                            : embeddingStatus === 'error'
                              ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                              : 'border-white/10 bg-white/5 text-[#a1a1aa]'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            embeddingStatus === 'connected'
                              ? 'bg-emerald-400'
                              : embeddingStatus === 'error'
                                ? 'bg-amber-400'
                                : 'bg-[#a1a1aa]'
                          }`}
                        />
                        {embeddingStatus === 'connected'
                          ? 'Connected'
                          : embeddingStatus === 'checking'
                            ? 'Checking…'
                            : 'Ready'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                      Active: {settings.embeddingModel} · {memoryCount} saved
                      memories
                    </p>
                  </div>
                  <ChevronRight rotated={modelsOpenBox === 'embeddings'} />
                </button>

                {modelsOpenBox === 'embeddings' ? (
                  <div className="space-y-2.5 border-t border-white/[0.07] bg-black/20 px-4 py-3.5">
                    {EMBEDDING_MODEL_CATALOG.map((m) => {
                      const active = settings.embeddingModel === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => {
                            const nextModel = m.id as VoidAiEmbeddingModel;
                            onUpdateSettings({
                              ...settings,
                              embeddingModel: nextModel,
                            });
                            void checkEmbeddingsConnection(nextModel);
                          }}
                          className={`flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                            active
                              ? 'border-white/[0.22] bg-white/[0.06]'
                              : 'border-white/[0.07] bg-white/[0.01] hover:bg-white/[0.04]'
                          }`}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[12.5px] font-medium text-[#ededed]">
                                {m.name}
                              </span>
                              <RoleBadge role={m.role} />
                            </div>
                            <p className="mt-0.5 truncate text-[11px] text-[#8a8a8f]">
                              {m.description}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-[11px] text-[#a1a1aa]">
                            {m.dimensions}d
                          </span>
                        </button>
                      );
                    })}

                    <div className="flex items-center justify-between pt-1 text-[11px] text-[#8a8a8f]">
                      <span className="truncate">
                        {embeddingDetail ||
                          'Dimension-isolated semantic vector store'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void checkEmbeddingsConnection()}
                        className="shrink-0 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:bg-white/[0.08] hover:text-white"
                      >
                        Test Connection
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>

              {/* 2. Moderation Collapsible Box */}
              <div className="overflow-hidden rounded-xl border border-white/[0.09] bg-white/[0.02]">
                <button
                  type="button"
                  onClick={() =>
                    setModelsOpenBox((prev) =>
                      prev === 'moderation' ? null : 'moderation',
                    )
                  }
                  className="flex w-full min-w-0 items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-white/[0.03]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13.5px] font-medium text-white">
                        Moderation
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                          !settings.moderationEnabled
                            ? 'border-white/10 bg-white/5 text-[#8a8a8f]'
                            : moderationStatus === 'connected'
                              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                              : 'border-[#b39dff]/30 bg-[#b39dff]/10 text-[#d8c8ff]'
                        }`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            !settings.moderationEnabled
                              ? 'bg-[#6f6f76]'
                              : moderationStatus === 'connected'
                                ? 'bg-emerald-400'
                                : 'bg-[#b39dff]'
                          }`}
                        />
                        {!settings.moderationEnabled
                          ? 'Disabled'
                          : moderationStatus === 'connected'
                            ? 'Active'
                            : 'Checking…'}
                      </span>
                    </div>
                    <p className="mt-0.5 truncate text-[11.5px] text-[#8a8a8f]">
                      omni-moderation-latest · Multimodal text & image safety
                    </p>
                  </div>
                  <ChevronRight rotated={modelsOpenBox === 'moderation'} />
                </button>

                {modelsOpenBox === 'moderation' ? (
                  <div className="space-y-3 border-t border-white/[0.07] bg-black/20 px-4 py-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-medium text-[#ededed]">
                          Enable safety moderation
                        </div>
                        <div className="truncate text-[11px] text-[#8a8a8f]">
                          Screen text and uploaded images via VoidAI
                        </div>
                      </div>
                      <Switch
                        checked={settings.moderationEnabled}
                        label="Enable content moderation"
                        onChange={() =>
                          onUpdateSettings({
                            ...settings,
                            moderationEnabled: !settings.moderationEnabled,
                          })
                        }
                      />
                    </div>

                    {MODERATION_MODEL_CATALOG.map((m) => (
                      <div
                        key={m.id}
                        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg border border-white/[0.16] bg-white/[0.04] px-3 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-[12.5px] font-medium text-[#ededed]">
                              {m.name}
                            </span>
                            <RoleBadge role={m.role} />
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[#8a8a8f]">
                            {m.description}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 text-[11px] font-medium ${
                            settings.moderationEnabled
                              ? 'text-emerald-400'
                              : 'text-[#8a8a8f]'
                          }`}
                        >
                          {settings.moderationEnabled ? 'Active' : 'Off'}
                        </span>
                      </div>
                    ))}

                    <div className="flex items-center justify-between pt-0.5 text-[11px] text-[#8a8a8f]">
                      <span className="truncate">
                        {moderationDetail ||
                          'Connected to /api/moderation (omni-moderation-latest)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => void checkModerationConnection()}
                        className="shrink-0 rounded-md border border-white/[0.1] bg-white/[0.04] px-2 py-1 text-[11px] font-medium text-[#d4d4d8] transition-colors hover:bg-white/[0.08] hover:text-white"
                      >
                        Test Connection
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          ) : (
            /* GENERAL TAB */
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 md:px-6">
              <div className="flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#ededed]">
                    Compact chat layout
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#8a8a8f]">
                    Reduce vertical spacing between messages
                  </div>
                </div>
                <Switch
                  checked={settings.compactMode}
                  label="Compact chat layout"
                  onChange={() =>
                    onUpdateSettings({
                      ...settings,
                      compactMode: !settings.compactMode,
                    })
                  }
                />
              </div>

              <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[#6f6f76]">
                  Active Configuration
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[
                    'VOID Combo',
                    'OmniRoute Image Gen',
                    'Web Search',
                    `Embeddings: ${settings.embeddingModel}`,
                    `TTS: ${settings.ttsModel}`,
                    `STT: ${settings.sttModel}`,
                    `Moderation: ${settings.moderationEnabled ? 'On' : 'Off'}`,
                  ].map((tool) => (
                    <span
                      key={tool}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11.5px] text-[#c9c9cf]"
                    >
                      <span className="h-1 w-1 rounded-full bg-white/60" />
                      {tool}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between gap-4 border-t border-white/[0.07] pt-4">
                <div className="min-w-0">
                  <div className="text-[13px] font-medium text-[#ededed]">
                    Clear all chats
                  </div>
                  <div className="mt-0.5 text-[11.5px] text-[#8a8a8f]">
                    Delete every saved conversation from this browser
                  </div>
                </div>
                {confirmClear ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmClear(false)}
                      className="rounded-md bg-white/[0.06] px-2.5 py-1.5 text-[11.5px] font-medium text-[#c9c9cf] transition-colors hover:bg-white/[0.1] hover:text-white"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onClearAllChats();
                        setConfirmClear(false);
                      }}
                      className="rounded-md bg-red-500/15 px-2.5 py-1.5 text-[11.5px] font-medium text-red-300 transition-colors hover:bg-red-500/25"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setConfirmClear(true)}
                    className="shrink-0 rounded-md border border-white/[0.1] px-2.5 py-1.5 text-[11.5px] font-medium text-[#c9c9cf] transition-colors hover:bg-white/[0.06] hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
